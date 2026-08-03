from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PROBES_ROOT = Path(__file__).resolve().parents[1]
CLI = PROBES_ROOT / "cli.py"
sys.path.insert(0, str(PROBES_ROOT))

from cli import _acp_update_summary, _live_budget_path, _user_hook_execution_observed
from lib.budget import BudgetExceeded, CallBudgetLedger
from lib.runner import ObservedLine


class ProbeCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir="/tmp")
        self.manifest = Path(self.temp_dir.name) / "manifest.json"
        self.manifest.write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "fixtureRoot": "/tmp/smallkhoj-agent-runtime-capability-matrix",
                    "perProviderLimit": 2,
                    "checks": [
                        {
                            "id": "codex-version",
                            "provider": "codex",
                            "surface": "codex-exec",
                            "mode": "version",
                            "argv": ["codex", "--version"],
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_dry_run_emits_plan_without_launching_a_provider(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CLI), "preflight", "--manifest", str(self.manifest), "--dry-run"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual("dry-run", plan["mode"])
        self.assertEqual(0, plan["modelBearingInputsReserved"])
        self.assertEqual(["codex-version"], [check["id"] for check in plan["checks"]])

    def test_appserver_handshake_dry_run_reserves_no_model_input(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CLI), "appserver-handshake", "--dry-run"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual("appserver-handshake-dry-run", plan["mode"])
        self.assertEqual(0, plan["modelBearingInputsReserved"])

    def test_codex_appserver_steer_dry_run_declares_two_inputs_and_one_control_interrupt(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CLI), "codex-appserver-steer", "--dry-run"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual("codex-appserver-steer-dry-run", plan["mode"])
        self.assertEqual(2, plan["maximumModelBearingInputs"])
        self.assertEqual(["turn/start", "turn/steer"], plan["modelMethods"])
        self.assertEqual(["initialize", "thread/start", "turn/interrupt"], plan["controlMethods"])

    def test_user_level_hook_observation_is_treated_as_outside_fixture_risk(self) -> None:
        observations = [
            ObservedLine(
                at="2026-07-14T00:00:00Z",
                source="stdout",
                reservation_id=None,
                text=json.dumps(
                    {
                        "method": "hook/started",
                        "params": {
                            "run": {
                                "source": "user",
                                "sourcePath": "/Users/example/.codex/hooks.json",
                            }
                        },
                    }
                ),
            )
        ]

        self.assertTrue(_user_hook_execution_observed(observations))

    def test_acp_handshake_dry_run_reserves_no_model_input(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CLI), "acp-handshake", "--provider", "kimi", "--dry-run"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual("acp-handshake-dry-run", plan["mode"])
        self.assertEqual("kimi", plan["provider"])
        self.assertEqual(0, plan["modelBearingInputsReserved"])
        self.assertEqual(["initialize", "session/new"], plan["controlMethods"])

    def test_acp_sequential_dry_run_declares_two_prompt_inputs_and_plan_mode(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CLI), "acp-sequential", "--provider", "opencode", "--dry-run"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual("acp-sequential-dry-run", plan["mode"])
        self.assertEqual("opencode", plan["provider"])
        self.assertEqual(2, plan["maximumModelBearingInputs"])
        self.assertEqual("session/prompt", plan["modelMethod"])
        self.assertIn("session/set_config_option", plan["controlMethods"])

    def test_acp_update_summary_aggregates_high_volume_chunk_types(self) -> None:
        notifications = [
            {
                "method": "session/update",
                "params": {"update": {"sessionUpdate": "agent_thought_chunk"}},
            },
            {
                "method": "session/update",
                "params": {"update": {"sessionUpdate": "agent_thought_chunk"}},
            },
            {
                "method": "session/update",
                "params": {"update": {"sessionUpdate": "agent_message_chunk"}},
            },
        ]

        self.assertEqual(
            {"agent_message_chunk": 1, "agent_thought_chunk": 2},
            _acp_update_summary(notifications),
        )

    def test_live_budget_path_is_shared_across_run_ids(self) -> None:
        with tempfile.TemporaryDirectory(dir="/tmp") as temp_dir:
            fixture_root = Path(temp_dir) / "fixture-root"
            path = _live_budget_path(fixture_root)
            self.assertEqual(fixture_root / "_live-budget" / "call-budget.json", path)

            first_run = CallBudgetLedger(path, per_provider_limit=2)
            first_run.reserve("kimi", "run-one-first-input")
            first_run.reserve("kimi", "run-one-second-input")
            later_run = CallBudgetLedger(_live_budget_path(fixture_root), per_provider_limit=2)
            with self.assertRaises(BudgetExceeded):
                later_run.reserve("kimi", "run-two-would-be-third-input")

    def test_claude_busy_input_dry_run_declares_exactly_two_possible_inputs(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CLI), "claude-busy-input", "--dry-run"],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )

        self.assertEqual(0, completed.returncode, completed.stderr)
        plan = json.loads(completed.stdout)
        self.assertEqual("claude-busy-input-dry-run", plan["mode"])
        self.assertEqual(2, plan["maximumModelBearingInputs"])
        self.assertIn("assistant", plan["secondInputPrecondition"])


if __name__ == "__main__":
    unittest.main()
