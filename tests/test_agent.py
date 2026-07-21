import asyncio
import tempfile
import unittest
from pathlib import Path

from pycodex.agent import Agent
from pycodex.__main__ import allow_all
from pycodex.models import ModelTurn, ToolCall
from pycodex.session import JsonlSession
from pycodex.tools import ToolRegistry, workspace_tools


class FakeModel:
    def __init__(self, turns):
        self.turns = iter(turns)

    async def complete(self, messages, tools):
        return next(self.turns)


async def approve_all(*_):
    return True


class AgentTests(unittest.TestCase):
    def test_full_auto_callback_allows_operations(self):
        self.assertTrue(asyncio.run(allow_all(None, {})))

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
