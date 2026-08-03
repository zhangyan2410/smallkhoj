from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.budget import BudgetExceeded, CallBudgetLedger
from lib.jsonrpc import JsonRpcClient, ProtocolSafetyError
from lib.process_guard import OwnedProcessRegistry


class JsonRpcClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        root = Path(self.temp_dir.name)
        self.ledger = CallBudgetLedger(root / "budget.json", per_provider_limit=2)
        self.registry = OwnedProcessRegistry(root / "processes.json")
        self.client = JsonRpcClient.start(
            [sys.executable, str(PROBES_ROOT / "tests" / "fixtures" / "fake_jsonrpc_server.py")],
            cwd=root,
            registry=self.registry,
        )

    def tearDown(self) -> None:
        self.client.terminate(grace_seconds=0.05)
        self.temp_dir.cleanup()

    def test_control_and_model_methods_have_separate_budget_paths(self) -> None:
        initialized = self.client.request_control(
            "initialize", {"clientInfo": {"name": "probe", "version": "1"}}, timeout_seconds=1
        )
        self.assertEqual("fake", initialized["userAgent"])
        self.assertEqual(0, self.ledger.count_reserved_or_consumed("codex"))

        started = self.client.request_model(
            self.ledger,
            "codex",
            "turn-start",
            "turn/start",
            {"threadId": "thread-1", "input": [{"type": "text", "text": "nonce"}]},
            timeout_seconds=1,
        )
        self.assertEqual("turn-1", started["turn"]["id"])
        self.assertEqual(1, self.ledger.count_reserved_or_consumed("codex"))
        self.assertEqual("turn/started", self.client.notifications[0]["method"])

        self.client.request_control("turn/interrupt", {"threadId": "thread-1", "turnId": "turn-1"}, timeout_seconds=1)
        self.assertEqual(1, self.ledger.count_reserved_or_consumed("codex"))

    def test_model_only_methods_cannot_be_sent_via_control_path(self) -> None:
        with self.assertRaises(ProtocolSafetyError):
            self.client.request_control("turn/steer", {"threadId": "thread-1"}, timeout_seconds=1)

    def test_third_jsonrpc_model_input_is_rejected_by_the_provider_ledger(self) -> None:
        params = {"threadId": "thread-1", "input": [{"type": "text", "text": "nonce"}]}
        self.client.request_model(self.ledger, "codex", "one", "turn/start", params, timeout_seconds=1)
        self.client.request_model(self.ledger, "codex", "two", "turn/steer", params, timeout_seconds=1)

        with self.assertRaises(BudgetExceeded):
            self.client.request_model(self.ledger, "codex", "three", "turn/steer", params, timeout_seconds=1)



if __name__ == "__main__":
    unittest.main()
