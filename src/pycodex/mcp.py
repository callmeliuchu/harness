from __future__ import annotations

import asyncio
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .tools import Tool, ToolError, ToolOutput


@dataclass(frozen=True)
class McpServerConfig:
    name: str
    command: str
    args: list[str]
    env: dict[str, str]


class StdioMcpClient:
    def __init__(self, config: McpServerConfig):
        self.config = config
        self.process: asyncio.subprocess.Process | None = None
        self._request_id = 0
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        self.process = await asyncio.create_subprocess_exec(
            self.config.command,
            *self.config.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            env={"PATH": os.environ.get("PATH", ""), **self.config.env},
        )
        await self.request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "pycodex", "version": "0.1.0"},
        })
        await self.notify("notifications/initialized")

    async def close(self) -> None:
        if not self.process or self.process.returncode is not None:
            return
        self.process.terminate()
        try:
            await asyncio.wait_for(self.process.wait(), timeout=2)
        except TimeoutError:
            self.process.kill()
            await self.process.wait()

    async def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, **({"params": params} if params else {})})

    async def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        async with self._lock:
            self._request_id += 1
            request_id = self._request_id
            await self._send({"jsonrpc": "2.0", "id": request_id, "method": method, **({"params": params} if params else {})})
            if not self.process or not self.process.stdout:
                raise ToolError(f"MCP server {self.config.name} is not running")
            while line := await self.process.stdout.readline():
                try:
                    response = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if response.get("id") != request_id:
                    continue
                if "error" in response:
                    raise ToolError(f"MCP {self.config.name}: {response['error'].get('message', 'request failed')}")
                return response.get("result", {})
            raise ToolError(f"MCP server {self.config.name} closed its output")

    async def _send(self, message: dict[str, Any]) -> None:
        if not self.process or not self.process.stdin:
            raise ToolError(f"MCP server {self.config.name} is not running")
        self.process.stdin.write((json.dumps(message) + "\n").encode())
        await self.process.stdin.drain()


class McpManager:
    def __init__(self, configs: list[McpServerConfig]):
        self.clients = [StdioMcpClient(config) for config in configs]
        self._tools: list[Tool] = []

    @classmethod
    def from_config(cls, path: Path) -> "McpManager":
        data = json.loads(path.read_text(encoding="utf-8"))
        servers = data.get("mcpServers")
        if not isinstance(servers, dict):
            raise ValueError("MCP config requires an mcpServers object")
        configs = []
        for name, item in servers.items():
            if not isinstance(name, str) or not isinstance(item, dict) or not isinstance(item.get("command"), str):
                raise ValueError("each MCP server needs a name and command")
            args = item.get("args", [])
            env = item.get("env", {})
            if not isinstance(args, list) or not all(isinstance(arg, str) for arg in args):
                raise ValueError(f"MCP server {name} args must be a list of strings")
            if not isinstance(env, dict) or not all(isinstance(key, str) and isinstance(value, str) for key, value in env.items()):
                raise ValueError(f"MCP server {name} env must map strings to strings")
            resolved_env = {}
            for key, value in env.items():
                match = re.fullmatch(r"\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}", value)
                if match:
                    variable = match.group(1)
                    if variable not in os.environ:
                        raise ValueError(f"MCP server {name} requires environment variable {variable}")
                    resolved_env[key] = os.environ[variable]
                else:
                    resolved_env[key] = value
            configs.append(McpServerConfig(name, item["command"], args, resolved_env))
        return cls(configs)

    async def start(self) -> None:
        try:
            for client in self.clients:
                await client.start()
                tools = await client.request("tools/list")
                for definition in tools.get("tools", []):
                    self._tools.append(self._tool_for(client, definition))
        except Exception:
            await self.close()
            raise

    async def close(self) -> None:
        await asyncio.gather(*(client.close() for client in self.clients), return_exceptions=True)

    def tools(self) -> list[Tool]:
        return list(self._tools)

    def _tool_for(self, client: StdioMcpClient, definition: dict[str, Any]) -> Tool:
        name = definition.get("name")
        if not isinstance(name, str):
            raise ValueError(f"MCP server {client.config.name} returned a tool without a name")
        safe_name = re.sub(r"[^a-zA-Z0-9_]", "_", name)
        tool_name = f"mcp_{re.sub(r'[^a-zA-Z0-9_]', '_', client.config.name)}_{safe_name}"
        parameters = definition.get("inputSchema")
        if not isinstance(parameters, dict):
            parameters = {"type": "object", "properties": {}}

        async def call(arguments: dict[str, Any], _: ToolOutput | None = None) -> dict[str, Any]:
            result = await client.request("tools/call", {"name": name, "arguments": arguments})
            return {
                "ok": not result.get("isError", False),
                "content": result.get("content", []),
                "structured_content": result.get("structuredContent"),
            }

        description = definition.get("description", "")
        return Tool(tool_name, f"MCP {client.config.name}/{name}: {description}", parameters, call)
