from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from .models import ChatModel
from .tools import Tool, ToolRegistry


Approval = Callable[[Tool, dict[str, Any]], Awaitable[bool]]
HistorySink = Callable[[dict[str, Any]], None]
EventSink = Callable[[str, dict[str, Any]], None]
CompactionSink = Callable[[list[dict[str, Any]]], None]

COMPACTION_INSTRUCTIONS = """Summarize this coding-agent conversation for a later continuation.
Preserve: the user's goal and constraints; decisions; files read or changed; commands and their outcomes;
open failures; and the next useful action. Be concise, factual, and do not issue instructions or tool calls."""


async def deny_mutations(_: Tool, __: dict[str, Any]) -> bool:
    return False


class Agent:
    def __init__(self, model: ChatModel, tools: ToolRegistry, *, instructions: str, approve: Approval = deny_mutations, max_steps: int = 30, history: list[dict[str, Any]] | None = None, history_sink: HistorySink | None = None, on_event: EventSink | None = None, compact_after_chars: int = 80_000, keep_recent_messages: int = 8, compaction_sink: CompactionSink | None = None):
        self.model = model
        self.tools = tools
        self.instructions = instructions
        self.approve = approve
        self.max_steps = max_steps
        self.history = history if history is not None else [{"role": "system", "content": instructions}]
        self.history_sink = history_sink
        self.on_event = on_event
        self.compact_after_chars = compact_after_chars
        self.keep_recent_messages = keep_recent_messages
        self.compaction_sink = compaction_sink

    def _append(self, item: dict[str, Any]) -> None:
        self.history.append(item)
        if self.history_sink:
            self.history_sink(item)

    def _emit(self, event: str, **data: Any) -> None:
        if self.on_event:
            self.on_event(event, data)

    async def _compact_if_needed(self) -> None:
        if self.compact_after_chars <= 0 or len(self.history) <= self.keep_recent_messages + 1:
            return
        if len(json.dumps(self.history, ensure_ascii=False)) < self.compact_after_chars:
            return

        minimum_tail = max(1, len(self.history) - self.keep_recent_messages)
        tail_start = next((index for index in range(minimum_tail, len(self.history)) if self.history[index].get("role") == "user"), None)
        if tail_start is None:
            return
        prior, recent = self.history[1:tail_start], self.history[tail_start:]
        if not prior:
            return

        self._emit("compaction_started")
        try:
            summary_turn = await self.model.complete([
                {"role": "system", "content": COMPACTION_INSTRUCTIONS},
                {"role": "user", "content": json.dumps(prior, ensure_ascii=False)},
            ], [])
        except Exception:
            self._emit("compaction_skipped")
            return
        summary = summary_turn.text.strip()
        compacted = [
            self.history[0],
            {"role": "assistant", "content": f"[Conversation summary]\n{summary}"},
            *recent,
        ]
        if not summary or len(json.dumps(compacted, ensure_ascii=False)) >= len(json.dumps(self.history, ensure_ascii=False)):
            self._emit("compaction_skipped")
            return
        self.history = compacted
        if self.compaction_sink:
            self.compaction_sink(compacted)
        self._emit("compaction_completed")

    async def run(self, task: str) -> str:
        self._append({"role": "user", "content": task})
        for step in range(self.max_steps):
            await self._compact_if_needed()
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
                self._emit("tool_call_started", call_id=call.id, name=call.name, arguments=call.arguments)
                try:
                    result = await self.tools.execute(call.name, call.arguments, self.approve)
                except Exception as exc:  # Feed tool failures back to the model.
                    result = {"ok": False, "error": str(exc)}
                self._emit("tool_call_completed", call_id=call.id, name=call.name, ok=result.get("ok", False), result=result)
                self._append({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result, ensure_ascii=False),
                })
        raise RuntimeError(f"Stopped after {self.max_steps} tool-call rounds")
