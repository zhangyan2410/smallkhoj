from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.budget import BudgetExceeded, CallBudgetLedger


class CallBudgetLedgerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.path = Path(self.temp_dir.name) / "call-budget.json"
        self.ledger = CallBudgetLedger(self.path, per_provider_limit=2)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_reservation_exhausts_provider_budget_before_model_input_is_written(self) -> None:
        self.ledger.reserve("codex", "case-1")
        self.ledger.reserve("codex", "case-2")

        with self.assertRaises(BudgetExceeded):
            self.ledger.reserve("codex", "case-3")

        self.assertEqual(2, self.ledger.count_reserved_or_consumed("codex"))

    def test_attempted_input_is_persisted_as_consumed(self) -> None:
        reservation = self.ledger.reserve("claude", "busy-input")
        self.ledger.mark_input_attempted(reservation.id)

        reloaded = CallBudgetLedger(self.path, per_provider_limit=2)
        self.assertEqual("consumed", reloaded.get(reservation.id).state)
        self.assertEqual(1, reloaded.count_reserved_or_consumed("claude"))

    def test_unsettled_reservation_is_fail_closed_after_controller_recovery(self) -> None:
        reservation = self.ledger.reserve("kimi", "selected-surface")

        recovered = CallBudgetLedger(self.path, per_provider_limit=2)
        recovered.mark_unsettled_as_unknown()

        self.assertEqual("consumed_unknown", recovered.get(reservation.id).state)
        recovered.reserve("kimi", "only-one-call-left")
        with self.assertRaises(BudgetExceeded):
            recovered.reserve("kimi", "would-be-third-call")

    def test_providers_have_independent_two_call_budgets(self) -> None:
        self.ledger.reserve("codex", "case-1")
        self.ledger.reserve("codex", "case-2")
        self.ledger.reserve("opencode", "case-1")
        self.ledger.reserve("opencode", "case-2")

        self.assertEqual(2, self.ledger.count_reserved_or_consumed("codex"))
        self.assertEqual(2, self.ledger.count_reserved_or_consumed("opencode"))


if __name__ == "__main__":
    unittest.main()
