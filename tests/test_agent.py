import asyncio
import io
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
from pathlib import Path

from pycodex.agent import Agent
from pycodex.__main__ import BASE_INSTRUCTIONS, ConsoleEvents, approval_for, load_instructions
from pycodex.models import ModelTurn, ToolCall
from pycodex.session import JsonlSession, list_sessions, session_events
from pycodex.tools import ToolError, ToolRegistry, workspace_tools


class FakeModel:
    def __init__(self, turns):
        self.turns = iter(turns)

    async def complete(self, messages, tools):
        return next(self.turns)


class StreamingFakeModel(FakeModel):
    async def complete_stream(self, messages, tools, on_text_delta):
        turn = await self.complete(messages, tools)
        if turn.text:
            on_text_delta(turn.text)
        return turn


async def approve_all(*_):
    return True


class AgentTests(unittest.TestCase):
    def test_git_status_and_diff_are_read_only_tools(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            file = root / "notes.txt"
            file.write_text("old\n")
            subprocess.run(["git", "add", "notes.txt"], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"], cwd=root, check=True)
            file.write_text("new\n")
            registry = ToolRegistry(workspace_tools(root))
            status = asyncio.run(registry.execute("git_status", {}, approve_all))
            diff = asyncio.run(registry.execute("git_diff", {}, approve_all))
            self.assertTrue(status["ok"])
            self.assertIn("notes.txt", status["changes"][0])
            self.assertTrue(diff["ok"])
            self.assertIn("-old", diff["diff"])
            self.assertIn("+new", diff["diff"])

    def test_agent_captures_git_context_before_and_after_editing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / "notes.txt").write_text("old\n")
            subprocess.run(["git", "add", "notes.txt"], cwd=root, check=True)
            subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "initial"], cwd=root, check=True)
            model = FakeModel([
                ModelTurn("", [ToolCall("call_1", "write_file", {"path": "notes.txt", "content": "new\n"})]),
                ModelTurn("Completed", []),
            ])
            agent = Agent(model, ToolRegistry(workspace_tools(root)), instructions="test", approve=approve_all)
            self.assertEqual(asyncio.run(agent.run("update notes")), "Completed")
            contexts = [item["content"] for item in agent.history if item["role"] == "system"]
            self.assertTrue(any("working tree before" in item for item in contexts))
            self.assertTrue(any("diff after" in item and "+new" in item for item in contexts))

    def test_lists_shows_and_forks_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "sessions"
            source = JsonlSession.create(directory, instructions="test", workspace=Path(tmp))
            source.append({"role": "user", "content": "Inspect the tests"})
            source.append({"role": "assistant", "content": "I found one failure."})
            summaries = list_sessions(directory)
            self.assertEqual(summaries[0]["id"], source.session_id)
            self.assertEqual(summaries[0]["preview"], "Inspect the tests")
            self.assertEqual(session_events(directory, source.session_id)[0]["type"], "session")
            fork = source.fork(directory)
            self.assertNotEqual(fork.session_id, source.session_id)
            self.assertEqual(fork.history, source.history)
            self.assertEqual(session_events(directory, fork.session_id)[-1]["event"], "session_forked")

    def test_load_instructions_includes_root_agents_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            workspace = Path(tmp)
            (workspace / "AGENTS.md").write_text("Run focused tests.")
            self.assertEqual(
                load_instructions(workspace),
                f"{BASE_INSTRUCTIONS}\n\n# Repository instructions (AGENTS.md)\nRun focused tests.",
            )

    def test_load_instructions_uses_base_without_agents_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(load_instructions(Path(tmp)), BASE_INSTRUCTIONS)

    def test_console_events_prints_streamed_text_once(self):
        session = Mock()
        console = ConsoleEvents(session)
        with patch("sys.stdout", new_callable=io.StringIO) as stdout:
            console("model_text_delta", {"text": "Hello"})
            console("model_text_delta", {"text": " world"})
            console("model_request_completed", {"step": 1})
        self.assertEqual(stdout.getvalue(), "agent> Hello world\n")
        self.assertTrue(console.streamed_text)
        self.assertEqual(session.append_event.call_count, 3)

    def test_console_events_prints_tool_output_to_stderr(self):
        session = Mock()
        console = ConsoleEvents(session)
        with patch("sys.stderr", new_callable=io.StringIO) as stderr:
            console("tool_output", {"name": "run_command", "stream": "stdout", "text": "hello\n"})
            console("tool_output", {"name": "run_command", "stream": "notice", "text": "Command output truncated."})
        self.assertEqual(stderr.getvalue(), "run_command stdout> hello\nstatus> Command output truncated.\n")

    def test_workspace_approval_allows_edits_but_asks_for_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            tools = {tool.name: tool for tool in workspace_tools(Path(tmp))}
            approve = approval_for("workspace")
            self.assertTrue(asyncio.run(approve(tools["write_file"], {})))
            self.assertTrue(asyncio.run(approve(tools["apply_patch"], {})))
            with patch("builtins.input", return_value="n"):
                self.assertFalse(asyncio.run(approve(tools["run_command"], {"argv": ["pytest"]})))

    def test_full_auto_approval_allows_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            tool = next(tool for tool in workspace_tools(Path(tmp)) if tool.name == "run_command")
            self.assertTrue(asyncio.run(approval_for("full-auto")(tool, {"argv": ["pytest"]})))

    def test_tool_loop_writes_a_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = FakeModel([
                ModelTurn("", [ToolCall("call_1", "write_file", {"path": "answer.txt", "content": "done"})]),
                ModelTurn("Completed", []),
            ])
            agent = Agent(model, ToolRegistry(workspace_tools(root)), instructions="test", approve=approve_all)
            self.assertEqual(asyncio.run(agent.run("write a file")), "Completed")
            self.assertEqual((root / "answer.txt").read_text(), "done")

    def test_agent_emits_model_and_tool_status_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            events = []
            model = FakeModel([
                ModelTurn("", [ToolCall("call_1", "write_file", {"path": "answer.txt", "content": "done"})]),
                ModelTurn("Completed", []),
            ])
            agent = Agent(
                model,
                ToolRegistry(workspace_tools(root)),
                instructions="test",
                approve=approve_all,
                on_event=lambda event, _: events.append(event),
            )
            asyncio.run(agent.run("write a file"))
            self.assertEqual(events, [
                "model_request_started",
                "model_request_completed",
                "tool_call_started",
                "tool_call_completed",
                "model_request_started",
                "model_request_completed",
                "turn_completed",
            ])

    def test_agent_emits_streaming_text_and_command_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            events = []
            model = StreamingFakeModel([
                ModelTurn("", [ToolCall("call_1", "run_command", {"argv": ["printf", "hello\\n"]})]),
                ModelTurn("Completed", []),
            ])
            agent = Agent(
                model,
                ToolRegistry(workspace_tools(Path(tmp))),
                instructions="test",
                approve=approve_all,
                on_event=lambda event, data: events.append((event, data)),
            )
            self.assertEqual(asyncio.run(agent.run("run a command")), "Completed")
            self.assertIn(("model_text_delta", {"step": 2, "text": "Completed"}), events)
            self.assertIn(("tool_output", {"call_id": "call_1", "name": "run_command", "stream": "stdout", "text": "hello\n"}), events)

    def test_command_output_is_limited_and_reports_truncation(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = ToolRegistry(workspace_tools(Path(tmp)))
            events = []
            result = asyncio.run(registry.execute(
                "run_command",
                {"argv": [sys.executable, "-c", "print('x' * 40000)"]},
                approve_all,
                lambda stream, text: events.append((stream, text)),
            ))
            self.assertTrue(result["ok"])
            self.assertTrue(result["output_truncated"])
            self.assertLessEqual(len(result["stdout"]), 30_000)
            self.assertIn(("notice", "Command output truncated after 30000 bytes."), events)

    def test_command_timeout_returns_structured_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            registry = ToolRegistry(workspace_tools(Path(tmp)))
            result = asyncio.run(registry.execute(
                "run_command",
                {"argv": [sys.executable, "-c", "import time; time.sleep(10)"], "timeout_seconds": 0.01},
                approve_all,
            ))
            self.assertFalse(result["ok"])
            self.assertEqual(result["error_type"], "timeout")

    def test_cancelled_command_emits_agent_cancellation_event(self):
        async def cancel_running_agent():
            with tempfile.TemporaryDirectory() as tmp:
                events = []
                model = FakeModel([ModelTurn("", [ToolCall("call_1", "run_command", {"argv": [sys.executable, "-c", "import time; time.sleep(10)"]})])])
                agent = Agent(
                    model,
                    ToolRegistry(workspace_tools(Path(tmp))),
                    instructions="test",
                    approve=approve_all,
                    on_event=lambda event, _: events.append(event),
                )
                task = asyncio.create_task(agent.run("run a command"))
                await asyncio.sleep(0.05)
                task.cancel()
                with self.assertRaises(asyncio.CancelledError):
                    await task
                return events

        events = asyncio.run(cancel_running_agent())
        self.assertIn("tool_call_cancelled", events)

    def test_workspace_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = FakeModel([
                ModelTurn("", [ToolCall("call_1", "write_file", {"path": "../outside.txt", "content": "no"})]),
                ModelTurn("Stopped safely", []),
            ])
            agent = Agent(model, ToolRegistry(workspace_tools(root)), instructions="test", approve=approve_all)
            self.assertEqual(asyncio.run(agent.run("escape")), "Stopped safely")
            self.assertFalse((root.parent / "outside.txt").exists())

    def test_mutations_are_denied_by_default(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            model = FakeModel([
                ModelTurn("", [ToolCall("call_1", "write_file", {"path": "answer.txt", "content": "done"})]),
                ModelTurn("Denied", []),
            ])
            agent = Agent(model, ToolRegistry(workspace_tools(root)), instructions="test")
            self.assertEqual(asyncio.run(agent.run("write a file")), "Denied")
            self.assertFalse((root / "answer.txt").exists())

    def test_saved_history_is_restored_for_the_next_turn(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sessions = root / "sessions"
            session = JsonlSession.create(sessions, instructions="test", workspace=root)
            first = Agent(
                FakeModel([ModelTurn("First reply", [])]),
                ToolRegistry(workspace_tools(root)),
                instructions="test",
                history=list(session.history),
                history_sink=session.append,
            )
            asyncio.run(first.run("First question"))

            restored = JsonlSession.load(sessions, session.session_id)
            model = FakeModel([ModelTurn("Second reply", [])])
            second = Agent(
                model,
                ToolRegistry(workspace_tools(root)),
                instructions="test",
                history=list(restored.history),
                history_sink=restored.append,
            )
            self.assertEqual(asyncio.run(second.run("Second question")), "Second reply")
            roles = [item["role"] for item in second.history]
            self.assertEqual(roles, ["system", "user", "assistant", "user", "assistant"])

    def test_compaction_replaces_context_and_persists_it(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session = JsonlSession.create(root / "sessions", instructions="test", workspace=root)
            for item in [
                {"role": "user", "content": "old question " * 20},
                {"role": "assistant", "content": "old answer " * 20},
                {"role": "user", "content": "recent question"},
                {"role": "assistant", "content": "recent answer"},
            ]:
                session.append(item)
            events = []
            agent = Agent(
                FakeModel([ModelTurn("The earlier work inspected old files.", []), ModelTurn("Continued", [])]),
                ToolRegistry(workspace_tools(root)),
                instructions="test",
                history=list(session.history),
                history_sink=session.append,
                compaction_sink=session.replace_history,
                compact_after_chars=1,
                keep_recent_messages=2,
                on_event=lambda event, _: events.append(event),
            )
            self.assertEqual(asyncio.run(agent.run("new question")), "Continued")
            self.assertIn("compaction_completed", events)
            self.assertIn("[Conversation summary]", agent.history[1]["content"])
            restored = JsonlSession.load(root / "sessions", session.session_id)
            self.assertIn("[Conversation summary]", restored.history[1]["content"])

    def test_search_text_returns_line_context(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "notes.txt").write_text("first\nneedle here\nlast\n")
            registry = ToolRegistry(workspace_tools(root))
            result = asyncio.run(registry.execute("search_text", {"query": "needle"}, approve_all))
            self.assertTrue(result["ok"])
            self.assertEqual(result["matches"][0]["path"], "notes.txt")
            self.assertEqual(result["matches"][0]["line"], 2)
            self.assertEqual(len(result["matches"][0]["context"]), 3)

    def test_apply_patch_checks_paths_then_applies(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "notes.txt").write_text("old\n")
            patch = """diff --git a/notes.txt b/notes.txt
--- a/notes.txt
+++ b/notes.txt
@@ -1 +1 @@
-old
+new
"""
            registry = ToolRegistry(workspace_tools(root))
            result = asyncio.run(registry.execute("apply_patch", {"patch": patch}, approve_all))
            self.assertEqual(result, {"ok": True, "checked": True, "applied": True, "paths": ["notes.txt"]})
            self.assertEqual((root / "notes.txt").read_text(), "new\n")

    def test_apply_patch_rejects_workspace_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            root.mkdir()
            patch = """diff --git a/../outside.txt b/../outside.txt
--- a/../outside.txt
+++ b/../outside.txt
@@ -0,0 +1 @@
+nope
"""
            registry = ToolRegistry(workspace_tools(root))
            with self.assertRaises(ToolError):
                asyncio.run(registry.execute("apply_patch", {"patch": patch}, approve_all))
