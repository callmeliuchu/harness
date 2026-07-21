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

        if not metadata or not history:
            raise ValueError(f"Session is incomplete: {session_id}")
        return cls(session_id, path, history, Path(metadata["workspace"]))

    def append(self, item: dict) -> None:
        self.history.append(item)
        self._write({"type": "item", "item": item})

    def _write(self, event: dict) -> None:
        with self.path.open("a", encoding="utf-8") as file:
            file.write(json.dumps(event, ensure_ascii=False) + "\n")
