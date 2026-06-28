import json
import tempfile
import unittest
from contextlib import redirect_stderr
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from scripts import release_worker_rollout as rollout


class ReleaseWorkerRolloutTests(unittest.TestCase):
    def options(self, *, start_worker: bool = False) -> rollout.RolloutOptions:
        return rollout.RolloutOptions(
            host="124.222.40.40",
            user="ubuntu",
            identity_file=Path("/tmp/tengxun.pem"),
            remote_dir="/home/ubuntu/smallkhoj-deploy",
            bundle_prefix="smallkhoj-deploy",
            remote_env_file=".env.prod",
            local_env_file=Path("/Volumes/ORICO/smallkhoj-secrets/release-worker.env"),
            feishu_chat_id="oc_release_chat",
            feishu_chat_type="group",
            command="jira_analysis",
            start_worker=start_worker,
        )

    def test_default_plan_is_guarded_and_does_not_start_worker(self) -> None:
        plan = rollout.build_plan(self.options())
        labels = [step.label for step in plan.steps]
        commands = "\n".join(step.display_command for step in plan.steps)

        self.assertEqual(labels, [
            "validate-release-worker-env",
            "apply-release-worker-env",
            "restart-backend",
            "live-run-preflight",
        ])
        self.assertIn("validate_release_worker_env.py --json", commands)
        self.assertIn("update_prod_env_from_stdin.py --env-file .env.prod --json", commands)
        self.assertIn("< /Volumes/ORICO/smallkhoj-secrets/release-worker.env", commands)
        self.assertIn("docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --no-deps --force-recreate backend", commands)
        self.assertIn("uv run python -m live_run_preflight_cli --feishu-chat-id oc_release_chat", commands)
        self.assertNotIn("feishu-worker up -d feishu-worker", commands)
        self.assertNotIn("FEISHU_WORKER_APP_SECRET=", commands)
        self.assertNotIn("JIRA_API_TOKEN=", commands)

    def test_start_worker_step_requires_explicit_flag(self) -> None:
        plan = rollout.build_plan(self.options(start_worker=True))

        self.assertEqual(plan.steps[-1].label, "start-feishu-worker")
        self.assertIn(
            "docker compose --env-file .env.prod -f docker-compose.prod.yml --profile feishu-worker up -d feishu-worker",
            plan.steps[-1].display_command,
        )

    def test_dry_run_json_contains_labels_and_commands_without_values(self) -> None:
        payload = rollout.plan_to_payload(rollout.build_plan(self.options()))
        text = json.dumps(payload, sort_keys=True)

        self.assertIn("apply-release-worker-env", text)
        self.assertIn("release-worker.env", text)
        self.assertNotIn("FEISHU_WORKER_APP_SECRET=", text)
        self.assertNotIn("JIRA_API_TOKEN=", text)

    def test_cli_rejects_start_worker_without_apply(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            env_file = Path(tmp) / "release-worker.env"
            env_file.write_text("", encoding="utf-8")

            stderr = StringIO()
            with redirect_stderr(stderr):
                exit_code = rollout.main([
                    "--host", "124.222.40.40",
                    "--identity-file", "/tmp/tengxun.pem",
                    "--env-file", str(env_file),
                    "--feishu-chat-id", "oc_release_chat",
                    "--dry-run",
                    "--start-worker",
                ])

        self.assertEqual(exit_code, 2)
        self.assertIn("--start-worker requires --apply", stderr.getvalue())

    def test_execution_stops_before_remote_mutation_when_validation_fails(self) -> None:
        plan = rollout.build_plan(self.options(start_worker=True))
        calls: list[str] = []

        def fake_run(step: rollout.PlanStep) -> rollout.CommandResult:
            calls.append(step.label)
            return rollout.CommandResult(
                label=step.label,
                command=step.display_command,
                returncode=2,
                stdout='{"ready": false}',
                stderr="",
            )

        with patch.object(rollout, "run_step", side_effect=fake_run):
            results = rollout.execute_plan(plan, apply=True)

        self.assertEqual(calls, ["validate-release-worker-env"])
        self.assertEqual([result.label for result in results], ["validate-release-worker-env"])

    def test_execution_stops_before_worker_start_when_preflight_fails(self) -> None:
        plan = rollout.build_plan(self.options(start_worker=True))
        calls: list[str] = []

        def fake_run(step: rollout.PlanStep) -> rollout.CommandResult:
            calls.append(step.label)
            return rollout.CommandResult(
                label=step.label,
                command=step.display_command,
                returncode=2 if step.label == "live-run-preflight" else 0,
                stdout="{}",
                stderr="",
            )

        with patch.object(rollout, "run_step", side_effect=fake_run):
            results = rollout.execute_plan(plan, apply=True)

        self.assertEqual(calls, [
            "validate-release-worker-env",
            "apply-release-worker-env",
            "restart-backend",
            "live-run-preflight",
        ])
        self.assertNotIn("start-feishu-worker", [result.label for result in results])


if __name__ == "__main__":
    unittest.main()
