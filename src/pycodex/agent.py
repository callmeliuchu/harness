from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from .models import ChatModel
from .tools import Tool, ToolRegistry


Approval = Callable[[Tool, dict[str, Any]], Awaitable[bool]]


async def deny_mutations(_: Tool, __: dict[str, Any]) -> bool:
    return False


class Agent:
    def __init__(self, model: ChatModel, tools: ToolRegistry, *, instructions: str, approve: Approval = deny_mutations, max_steps: int = 30):
        self.model = model
        self.tools = tools
        self.instructions = instructions
        self.approve = approve
        self.max_steps = max_steps
        self.history: list[dict[str, Any]] = [{"role": "system", "content": instructions}]

    async def run(self, task: str) -> str:
        self.history.append({"role": "user", "content": task})
        for _ in range(self.max_steps):
            turn = await self.model.complete(self.history, self.tools.schemas())
            if not turn.tool_calls:
                self.history.append({"role": "assistant", "content": turn.text})
                return turn.text

            self.history.append({
                "role": "assistant",
                "content": turn.text or None,
                "tool_calls": [{
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                } for call in turn.tool_calls],
            })
            for call in turn.tool_calls:
                try:
                    result = await self.tools.execute(call.name, call.arguments, self.approve)
                except Exception as exc:  # Feed tool failures back to the model.
                    result = {"ok": False, "error": str(exc)}
                self.history.append({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })
        raise RuntimeError(f"Stopped after {self.max_steps} tool-call rounds")
