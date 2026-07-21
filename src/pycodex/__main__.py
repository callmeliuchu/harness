from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from .agent import Agent
from .config import DeepSeekConfig
from .models import OpenAIChatModel
from .mcp import McpManager
from .session import JsonlSession, list_sessions, session_events
from .tools import Tool, ToolRegistry, workspace_tools
from .worktree import load_parallel_tasks, prepare_worktree


BASE_INSTRUCTIONS = "You are a careful coding agent. Inspect before editing and run focused checks after edits. In Git repositories, call git_status before changing files and git_diff after changing files so you can avoid unrelated worktree changes and verify your patch."


def load_instructions(workspace: Path) -> str:
    """Combine the built-in agent guidance with an optional repository AGENTS.md."""
    workspace = workspace.resolve()
    path = workspace / "AGENTS.md"
    if not path.is_file() or not path.resolve().is_relative_to(workspace):
        return BASE_INSTRUCTIONS
    guidance = path.read_text(encoding="utf-8", errors="replace").strip()
    if not guidance:
        return BASE_INSTRUCTIONS
    return f"{BASE_INSTRUCTIONS}\n\n# Repository instructions (AGENTS.md)\n{guidance[:50_000]}"


async def console_approval(tool: Tool, arguments: dict) -> bool:
    prompt = f"Allow {tool.name} with {arguments}? [y/N] "
    return input(prompt).strip().lower() in {"y", "yes"}


def approval_for(mode: str):
    async def approve(tool: Tool, arguments: dict) -> bool:
        if mode == "full-auto":
            return True
        if mode == "workspace" and tool.name in {"write_file", "apply_patch"}:
            return True
        return await console_approval(tool, arguments)

    return approve


def print_status(event: str, data: dict) -> None:
    if event == "model_request_started":
        message = "思考中…"
    elif event == "tool_call_started":
        command = data["arguments"].get("argv")
        detail = " ".join(command) if command else ""
        message = f"调用工具：{data['name']}" + (f" ({detail})" if detail else "")
    elif event == "tool_call_completed":
        message = f"工具完成：{data['name']}" if data["ok"] else f"工具失败：{data['name']}"
    elif event == "tool_call_cancelled":
        message = f"工具已取消：{data['name']}"
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


class ConsoleEvents:
    """Persist events and render streamed model text without duplicating the final reply."""

    def __init__(self, session: JsonlSession):
        self.session = session
        self.streamed_text = False
        self._line_open = False

    def __call__(self, event: str, data: dict) -> None:
        self.session.append_event(event, data)
        if event == "model_text_delta":
            if not self._line_open:
                print("agent> ", end="", flush=True)
                self._line_open = True
            print(data["text"], end="", flush=True)
            self.streamed_text = True
            return
        if event == "tool_output":
            if self._line_open:
                print()
                self._line_open = False
            stream = data["stream"]
            if stream == "notice":
                print(f"status> {data['text']}", file=sys.stderr)
            else:
                text = data["text"]
                suffix = "" if text.endswith("\n") else "\n"
                print(f"{data['name']} {stream}> {text}", end=suffix, file=sys.stderr, flush=True)
            return
        if self._line_open:
            print()
            self._line_open = False
        print_status(event, data)


async def run(args: argparse.Namespace) -> None:
    if args.list_sessions:
        for item in list_sessions(args.session_dir):
            preview = item["preview"].replace("\n", " ")[:80]
            print(f"{item['id']}  {item['event_count']} events  {item['workspace']}\n  {preview}")
        return
    if args.show_session:
        for event in session_events(args.session_dir, args.show_session):
            print(json.dumps(event, ensure_ascii=False, indent=2))
        return
    if args.fork:
        source = JsonlSession.load(args.session_dir, args.fork)
        fork = source.fork(args.session_dir)
        print(f"Forked session: {fork.session_id}")
        return
    if args.parallel:
        await run_parallel(args)
        return
    config = DeepSeekConfig.from_claude_settings()
    model = OpenAIChatModel(**config.__dict__)
    session = JsonlSession.load(args.session_dir, args.resume) if args.resume else None
    workspace = args.workspace or (session.workspace if session else Path.cwd())
    if session and workspace.resolve() != session.workspace.resolve():
        raise ValueError("--workspace must match the workspace stored in the resumed session")
    if args.worktree:
        workspace = prepare_worktree(workspace, args.worktree)
    instructions = load_instructions(workspace)
    session = session or JsonlSession.create(
        args.session_dir,
        instructions=instructions,
        workspace=workspace,
    )
    history = list(session.history)
    if history and history[0].get("role") == "system":
        history[0] = {"role": "system", "content": instructions}
    else:
        history.insert(0, {"role": "system", "content": instructions})
    mcp = McpManager.from_config(args.mcp_config) if args.mcp_config else None
    if mcp:
        await mcp.start()
    registry = ToolRegistry([*workspace_tools(workspace), *(mcp.tools() if mcp else [])])
    console_events = ConsoleEvents(session)
    agent = Agent(
        model,
        registry,
        instructions=instructions,
        approve=approval_for(args.approval),
        history=history,
        history_sink=session.append,
        on_event=console_events,
        compact_after_chars=args.compact_after_chars,
        compaction_sink=session.replace_history,
    )
    try:
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
                    reply = await agent.run(task)
                    if not console_events.streamed_text:
                        print(f"agent> {reply}")
                    console_events.streamed_text = False
            return
        reply = await agent.run(args.task)
        if not console_events.streamed_text:
            print(reply)
    finally:
        if mcp:
            await mcp.close()


