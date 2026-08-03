from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.budget import CallBudgetLedger
from lib.process_guard import OwnedProcessRegistry
from surfaces.acp_stdio import AcpStdioProbe


class AcpStdioProbeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temp_dir.name)
        self.ledger = CallBudgetLedger(self.root / "budget.json", per_provider_limit=2)
        self.probe = AcpStdioProbe.start(
            [sys.executable, str(PROBES_ROOT / "tests" / "fixtures" / "fake_acp_server.py")],
            cwd=self.root,
            registry=OwnedProcessRegistry(self.root / "processes.json"),
        )

    def tearDown(self) -> None:
        self.probe.terminate(grace_seconds=0.05)
        self.temp_dir.cleanup()

    def test_initializes_creates_a_session_and_counts_only_prompt_frames(self) -> None:
        initialized = self.probe.initialize(timeout_seconds=1)
        session_id = self.probe.new_session(self.root, timeout_seconds=1)
        mode = self.probe.set_config_option(session_id, "mode", "plan", timeout_seconds=1)
        first_result = self.probe.prompt(
            self.ledger,
            "kimi",
            "first-prompt",
            session_id,
            "nonce-one",
            timeout_seconds=1,
        )
        update = self.probe.wait_for_session_update(session_id, timeout_seconds=1)
        second_result = self.probe.prompt(
            self.ledger,
            "kimi",
            "second-prompt",
            session_id,
            "nonce-two",
            timeout_seconds=1,
        )
        self.probe.cancel(session_id, timeout_seconds=1)

        self.assertEqual(1, initialized["protocolVersion"])
        self.assertEqual("acp-session-1", session_id)
        self.assertEqual("plan", mode["configOptions"][0]["currentValue"])
        self.assertEqual("end_turn", first_result["stopReason"])
        self.assertEqual("end_turn", second_result["stopReason"])
        self.assertEqual("session/update", update["method"])
        self.assertEqual(2, self.ledger.count_reserved_or_consumed("kimi"))


if __name__ == "__main__":
    unittest.main()
