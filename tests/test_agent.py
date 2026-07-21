import asyncio
import tempfile
import unittest
from pathlib import Path

from pycodex.agent import Agent
from pycodex.__main__ import allow_all
from pycodex.models import ModelTurn, ToolCall
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
