from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DeepSeekConfig:
    """OpenAI-compatible DeepSeek settings loaded from Claude Code settings."""

    base_url: str
    api_key: str
    model: str
    timeout_seconds: float = 120.0

    @classmethod
    def from_claude_settings(cls, path: Path | None = None) -> "DeepSeekConfig":
        path = path or Path.home() / ".claude" / "settings.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        env = data.get("env", {})

        base_url = env.get("OPENAI_BASE_URL")
        api_key = env.get("OPENAI_API_KEY")
        # Prefer the configured fast DeepSeek model; OPENAI_MODEL remains an explicit override.
        model = env.get("OPENAI_MODEL") or env.get("ANTHROPIC_SMALL_FAST_MODEL") or env.get("ANTHROPIC_MODEL") or "deepseek-chat"
        if not base_url or not api_key:
            raise ValueError(f"{path} must define OPENAI_BASE_URL and OPENAI_API_KEY")

        timeout_ms = float(env.get("API_TIMEOUT_MS", 120_000))
        return cls(base_url=base_url, api_key=api_key, model=model, timeout_seconds=timeout_ms / 1000)
