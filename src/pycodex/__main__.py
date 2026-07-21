from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from .agent import Agent
from .config import DeepSeekConfig
from .models import OpenAIChatModel
from .session import JsonlSession
from .tools import Tool, ToolRegistry, workspace_tools


async def console_approval(tool: Tool, arguments: dict) -> bool:
    prompt = f"Allow {tool.name} with {arguments}? [y/N] "
    return input(prompt).strip().lower() in {"y", "yes"}


async def allow_all(_: Tool, __: dict) -> bool:
    return True


def print_status(event: str, data: dict) -> None:
    if event == "model_request_started":
        message = "思考中…"
    elif event == "tool_call_started":
        command = data["arguments"].get("argv")
        detail = " ".join(command) if command else ""
        message = f"调用工具：{data['name']}" + (f" ({detail})" if detail else "")
    elif event == "tool_call_completed":
        message = f"工具完成：{data['name']}" if data["ok"] else f"工具失败：{data['name']}"
    elif event == "compaction_started":
        message = "正在压缩较早的会话历史…"
    elif event == "compaction_completed":
        message = "会话历史压缩完成"
    elif event == "turn_completed":
        message = "回答完成"
    else:
        return
    print(f"status> {message}", file=sys.stderr)


def record_status(session: JsonlSession, event: str, data: dict) -> None:
    session.append_event(event, data)
    print_status(event, data)


async def run(args: argparse.Namespace) -> None:
    config = DeepSeekConfig.from_claude_settings()
    model = OpenAIChatModel(**config.__dict__)
    session = JsonlSession.load(args.session_dir, args.resume) if args.resume else None
    workspace = args.workspace or (session.workspace if session else Path.cwd())
    if session and workspace.resolve() != session.workspace.resolve():
        raise ValueError("--workspace must match the workspace stored in the resumed session")
    session = session or JsonlSession.create(
        args.session_dir,
        instructions="You are a careful coding agent. Inspect before editing and run focused checks after edits.",
        workspace=workspace,
    )
    registry = ToolRegistry(workspace_tools(workspace))
    agent = Agent(
        model,
        registry,
        instructions="You are a careful coding agent. Inspect before editing and run focused checks after edits.",
        approve=allow_all if args.full_auto else console_approval,
        history=list(session.history),
        history_sink=session.append,
        on_event=lambda event, data: record_status(session, event, data),
        compact_after_chars=args.compact_after_chars,
        compaction_sink=session.replace_history,
    )
    print(f"Session: {session.session_id}")
    if args.interactive:
        while True:
            try:
                task = input("you> ").strip()
            except EOFError:
                print()
                break
            if task in {"/exit", "/quit"}:
                break
            if task:
                print(f"agent> {await agent.run(task)}")
        return
    print(await agent.run(args.task))


def main() -> None:
    parser = argparse.ArgumentParser(description="Headless DeepSeek coding agent")
    parser.add_argument("task", nargs="?")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--interactive", action="store_true", help="continue a local conversation until /exit")
    parser.add_argument("--resume", metavar="SESSION_ID", help="resume a saved session")
    parser.add_argument("--session-dir", type=Path, default=Path.home() / ".pycodex" / "sessions")
    parser.add_argument("--compact-after-chars", type=int, default=80_000, help="compact history after this estimated size; 0 disables it")
    parser.add_argument(
        "--full-auto",
        action="store_true",
        help="allow built-in write and command tools without asking",
    )
    args = parser.parse_args()
    if not args.interactive and not args.task:
        parser.error("task is required unless --interactive is used")
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
