import unittest
from pathlib import Path

from scripts import lighthouse_ssh_deploy_probe as runner


class LighthouseSshDeployProbeTests(unittest.TestCase):
    def test_plan_default_uploads_bundle_and_runs_host_probe(self) -> None:
        options = runner.RunOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            local_bundle=Path("/tmp/smallkhoj-deploy-bundle.tar.gz"),
        )

        plan = runner.build_plan(options)
        labels = [step.label for step in plan.steps]

        self.assertEqual(labels, [
            "create-bundle",
            "prepare-remote-dir",
            "upload-bundle",
            "unpack-bundle",
            "host-probe",
            "repo-preflight",
        ])
        self.assertEqual(plan.steps[2].argv[:3], ["scp", "/tmp/smallkhoj-deploy-bundle.tar.gz", "ubuntu@203.0.113.10:/opt/smallkhoj/"])
        self.assertIn("python3 scripts/lighthouse_host_probe.py --json", plan.steps[4].argv[-1])
        self.assertIn("python3 scripts/initial_release_deploy_preflight.py --json", plan.steps[5].argv[-1])

    def test_plan_accepts_ssh_port_and_identity(self) -> None:
        options = runner.RunOptions(
            host="203.0.113.10",
            user="ubuntu",
            port=2222,
            identity_file=Path("/tmp/key.pem"),
            remote_dir="/opt/smallkhoj",
            local_bundle=Path("/tmp/bundle.tar.gz"),
        )

        plan = runner.build_plan(options)

        ssh_step = next(step for step in plan.steps if step.label == "prepare-remote-dir")
        scp_step = next(step for step in plan.steps if step.label == "upload-bundle")
        self.assertEqual(ssh_step.argv[:5], ["ssh", "-i", "/tmp/key.pem", "-p", "2222"])
        self.assertEqual(scp_step.argv[:6], ["scp", "-i", "/tmp/key.pem", "-P", "2222", "/tmp/bundle.tar.gz"])

    def test_plan_with_env_runtime_preflight_and_compose_start(self) -> None:
        options = runner.RunOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            local_bundle=Path("/tmp/bundle.tar.gz"),
            remote_env_file=".env.prod",
            runtime_preflight=True,
            compose_up=True,
        )

        plan = runner.build_plan(options)
        commands = "\n".join(" ".join(step.argv) for step in plan.steps)

        self.assertIn("python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json", commands)
        self.assertIn("docker compose --env-file .env.prod -f docker-compose.prod.yml pull db backend frontend", commands)
        self.assertIn("docker compose --env-file .env.prod -f docker-compose.prod.yml build caddy", commands)
        self.assertIn("docker compose --env-file .env.prod -f docker-compose.prod.yml up -d db backend frontend caddy", commands)

    def test_compose_up_requires_remote_env_file(self) -> None:
        options = runner.RunOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            local_bundle=Path("/tmp/bundle.tar.gz"),
            compose_up=True,
        )

        with self.assertRaises(ValueError):
            runner.build_plan(options)

    def test_plan_with_public_smoke_runs_locally_after_remote_steps(self) -> None:
        options = runner.RunOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            local_bundle=Path("/tmp/bundle.tar.gz"),
            public_base_url="http://203.0.113.10",
            allow_http=True,
        )

        plan = runner.build_plan(options)

        smoke_step = plan.steps[-1]
        self.assertEqual(smoke_step.label, "public-smoke")
        self.assertEqual(smoke_step.argv, [
            "python3",
            "scripts/post_deploy_smoke.py",
            "--base-url",
            "http://203.0.113.10",
            "--json",
            "--allow-http",
        ])


if __name__ == "__main__":
    unittest.main()
