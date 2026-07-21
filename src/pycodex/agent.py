from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from .models import ChatModel
from .tools import Tool, ToolRegistry


Approval = Callable[[Tool, dict[str, Any]], Awaitable[bool]]
HistorySink = Callable[[dict[str, Any]], None]
EventSink = Callable[[str, dict[str, Any]], None]


async def deny_mutations(_: Tool, __: dict[str, Any]) -> bool:
    return False


class Agent:
    def __init__(self, model: ChatModel, tools: ToolRegistry, *, instructions: str, approve: Approval = deny_mutations, max_steps: int = 30, history: list[dict[str, Any]] | None = None, history_sink: HistorySink | None = None, on_event: EventSink | None = None):
        self.model = model
        self.tools = tools
        self.instructions = instructions
        self.approve = approve
        self.max_steps = max_steps
        self.history = history if history is not None else [{"role": "system", "content": instructions}]
        self.history_sink = history_sink
        self.on_event = on_event

    def _append(self, item: dict[str, Any]) -> None:
        self.history.append(item)
        if self.history_sink:
            self.history_sink(item)

    def _emit(self, event: str, **data: Any) -> None:
        if self.on_event:
            self.on_event(event, data)

    async def run(self, task: str) -> str:
        self._append({"role": "user", "content": task})
        for step in range(self.max_steps):
            self._emit("model_request_started", step=step + 1)
            turn = await self.model.complete(self.history, self.tools.schemas())
            self._emit("model_request_completed", step=step + 1)
            if not turn.tool_calls:
                self._append({"role": "assistant", "content": turn.text})
                self._emit("turn_completed")
                return turn.text

            self._append({
                "role": "assistant",
                "content": turn.text or None,
                "tool_calls": [{
                    "id": call.id,
                    "type": "function",
                    "function": {"name": call.name, "arguments": json.dumps(call.arguments)},
                } for call in turn.tool_calls],
            })
            for call in turn.tool_calls:
                self._emit("tool_call_started", name=call.name, arguments=call.arguments)
                try:
                    result = await self.tools.execute(call.name, call.arguments, self.approve)
                except Exception as exc:  # Feed tool failures back to the model.
                    result = {"ok": False, "error": str(exc)}
                self._emit("tool_call_completed", name=call.name, ok=result.get("ok", False))
                self._append({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })
        raise RuntimeError(f"Stopped after {self.max_steps} tool-call rounds")
