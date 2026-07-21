from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4


@dataclass
class JsonlSession:
    """Append-only local history for one agent conversation."""

    session_id: str
    path: Path
    history: list[dict]
    workspace: Path

    @classmethod
    def create(cls, directory: Path, *, instructions: str, workspace: Path) -> "JsonlSession":
        directory.mkdir(parents=True, exist_ok=True)
        session_id = str(uuid4())
        path = directory / f"{session_id}.jsonl"
        session = cls(session_id, path, [], workspace.resolve())
        session._write({
            "type": "session",
            "version": 1,
            "id": session_id,
            "workspace": str(session.workspace),
            "created_at": datetime.now(UTC).isoformat(),
        })
        session.append({"role": "system", "content": instructions})
        return session

    @classmethod
    def load(cls, directory: Path, session_id: str) -> "JsonlSession":
        try:
            UUID(session_id)
        except ValueError as exc:
            raise ValueError("session id must be a UUID") from exc

        path = directory / f"{session_id}.jsonl"
        if not path.is_file():
            raise FileNotFoundError(f"Session not found: {session_id}")

        metadata = None
        history = []
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            try:
                event = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid session JSON at line {line_number}") from exc
            if event.get("type") == "session":
                metadata = event
            elif event.get("type") == "item" and isinstance(event.get("item"), dict):
                history.append(event["item"])
            elif event.get("type") == "compaction" and isinstance(event.get("history"), list):
                history = event["history"]

        if not metadata or not history:
            raise ValueError(f"Session is incomplete: {session_id}")
        return cls(session_id, path, history, Path(metadata["workspace"]))

    def append(self, item: dict) -> None:
        self.history.append(item)
        self._write({"type": "item", "at": datetime.now(UTC).isoformat(), "item": item})

    def append_event(self, event: str, data: dict) -> None:
        self._write({"type": "agent_event", "at": datetime.now(UTC).isoformat(), "event": event, "data": data})

    def replace_history(self, history: list[dict]) -> None:
        """Persist a compacted model context while retaining prior JSONL events."""
        self.history = list(history)
        self._write({"type": "compaction", "at": datetime.now(UTC).isoformat(), "history": self.history})

    def fork(self, directory: Path) -> "JsonlSession":
        """Create an independent session from the current model-visible history."""
        instructions = self.history[0].get("content", "") if self.history else ""
        fork = self.create(directory, instructions=instructions, workspace=self.workspace)
        for item in self.history[1:]:
            fork.append(item)
        fork.append_event("session_forked", {"source_session_id": self.session_id})
        return fork

    def _write(self, event: dict) -> None:
        with self.path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False) + "\n")


def session_events(directory: Path, session_id: str) -> list[dict]:
    path = directory / f"{session_id}.jsonl"
    if not path.is_file():
        raise FileNotFoundError(f"Session not found: {session_id}")
    events = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid session JSON at line {line_number}") from exc
    return events


def list_sessions(directory: Path) -> list[dict]:
    if not directory.is_dir():
        return []
    summaries = []
    for path in directory.glob("*.jsonl"):
        try:
            events = session_events(directory, path.stem)
        except ValueError:
            continue
        metadata = next((event for event in events if event.get("type") == "session"), None)
        if not metadata:
            continue
        first_task = next(
            (event["item"].get("content", "") for event in events if event.get("type") == "item" and event.get("item", {}).get("role") == "user"),
            "",
        )
        summaries.append({
            "id": metadata.get("id", path.stem),
            "workspace": metadata.get("workspace", ""),
            "created_at": metadata.get("created_at", ""),
            "preview": first_task,
            "event_count": len(events),
            "updated_at": path.stat().st_mtime,
        })
    return sorted(summaries, key=lambda item: item["updated_at"], reverse=True)
