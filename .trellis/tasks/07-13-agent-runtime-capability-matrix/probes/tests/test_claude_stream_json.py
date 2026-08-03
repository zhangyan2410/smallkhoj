from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.budget import CallBudgetLedger
from lib.process_guard import OwnedProcessRegistry
from surfaces.claude_stream_json import ClaudeStreamJsonProbe


class ClaudeStreamJsonProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temp_dir.name)
        self.ledger = CallBudgetLedger(self.root / "budget.json", per_provider_limit=2)
        self.probe = ClaudeStreamJsonProbe.start(
            [sys.executable, str(PROBES_ROOT / "tests" / "fixtures" / "fake_stream_json_agent.py")],
            cwd=self.root,
            registry=OwnedProcessRegistry(self.root / "processes.json"),
        )

    def tearDown(self) -> None:
        self.probe.terminate(grace_seconds=0.05)
        self.temp_dir.cleanup()

    def test_captures_session_and_allows_a_second_input_only_through_the_ledger(self) -> None:
        self.probe.send_user_input(self.ledger, "claude", "first", "nonce-one")
        active = self.probe.wait_for_event(lambda event: event.type == "assistant", timeout_seconds=1)
        self.probe.send_user_input(self.ledger, "claude", "second", "nonce-two")
        result = self.probe.wait_for_event(lambda event: event.type == "result", timeout_seconds=1)

        self.assertEqual("session-1", self.probe.session_id)
        self.assertEqual("assistant", active.type)
        self.assertEqual("result", result.type)
        self.assertEqual(2, self.ledger.count_reserved_or_consumed("claude"))

    def test_user_input_uses_the_expected_stream_json_envelope(self) -> None:
        reservation = self.probe.send_user_input(self.ledger, "claude", "first", "nonce-envelope")
        event = self.probe.wait_for_event(lambda event: event.type == "assistant", timeout_seconds=1)

        self.assertEqual(reservation.id, event.reservation_id)
        self.assertIn("nonce-envelope", event.raw["message"]["content"][0]["text"])

    def test_default_argv_enables_verbose_stream_json_output(self) -> None:
        """Claude requires --verbose with --print + --output-format stream-json."""
        self.assertIn("--verbose", ClaudeStreamJsonProbe.default_argv())


if __name__ == "__main__":
    unittest.main()
