from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .__main__ import load_instructions
from .agent import Agent
from .config import DeepSeekConfig
from .models import OpenAIChatModel
from .session import JsonlSession
from .tools import Tool, ToolRegistry, workspace_tools


def _read_events(path: Path) -> list[dict]:
    events = []
    for index, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        event["index"] = index
        events.append(event)
    return events


def _session_path(session_dir: Path, session_id: str) -> Path:
    try:
        UUID(session_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Invalid session id") from exc
    path = session_dir / f"{session_id}.jsonl"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Session not found")
    return path


def _session_summary(path: Path) -> dict | None:
    events = _read_events(path)
    metadata = next((event for event in events if event.get("type") == "session"), None)
    if not metadata:
        return None
    preview = next(
        (event["item"].get("content", "") for event in events if event.get("type") == "item" and event.get("item", {}).get("role") == "user"),
        "",
    )
    return {
        "id": metadata.get("id", path.stem),
        "workspace": metadata.get("workspace", ""),
        "created_at": metadata.get("created_at", ""),
        "updated_at": path.stat().st_mtime,
        "preview": preview,
        "event_count": len(events),
    }


def create_app(session_dir: Path | None = None, workspace: Path | None = None) -> FastAPI:
    session_dir = (session_dir or Path.home() / ".pycodex" / "sessions").expanduser()
    workspace = (workspace or Path.cwd()).resolve()
    static_dir = Path(__file__).parent / "static"
    app = FastAPI(title="PyCodex", docs_url=None, redoc_url=None)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:3001", "http://localhost:3001"],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.mount("/assets", StaticFiles(directory=static_dir), name="assets")
    pending_approvals: dict[str, asyncio.Future[bool]] = {}
    running_sessions: set[str] = set()

    async def run_chat(session: JsonlSession, message: str) -> None:
        instructions = load_instructions(session.workspace)
        history = list(session.history)
        if history and history[0].get("role") == "system":
            history[0] = {"role": "system", "content": instructions}
        else:
            history.insert(0, {"role": "system", "content": instructions})

        async def approve(tool: Tool, arguments: dict) -> bool:
            approval_id = str(uuid4())
            future: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
            pending_approvals[approval_id] = future
            session.append_event("approval_requested", {
                "approval_id": approval_id,
                "name": tool.name,
                "arguments": arguments,
            })
            try:
                return await future
            finally:
                pending_approvals.pop(approval_id, None)

        def record_event(event: str, data: dict) -> None:
            session.append_event(event, data)

        try:
            config = DeepSeekConfig.from_claude_settings()
            agent = Agent(
                OpenAIChatModel(**config.__dict__),
                ToolRegistry(workspace_tools(session.workspace)),
                instructions=instructions,
                approve=approve,
                history=history,
                history_sink=session.append,
                on_event=record_event,
                compaction_sink=session.replace_history,
            )
            await agent.run(message)
        except Exception as exc:
            session.append_event("turn_failed", {"error": str(exc)})
        finally:
            running_sessions.discard(session.session_id)

    @app.get("/api/sessions")
    def list_sessions() -> list[dict]:
        if not session_dir.is_dir():
            return []
        sessions = [summary for path in session_dir.glob("*.jsonl") if (summary := _session_summary(path))]
        return sorted(sessions, key=lambda item: item["updated_at"], reverse=True)

    @app.get("/api/sessions/{session_id}")
    def get_session(session_id: str) -> dict:
        events = _read_events(_session_path(session_dir, session_id))
        metadata = next((event for event in events if event.get("type") == "session"), {})
        return {"metadata": metadata, "events": events}

    @app.get("/api/sessions/{session_id}/events")
    async def stream_events(session_id: str, after: int = -1) -> StreamingResponse:
        path = _session_path(session_dir, session_id)

        async def event_stream():
            index = after
            for event in _read_events(path):
                if event["index"] > index:
                    index = event["index"]
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            position = path.stat().st_size
            while True:
                await asyncio.sleep(0.25)
                with path.open("r", encoding="utf-8") as file:
                    file.seek(position)
                    lines = file.readlines()
                    position = file.tell()
                for line in lines:
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    index += 1
                    event["index"] = index
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @app.post("/api/chat")
    async def chat(payload: dict) -> dict:
        message = payload.get("message")
        session_id = payload.get("session_id")
        if not isinstance(message, str) or not message.strip():
            raise HTTPException(status_code=422, detail="message must be a non-empty string")
        if session_id is not None and not isinstance(session_id, str):
            raise HTTPException(status_code=422, detail="session_id must be a string")
        try:
            session = JsonlSession.load(session_dir, session_id) if session_id else JsonlSession.create(
                session_dir, instructions=load_instructions(workspace), workspace=workspace,
            )
        except (FileNotFoundError, ValueError) as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        if session.workspace.resolve() != workspace:
            raise HTTPException(status_code=409, detail="session belongs to another workspace")
        if session.session_id in running_sessions:
            raise HTTPException(status_code=409, detail="session is already running")
        running_sessions.add(session.session_id)
        asyncio.create_task(run_chat(session, message.strip()))
        return {"session_id": session.session_id}

    @app.post("/api/sessions/{session_id}/approvals/{approval_id}")
    async def resolve_approval(session_id: str, approval_id: str, payload: dict) -> dict:
        _session_path(session_dir, session_id)
        allowed = payload.get("allowed")
        if not isinstance(allowed, bool):
            raise HTTPException(status_code=422, detail="allowed must be a boolean")
        future = pending_approvals.get(approval_id)
        if future is None or future.done():
            raise HTTPException(status_code=404, detail="approval not found")
        future.set_result(allowed)
        return {"ok": True}

    @app.get("/")
    def chat_page() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    @app.get("/trace")
    def dashboard() -> FileResponse:
        return FileResponse(static_dir / "trace.html")

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Browse PyCodex agent traces")
    parser.add_argument("--session-dir", type=Path, default=Path.home() / ".pycodex" / "sessions")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--workspace", type=Path, default=Path.cwd(), help="workspace exposed to the web agent")
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(create_app(args.session_dir, args.workspace), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
