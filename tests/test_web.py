import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from pycodex.session import JsonlSession
from pycodex.web import create_app


class WebTests(unittest.TestCase):
    def test_dashboard_lists_and_reads_session_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            sessions = Path(tmp) / "sessions"
            session = JsonlSession.create(sessions, instructions="test", workspace=Path(tmp))
            session.append({"role": "user", "content": "Inspect the repository"})
            session.append_event("tool_call_started", {"name": "read_file"})

            client = TestClient(create_app(sessions))
            listing = client.get("/api/sessions")
            self.assertEqual(listing.status_code, 200)
            self.assertEqual(listing.json()[0]["id"], session.session_id)
            detail = client.get(f"/api/sessions/{session.session_id}").json()
            self.assertTrue(any(event.get("type") == "agent_event" for event in detail["events"]))
            self.assertIn("PyCodex Trace", client.get("/").text)

    def test_dashboard_registers_event_stream(self):
        with tempfile.TemporaryDirectory() as tmp:
            sessions = Path(tmp) / "sessions"
            session = JsonlSession.create(sessions, instructions="test", workspace=Path(tmp))
            app = create_app(sessions)
            paths = {route.path for route in app.routes}
            self.assertIn("/api/sessions/{session_id}/events", paths)
