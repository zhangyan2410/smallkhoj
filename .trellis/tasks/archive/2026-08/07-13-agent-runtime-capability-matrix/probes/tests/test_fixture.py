from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROBES_ROOT))

from lib.fixture import FixtureError, FixtureManager


class FixtureManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.safe_root = Path(self.temp_dir.name) / "smallkhoj-agent-runtime-capability-matrix"
        self.manager = FixtureManager(self.safe_root)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_creates_a_disposable_git_fixture_below_tmp_only(self) -> None:
        fixture = self.manager.create("run-001", "codex", "appserver")

        self.assertTrue(fixture.root.is_relative_to(self.safe_root))
        self.assertTrue((fixture.root / ".git").is_dir())
        self.assertTrue((fixture.root / "README.md").is_file())
        self.assertTrue((fixture.root / "sentinel.txt").is_file())
        self.assertEqual(fixture.baseline_digest, self.manager.digest(fixture.root))

    def test_refuses_a_root_outside_tmp(self) -> None:
        with self.assertRaises(FixtureError):
            FixtureManager(Path.cwd()).create("run-001", "codex", "appserver")

    def test_detects_a_symlink_that_escapes_the_fixture(self) -> None:
        fixture = self.manager.create("run-002", "claude", "stream-json")
        escape = fixture.root / "escape"
        os.symlink("/tmp", escape)

        with self.assertRaises(FixtureError):
            self.manager.assert_within_fixture(fixture.root, escape / "outside.txt")

    def test_digest_changes_after_a_fixture_only_side_effect(self) -> None:
        fixture = self.manager.create("run-003", "kimi", "prompt")
        before = self.manager.digest(fixture.root)
        (fixture.root / "sentinel.txt").write_text("changed safely\n", encoding="utf-8")

        self.assertNotEqual(before, self.manager.digest(fixture.root))


if __name__ == "__main__":
    unittest.main()
