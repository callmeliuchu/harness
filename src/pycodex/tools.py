from __future__ import annotations

import asyncio
import os
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

    async def write_file(args: dict[str, Any]) -> dict[str, Any]:
        path = _workspace_path(root, args["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(args["content"], encoding="utf-8")
        return {"ok": True, "path": str(path.relative_to(root))}

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
        Tool("write_file", "Create or replace a UTF-8 text file below the workspace.", object_schema | {"properties": {"path": {"type": "string"}, "content": {"type": "string"}}, "required": ["path", "content"]}, write_file),
        Tool("run_command", "Run an argv command inside the workspace; never pass a shell string.", object_schema | {"properties": {"argv": {"type": "array", "items": {"type": "string"}}, "cwd": {"type": "string"}, "timeout_seconds": {"type": "number"}}, "required": ["argv"]}, run_command),
    ]
