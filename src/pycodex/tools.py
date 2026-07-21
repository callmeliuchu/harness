from __future__ import annotations

import asyncio
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable


class ToolError(Exception):
    pass


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[[dict[str, Any]], Awaitable[dict[str, Any]]]
    readonly: bool = False

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


class ToolRegistry:
    def __init__(self, tools: list[Tool]):
        self._tools = {tool.name: tool for tool in tools}

    def schemas(self) -> list[dict[str, Any]]:
        return [tool.schema() for tool in self._tools.values()]

    async def execute(self, name: str, arguments: dict[str, Any], approve: Callable[[Tool, dict[str, Any]], Awaitable[bool]]) -> dict[str, Any]:
        tool = self._tools.get(name)
        if not tool:
            raise ToolError(f"Unknown tool: {name}")
        if not tool.readonly and not await approve(tool, arguments):
            return {"ok": False, "error": "Operation denied by policy"}
        return await tool.handler(arguments)


def _workspace_path(root: Path, requested: str) -> Path:
    root = root.resolve()
    path = (root / requested).resolve()
    if not path.is_relative_to(root):
        raise ToolError("Path escapes workspace")
    return path


def workspace_tools(root: Path) -> list[Tool]:
    root = root.resolve()

    async def list_files(args: dict[str, Any]) -> dict[str, Any]:
        relative = args.get("path", ".")
        directory = _workspace_path(root, relative)
        if not directory.is_dir():
            raise ToolError(f"Not a directory: {relative}")
        files = [str(item.relative_to(root)) for item in directory.rglob("*") if item.is_file() and ".git" not in item.parts]
        return {"ok": True, "files": files[:500], "truncated": len(files) > 500}

    async def read_file(args: dict[str, Any]) -> dict[str, Any]:
        path = _workspace_path(root, args["path"])
        if not path.is_file():
            raise ToolError(f"Not a file: {args['path']}")
        content = path.read_text(encoding="utf-8", errors="replace")
        limit = 50_000
        return {"ok": True, "content": content[:limit], "truncated": len(content) > limit}

    async def search_text(args: dict[str, Any]) -> dict[str, Any]:
        query = args["query"]
        if not isinstance(query, str) or not query:
            raise ToolError("query must be a non-empty string")
        path = _workspace_path(root, args.get("path", "."))
        max_results = min(max(int(args.get("max_results", 50)), 1), 200)
        relative = str(path.relative_to(root)) or "."
        process = await asyncio.create_subprocess_exec(
            "rg", "--json", "--line-number", "--column", "--context", "2",
            "--max-count", str(max_results), "--glob", "!.git", query, relative,
            cwd=root,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate()
        if process.returncode not in {0, 1}:
            raise ToolError(stderr.decode(errors="replace").strip() or "rg failed")

        files: dict[str, list[dict[str, Any]]] = {}
        matches: list[dict[str, Any]] = []
        for line in stdout.decode(errors="replace").splitlines():
            event = json.loads(line)
            if event.get("type") not in {"match", "context"}:
                continue
            data = event["data"]
            raw_path = data["path"].get("text", "")
            file_path = str((root / raw_path).resolve().relative_to(root))
            record = {
                "line": data.get("line_number"),
                "text": data["lines"].get("text", "").rstrip("\n"),
                "match": event["type"] == "match",
            }
            files.setdefault(file_path, []).append(record)
            if record["match"]:
                submatches = data.get("submatches", [])
                matches.append({
                    "path": file_path,
                    "line": record["line"],
                    "column": submatches[0]["start"] + 1 if submatches else None,
                    "text": record["text"],
                })

        for match in matches:
            match["context"] = [
                line for line in files[match["path"]]
                if abs(line["line"] - match["line"]) <= 2
            ]
        return {"ok": True, "query": query, "matches": matches, "truncated": len(matches) >= max_results}

    async def write_file(args: dict[str, Any]) -> dict[str, Any]:
        path = _workspace_path(root, args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"], encoding="utf-8")
        return {"ok": True, "path": str(path.relative_to(root))}

    async def apply_patch(args: dict[str, Any]) -> dict[str, Any]:
        patch = args["patch"]
        if not isinstance(patch, str) or not patch.strip():
            raise ToolError("patch must be a non-empty unified diff")
        paths = set()
        for line in patch.splitlines():
            if not line.startswith(("--- ", "+++ ")):
                continue
            candidate = line[4:].split("\t", 1)[0]
            if candidate == "/dev/null":
                continue
            if candidate.startswith(("a/", "b/")):
                candidate = candidate[2:]
            _workspace_path(root, candidate)
            paths.add(candidate)
        if not paths:
            raise ToolError("patch must contain --- and +++ file paths")

        temp_path = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".diff", delete=False) as file:
                file.write(patch)
                temp_path = file.name
            check = await asyncio.create_subprocess_exec(
                "git", "apply", "--check", "--no-index", temp_path,
                cwd=root, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await check.communicate()
            if check.returncode:
                return {"ok": False, "checked": False, "error": stderr.decode(errors="replace").strip()}
            if args.get("check_only", False):
                return {"ok": True, "checked": True, "applied": False, "paths": sorted(paths)}
            apply = await asyncio.create_subprocess_exec(
                "git", "apply", "--no-index", temp_path,
                cwd=root, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await apply.communicate()
            if apply.returncode:
                return {"ok": False, "checked": True, "applied": False, "error": stderr.decode(errors="replace").strip()}
            return {"ok": True, "checked": True, "applied": True, "paths": sorted(paths)}
        finally:
            if temp_path:
                Path(temp_path).unlink(missing_ok=True)

    async def run_command(args: dict[str, Any]) -> dict[str, Any]:
        argv = args["argv"]
        if not isinstance(argv, list) or not argv or not all(isinstance(item, str) for item in argv):
            raise ToolError("argv must be a non-empty list of strings")
        cwd = _workspace_path(root, args.get("cwd", "."))
        timeout = min(float(args.get("timeout_seconds", 30)), 120.0)
        process = await asyncio.create_subprocess_exec(
            *argv,
            cwd=cwd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        try:
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
        except TimeoutError:
            os.killpg(process.pid, 15)
            await process.wait()
            return {"ok": False, "error": f"Timed out after {timeout}s"}
        limit = 30_000
        return {
            "ok": process.returncode == 0,
            "exit_code": process.returncode,
            "stdout": stdout.decode(errors="replace")[:limit],
            "stderr": stderr.decode(errors="replace")[:limit],
        }

    object_schema = {"type": "object", "additionalProperties": False}
    return [
        Tool("list_files", "List files below a workspace directory.", object_schema | {"properties": {"path": {"type": "string"}}}, list_files, readonly=True),
        Tool("read_file", "Read a UTF-8 text file below the workspace.", object_schema | {"properties": {"path": {"type": "string"}}, "required": ["path"]}, read_file, readonly=True),
        Tool("search_text", "Search workspace text using ripgrep and return matches with line context.", object_schema | {"properties": {"query": {"type": "string"}, "path": {"type": "string"}, "max_results": {"type": "integer"}}, "required": ["query"]}, search_text, readonly=True),
        Tool("write_file", "Create or replace a UTF-8 text file below the workspace.", object_schema | {"properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}, write_file),
        Tool("apply_patch", "Validate then apply a unified diff within the workspace.", object_schema | {"properties": {"patch": {"type": "string"}, "check_only": {"type": "boolean"}}, "required": ["patch"]}, apply_patch),
        Tool("run_command", "Run an argv command inside the workspace; never pass a shell string.", object_schema | {"properties": {"argv": {"type": "array", "items": {"type": "string"}}, "cwd": {"type": "string"}, "timeout_seconds": {"type": "number"}}, "required": ["argv"]}, run_command),
    ]
