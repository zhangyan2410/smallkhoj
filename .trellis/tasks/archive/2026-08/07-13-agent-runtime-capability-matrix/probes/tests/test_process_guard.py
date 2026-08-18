from __future__ import annotations

import dataclasses
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.process_guard import OwnedProcessRegistry, OwnershipError


class OwnedProcessRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.registry = OwnedProcessRegistry(Path(self.temp_dir.name) / "processes.json")
        self.records = []
        self.processes = []

    def tearDown(self) -> None:
        for record in self.records:
            try:
                self.registry.terminate(record, grace_seconds=0.05)
            except OwnershipError:
                pass
        for process in self.processes:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=2)
        self.temp_dir.cleanup()

    def _spawn_sleep(self) -> tuple[subprocess.Popen[str], object]:
        process = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(60)"],
            cwd=self.temp_dir.name,
            start_new_session=True,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        record = self.registry.register(process, cwd=Path(self.temp_dir.name))
        self.processes.append(process)
        self.records.append(record)
        return process, record

    def test_cancel_callback_runs_before_owned_process_group_is_terminated(self) -> None:
        process, record = self._spawn_sleep()
        callbacks: list[str] = []

        result = self.registry.terminate(record, cancel=lambda: callbacks.append("cancel"), grace_seconds=0.05)

        self.assertEqual(["cancel"], callbacks)
        self.assertIn(result.state, {"terminated", "force_terminated"})
        self.assertIsNotNone(process.wait(timeout=2))

    def test_identity_mismatch_refuses_to_signal_process(self) -> None:
        process, record = self._spawn_sleep()
        mismatched = dataclasses.replace(record, started_marker="not-the-same-process")

        with self.assertRaises(OwnershipError):
            self.registry.terminate(mismatched, grace_seconds=0.05)

        self.assertIsNone(process.poll())

    def test_termination_is_idempotent_after_normal_exit(self) -> None:
        _, record = self._spawn_sleep()

        first = self.registry.terminate(record, grace_seconds=0.05)
        second = self.registry.terminate(record, grace_seconds=0.05)

        self.assertIn(first.state, {"terminated", "force_terminated"})
        self.assertEqual("terminated", second.state)


if __name__ == "__main__":
    unittest.main()
