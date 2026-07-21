from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Callable, Protocol


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True)
class ModelTurn:
    text: str
    tool_calls: list[ToolCall]


class ChatModel(Protocol):
    async def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn: ...


TextDeltaSink = Callable[[str], None]


class OpenAIChatModel:
    """Adapter for OpenAI-compatible Chat Completions APIs, including DeepSeek."""

    def __init__(self, *, base_url: str, api_key: str, model: str, timeout_seconds: float = 120.0):
        self.base_url = base_url
        self.api_key = api_key
        self.model = model
        self.timeout_seconds = timeout_seconds

    async def complete(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> ModelTurn:
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            base_url=self.base_url,
            api_key=self.api_key,
            timeout=self.timeout_seconds,
        )
        response = await client.chat.completions.create(
            model=self.model,
            messages=messages,
            tools=tools or None,
        )
        message = response.choices[0].message
        calls = []
        for call in message.tool_calls or []:
            try:
                arguments = json.loads(call.function.arguments)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON from tool {call.function.name}: {exc}") from exc
            calls.append(ToolCall(id=call.id, name=call.function.name, arguments=arguments))
        return ModelTurn(text=message.content or "", tool_calls=calls)

    async def complete_stream(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]], on_text_delta: TextDeltaSink) -> ModelTurn:
        """Stream text while accumulating the final Chat Completions turn."""
        from openai import AsyncOpenAI

        client = AsyncOpenAI(base_url=self.base_url, api_key=self.api_key, timeout=self.timeout_seconds)
        stream = await client.chat.completions.create(model=self.model, messages=messages, tools=tools or None, stream=True)
        text_parts: list[str] = []
        calls: dict[int, dict[str, str]] = {}
        async for chunk in stream:
            delta = chunk.choices[0].delta
            if delta.content:
                text_parts.append(delta.content)
                on_text_delta(delta.content)
            for call in delta.tool_calls or []:
                current = calls.setdefault(call.index, {"id": "", "name": "", "arguments": ""})
                current["id"] += call.id or ""
                if call.function:
                    current["name"] += call.function.name or ""
                    current["arguments"] += call.function.arguments or ""
        tool_calls = []
        for call in calls.values():
            try:
                arguments = json.loads(call["arguments"])
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON from tool {call['name']}: {exc}") from exc
            tool_calls.append(ToolCall(id=call["id"], name=call["name"], arguments=arguments))
        return ModelTurn(text="".join(text_parts), tool_calls=tool_calls)
