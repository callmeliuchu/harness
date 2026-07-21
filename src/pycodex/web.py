from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path
from uuid import UUID

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles


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


def create_app(session_dir: Path | None = None) -> FastAPI:
    session_dir = (session_dir or Path.home() / ".pycodex" / "sessions").expanduser()
    static_dir = Path(__file__).parent / "static"
    app = FastAPI(title="PyCodex Trace", docs_url=None, redoc_url=None)
    app.mount("/assets", StaticFiles(directory=static_dir), name="assets")

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

    @app.get("/")
    def dashboard() -> FileResponse:
        return FileResponse(static_dir / "index.html")

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Browse PyCodex agent traces")
    parser.add_argument("--session-dir", type=Path, default=Path.home() / ".pycodex" / "sessions")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(create_app(args.session_dir), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