async def run_parallel(args: argparse.Namespace) -> None:
    workspace = (args.workspace or Path.cwd()).resolve()
    tasks = load_parallel_tasks(args.parallel)
    commands = []
    for task in tasks:
        worktree = prepare_worktree(workspace, task.name)
        command = [sys.executable, "-m", "pycodex", "--workspace", str(worktree), "--approval", args.approval, "--session-dir", str(args.session_dir)]
        if args.mcp_config:
            command.extend(["--mcp-config", str(args.mcp_config)])
        command.append(task.task)
        commands.append((task, worktree, command))
        print(f"agent {task.name}> worktree {worktree}")
    processes = [
        asyncio.create_subprocess_exec(*command, stdin=asyncio.subprocess.DEVNULL)
        for _, _, command in commands
    ]
    results = await asyncio.gather(*processes)
    failed = [task.name for (task, _, _), process in zip(commands, results, strict=True) if process.returncode]
    if failed:
        raise RuntimeError(f"parallel agents failed: {', '.join(failed)}")
    print(f"Completed {len(commands)} parallel agents.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Headless DeepSeek coding agent")
    parser.add_argument("task", nargs="?")
    parser.add_argument("--workspace", type=Path)
    parser.add_argument("--interactive", action="store_true", help="continue a local conversation until /exit")
    parser.add_argument("--resume", metavar="SESSION_ID", help="resume a saved session")
    parser.add_argument("--worktree", metavar="NAME", help="run this agent in an isolated Git worktree")
    parser.add_argument("--parallel", type=Path, metavar="TASKS_JSON", help="run independent tasks concurrently in isolated worktrees")
    parser.add_argument("--mcp-config", type=Path, help="JSON config for stdio MCP servers")
    management = parser.add_mutually_exclusive_group()
    management.add_argument("--list-sessions", action="store_true", help="list saved sessions")
    management.add_argument("--show-session", metavar="SESSION_ID", help="print a saved session's JSONL events")
    management.add_argument("--fork", metavar="SESSION_ID", help="fork a saved session's current context")
    parser.add_argument("--session-dir", type=Path, default=Path.home() / ".pycodex" / "sessions")
    parser.add_argument("--compact-after-chars", type=int, default=80_000, help="compact history after this estimated size; 0 disables it")
    parser.add_argument(
        "--approval",
        choices=("ask", "workspace", "full-auto"),
        default="ask",
        help="permission profile: ask (default), workspace, or full-auto",
    )
    parser.add_argument(
        "--full-auto",
        action="store_true",
        help="legacy alias for --approval full-auto",
    )
    args = parser.parse_args()
    managing = args.list_sessions or args.show_session or args.fork
    if managing and (args.interactive or args.task or args.resume or args.worktree or args.parallel):
        parser.error("session management options cannot be combined with a task, --interactive, or --resume")
    if args.parallel and (args.interactive or args.task or args.resume or args.worktree):
        parser.error("--parallel cannot be combined with a task, --interactive, --resume, or --worktree")
    if args.worktree and args.resume:
        parser.error("--worktree cannot be combined with --resume")
    if not managing and not args.parallel and not args.interactive and not args.task:
        parser.error("task is required unless --interactive is used")
    if args.full_auto and args.approval != "ask":
        parser.error("--full-auto cannot be combined with --approval")
    if args.full_auto:
        args.approval = "full-auto"
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        print("status> 已取消当前 Agent 操作", file=sys.stderr)


if __name__ == "__main__":
    main()
