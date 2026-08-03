from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.budget import BudgetExceeded, CallBudgetLedger
from lib.process_guard import OwnedProcessRegistry
from lib.runner import ManagedProcess


class ManagedProcessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.root = Path(self.temp_dir.name)
        self.registry = OwnedProcessRegistry(self.root / "processes.json")
        self.ledger = CallBudgetLedger(self.root / "budget.json", per_provider_limit=2)
        self.processes: list[ManagedProcess] = []

    def tearDown(self) -> None:
        for process in self.processes:
            process.terminate(grace_seconds=0.05)
        self.temp_dir.cleanup()

    def _start_fake_agent(self) -> ManagedProcess:
        process = ManagedProcess.start(
            [sys.executable, str(PROBES_ROOT / "tests" / "fixtures" / "fake_agent.py")],
            cwd=self.root,
            registry=self.registry,
        )
        self.processes.append(process)
        return process

    def test_model_input_is_reserved_before_write_and_output_is_captured(self) -> None:
        process = self._start_fake_agent()

        process.send_model_input(self.ledger, "claude", "first", {"nonce": "one"})
        events = process.read_until(lambda event: event.source == "stdout", timeout_seconds=1)

        self.assertEqual("consumed", self.ledger.get(events[0].reservation_id).state)
        self.assertIn('"nonce": "one"', events[0].text)

    def test_third_model_input_is_rejected_without_writing_to_stdin(self) -> None:
        process = self._start_fake_agent()
        process.send_model_input(self.ledger, "codex", "first", {"nonce": "one"})
        process.send_model_input(self.ledger, "codex", "second", {"nonce": "two"})

        with self.assertRaises(BudgetExceeded):
            process.send_model_input(self.ledger, "codex", "third", {"nonce": "three"})

        self.assertEqual(2, self.ledger.count_reserved_or_consumed("codex"))

    def test_timeout_returns_observations_without_claiming_completion(self) -> None:
        process = self._start_fake_agent()
        process.send_model_input(self.ledger, "kimi", "sleep", {"mode": "sleep", "seconds": 1})

        events = process.read_until(lambda _: False, timeout_seconds=0.02)

        self.assertEqual([], events)
        self.assertTrue(process.is_running())

    def test_non_model_control_frame_does_not_consume_provider_budget(self) -> None:
        process = self._start_fake_agent()

        process.send_control_frame({"method": "initialize"})
        events = process.read_until(lambda event: event.source == "stdout", timeout_seconds=1)

        self.assertIsNone(events[0].reservation_id)
        self.assertEqual(0, self.ledger.count_reserved_or_consumed("codex"))

    def test_start_allows_a_deliberate_empty_cli_argument(self) -> None:
        """Some safe provider flags use an empty string as their value.

        Claude's ``--allowedTools ""`` is the relevant probe command: an
        empty argument disables tools and is not an empty executable.
        """
        process = ManagedProcess.start(
            [
                sys.executable,
                "-c",
                "import sys; print(repr(sys.argv[-1]), flush=True)",
                "",
            ],
            cwd=self.root,
            registry=self.registry,
        )
        self.processes.append(process)

        events = process.read_until(lambda event: event.source == "stdout", timeout_seconds=1)

        self.assertEqual("''", events[0].text)


if __name__ == "__main__":
    unittest.main()
