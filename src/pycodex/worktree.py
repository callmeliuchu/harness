from __future__ import annotations

import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ParallelTask:
    name: str
    task: str


def prepare_worktree(workspace: Path, name: str) -> Path:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name):
        raise ValueError("worktree name must contain only letters, numbers, _ or -")
    repo = _git(workspace, "rev-parse", "--show-toplevel").strip()
    root = Path(repo).resolve()
    location = root.parent / f".{root.name}-pycodex-worktrees" / name
    branch = f"pycodex/{name}"
    if location.exists():
        existing_root = Path(_git(location, "rev-parse", "--show-toplevel").strip()).resolve()
        if existing_root != location.resolve():
            raise ValueError(f"worktree location is not a Git worktree: {location}")
        return location
    location.parent.mkdir(parents=True, exist_ok=True)
    if _git_returncode(root, "show-ref", "--verify", "--quiet", f"refs/heads/{branch}") == 0:
        _git(root, "worktree", "add", str(location), branch)
    else:
        _git(root, "worktree", "add", "-b", branch, str(location), "HEAD")
    return location


def load_parallel_tasks(path: Path) -> list[ParallelTask]:
    data = json.loads(path.read_text(encoding="utf-8"))
    entries = data.get("tasks") if isinstance(data, dict) else None
    if not isinstance(entries, list) or not entries:
        raise ValueError("parallel task file requires a non-empty tasks array")
    tasks = []
    names = set()
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str) or not isinstance(entry.get("task"), str):
            raise ValueError("each parallel task requires name and task strings")
        if entry["name"] in names:
            raise ValueError(f"duplicate parallel task name: {entry['name']}")
        prepare_name(entry["name"])
        names.add(entry["name"])
        tasks.append(ParallelTask(entry["name"], entry["task"]))
    return tasks


def prepare_name(name: str) -> None:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", name):
        raise ValueError("parallel task names must contain only letters, numbers, _ or -")


def _git(cwd: Path, *args: str) -> str:
    process = subprocess.run(["git", *args], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if process.returncode:
        raise ValueError(process.stderr.strip() or "git command failed")
    return process.stdout


def _git_returncode(cwd: Path, *args: str) -> int:
    return subprocess.run(["git", *args], cwd=cwd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode
