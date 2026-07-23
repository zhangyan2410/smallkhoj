import json
import unittest
from pathlib import Path

from scripts import production_image_transfer as transfer


class ProductionImageTransferTests(unittest.TestCase):
    def test_default_plan_builds_saves_uploads_and_loads_images(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
        )

        plan = transfer.build_plan(options)
        labels = [step.label for step in plan.steps]

        self.assertEqual(labels, [
            "build-backend-image",
            "build-frontend-image",
            "build-caddy-image",
            "save-image-archive",
            "prepare-remote-dir",
            "upload-image-archive",
            "load-image-archive",
        ])
        self.assertEqual(plan.steps[0].argv, [
            "docker",
            "build",
            "-f",
            "backend/Dockerfile",
            "-t",
            "smallkhoj-backend:local-release",
            ".",
        ])
        self.assertIn("smallkhoj-backend:local-release", plan.steps[3].argv)
        self.assertIn("smallkhoj-frontend:local-release", plan.steps[3].argv)
        self.assertIn("smallkhoj-caddy:local-release", plan.steps[3].argv)
        self.assertEqual(plan.steps[5].argv[:3], ["scp", "/tmp/smallkhoj-images.tar", "ubuntu@203.0.113.10:/opt/smallkhoj/"])
        self.assertIn("docker load -i /opt/smallkhoj/smallkhoj-images.tar", plan.steps[6].argv[-1])

    def test_skip_build_keeps_archive_upload_and_load_steps(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            skip_build=True,
        )

        plan = transfer.build_plan(options)
        labels = [step.label for step in plan.steps]

        self.assertEqual(labels, [
            "save-image-archive",
            "prepare-remote-dir",
            "upload-image-archive",
            "load-image-archive",
        ])

    def test_vpn_proxy_adds_docker_build_proxy_args(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            use_vpn_proxy=True,
        )

        plan = transfer.build_plan(options)
        build_commands = "\n".join(" ".join(step.argv) for step in plan.steps if step.label.startswith("build-"))

        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
            self.assertIn(f"{key}=http://host.docker.internal:7897", build_commands)
        self.assertIn("NEXT_PUBLIC_API_BASE_URL=", build_commands)
        self.assertIn("NEXT_PUBLIC_WS_BASE_URL=", build_commands)

    def test_frontend_production_key_uses_buildkit_secret_without_value_in_plan(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
        )

        frontend = next(
            step for step in transfer.build_plan(options).steps
            if step.label == "build-frontend-image"
        )
        command = " ".join(frontend.argv)

        self.assertIn("--secret id=public_api_key,env=PUBLIC_API_KEY", command)
        self.assertIn("NEXT_PUBLIC_DEPLOYMENT_ENV=production", command)
        self.assertNotIn("sk_public_local", command)
        self.assertNotIn("NEXT_PUBLIC_API_KEY=", command)

    def test_platform_is_added_to_all_docker_builds_when_selected(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            platform="linux/amd64",
        )

        plan = transfer.build_plan(options)
        build_steps = [step for step in plan.steps if step.label.startswith("build-")]

        self.assertEqual(len(build_steps), 3)
        for step in build_steps:
            self.assertIn("--platform", step.argv)
            self.assertIn("linux/amd64", step.argv)

    def test_plan_accepts_ssh_port_and_identity(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            user="ubuntu",
            port=2222,
            identity_file=Path("/tmp/key.pem"),
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            skip_build=True,
        )

        plan = transfer.build_plan(options)

        ssh_step = next(step for step in plan.steps if step.label == "prepare-remote-dir")
        scp_step = next(step for step in plan.steps if step.label == "upload-image-archive")
        self.assertEqual(ssh_step.argv[:5], ["ssh", "-i", "/tmp/key.pem", "-p", "2222"])
        self.assertEqual(scp_step.argv[:6], ["scp", "-i", "/tmp/key.pem", "-P", "2222", "/tmp/smallkhoj-images.tar"])

    def test_plan_payload_does_not_print_env_or_secret_names(self) -> None:
        options = transfer.TransferOptions(
            host="203.0.113.10",
            user="ubuntu",
            remote_dir="/opt/smallkhoj",
            output_archive=Path("/tmp/smallkhoj-images.tar"),
            use_vpn_proxy=True,
        )

        payload_text = json.dumps(transfer.plan_to_payload(transfer.build_plan(options)), sort_keys=True)

        for forbidden in (
            ".env.prod",
            "POSTGRES_PASSWORD",
            "JIRA_API_TOKEN",
            "FEISHU_WORKER_APP_SECRET",
            "OPENAI_API_KEY",
        ):
            self.assertNotIn(forbidden, payload_text)


if __name__ == "__main__":
    unittest.main()
