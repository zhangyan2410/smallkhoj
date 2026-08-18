from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.budget import CallBudgetLedger
from lib.process_guard import OwnedProcessRegistry
from surfaces.codex_appserver import CodexAppServerProbe


class CodexAppServerProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temp_dir.name)
        self.ledger = CallBudgetLedger(self.root / "budget.json", per_provider_limit=2)
        self.probe = CodexAppServerProbe.start(
            [sys.executable, str(PROBES_ROOT / "tests" / "fixtures" / "fake_jsonrpc_server.py")],
            cwd=self.root,
            registry=OwnedProcessRegistry(self.root / "processes.json"),
        )

    def tearDown(self) -> None:
        self.probe.terminate(grace_seconds=0.05)
        self.temp_dir.cleanup()

    def test_separates_initialize_thread_start_turn_steer_and_interrupt(self) -> None:
        initialized = self.probe.initialize(timeout_seconds=1)
        thread_id = self.probe.start_thread(self.root, timeout_seconds=1)
        turn_id = self.probe.start_turn(
            self.ledger,
            "codex",
            "turn-start",
            thread_id,
            "nonce-one",
            timeout_seconds=1,
        )
        started_notification = self.probe.wait_for_turn_started(
            thread_id,
            turn_id,
            timeout_seconds=1,
        )
        steered_turn_id = self.probe.steer_turn(
            self.ledger,
            "codex",
            "turn-steer",
            thread_id,
            turn_id,
            "nonce-two",
            timeout_seconds=1,
        )
        self.probe.interrupt_turn(thread_id, turn_id, timeout_seconds=1)

        self.assertEqual("fake", initialized["userAgent"])
        self.assertEqual("thread-1", thread_id)
        self.assertEqual("turn-1", turn_id)
        self.assertEqual("turn/started", started_notification["method"])
        self.assertEqual(turn_id, steered_turn_id)
        self.assertEqual(2, self.ledger.count_reserved_or_consumed("codex"))


if __name__ == "__main__":
    unittest.main()
