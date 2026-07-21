from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from .agent import Agent
from .config import DeepSeekConfig
from .models import OpenAIChatModel
from .tools import Tool, ToolRegistry, workspace_tools


async def console_approval(tool: Tool, arguments: dict) -> bool:
    prompt = f"Allow {tool.name} with {arguments}? [y/N] "
    return input(prompt).strip().lower() in {"y", "yes"}


async def allow_all(_: Tool, __: dict) -> bool:
    return True


async def run(args: argparse.Namespace) -> None:
    config = DeepSeekConfig.from_claude_settings()
    model = OpenAIChatModel(**config.__dict__)
    registry = ToolRegistry(workspace_tools(args.workspace))
    agent = Agent(
        model,
        registry,
        instructions="You are a careful coding agent. Inspect before editing and run focused checks after edits.",
        approve=allow_all if args.full_auto else console_approval,
    )
    print(await agent.run(args.task))


def main() -> None:
    parser = argparse.ArgumentParser(description="Headless DeepSeek coding agent")
    parser.add_argument("task")
    parser.add_argument("--workspace", type=Path, default=Path.cwd())
    parser.add_argument(
        "--full-auto",
        action="store_true",
        help="allow built-in write and command tools without asking",
    )
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
