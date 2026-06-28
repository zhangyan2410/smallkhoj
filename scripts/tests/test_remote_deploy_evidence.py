import unittest
from pathlib import Path

from scripts import remote_deploy_evidence as evidence


class RemoteDeployEvidenceTests(unittest.TestCase):
    def test_default_plan_collects_no_secret_remote_evidence(self) -> None:
        options = evidence.CollectOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output=Path("/tmp/evidence.json"),
        )

        plan = evidence.build_plan(options)
        labels = [step.label for step in plan.steps]

        self.assertEqual(labels, [
            "host-probe",
            "repo-preflight",
            "compose-services",
            "compose-ps",
            "compose-logs-core",
            "docker-ps",
            "docker-system-df",
            "memory-snapshot",
            "disk-snapshot",
        ])
        commands = "\n".join(" ".join(step.argv) for step in plan.steps)
        self.assertIn("cd /opt/smallkhoj/smallkhoj-deploy", commands)
        self.assertIn("python3 scripts/lighthouse_host_probe.py --json", commands)
        self.assertIn("docker compose -f docker-compose.prod.yml ps", commands)
        self.assertNotIn("cat .env.prod", commands)
        self.assertNotIn("printenv", commands)

    def test_plan_accepts_ssh_port_and_identity(self) -> None:
        options = evidence.CollectOptions(
            host="203.0.113.10",
            user="ubuntu",
            port=2222,
            identity_file=Path("/tmp/key.pem"),
            remote_dir="/opt/smallkhoj",
            output=Path("/tmp/evidence.json"),
        )

        plan = evidence.build_plan(options)

        self.assertEqual(plan.steps[0].argv[:5], ["ssh", "-i", "/tmp/key.pem", "-p", "2222"])

    def test_plan_with_env_file_adds_runtime_preflight_without_reading_env(self) -> None:
        options = evidence.CollectOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output=Path("/tmp/evidence.json"),
            remote_env_file=".env.prod",
        )

        plan = evidence.build_plan(options)
        commands = "\n".join(" ".join(step.argv) for step in plan.steps)

        self.assertIn("python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json", commands)
        self.assertNotIn("cat .env.prod", commands)

    def test_plan_with_public_smoke_adds_local_step(self) -> None:
        options = evidence.CollectOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output=Path("/tmp/evidence.json"),
            public_base_url="http://203.0.113.10",
            allow_http=True,
        )

        plan = evidence.build_plan(options)

        self.assertEqual(plan.steps[-1].label, "public-smoke")
        self.assertEqual(plan.steps[-1].argv, [
            "python3",
            "scripts/post_deploy_smoke.py",
            "--base-url",
            "http://203.0.113.10",
            "--json",
            "--allow-http",
        ])

    def test_evidence_payload_contains_results_without_secret_fields(self) -> None:
        result = evidence.CommandResult(
            label="repo-preflight",
            command="ssh host 'python3 scripts/initial_release_deploy_preflight.py --json'",
            returncode=0,
            stdout='{"ready": true}',
            stderr="",
        )

        payload = evidence.results_to_payload([result])

        self.assertEqual(payload["results"][0]["label"], "repo-preflight")
        self.assertEqual(payload["results"][0]["returncode"], 0)
        self.assertNotIn("env", payload["results"][0])


if __name__ == "__main__":
    unittest.main()
