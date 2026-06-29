import json
import tempfile
import unittest
from pathlib import Path

from scripts import initial_release_foundation_gate as gate
from scripts.tests.test_initial_release_deploy_preflight import make_repo, write
from scripts.tests.test_post_deploy_smoke import FakeDeploymentServer


def make_foundation_repo(root: Path) -> None:
    make_repo(root)
    write(root / ".gitignore", """
        .env
        .env.*
        *.pem
        *.key
        .mcp.json
        tengxun-ssh-key*
    """)
    write(root / "scripts" / "create_prod_env_template.py", """
        TEMPLATE = '''
        # Fill this file on the deployment host. Do not commit it.
        POSTGRES_PASSWORD=<set-outside-repo>
        JIRA_API_TOKEN=<optional-set-outside-repo>
        FEISHU_WORKER_APP_SECRET=<optional-set-outside-repo>
        '''
    """)
    write(root / "scripts" / "update_prod_env_from_stdin.py", """
        '''Update env without printing values.'''
        def sanitized_details():
            return {"added": "<set>", "empty": "<empty>", "unchanged": "<unchanged>"}
    """)
    write(root / "scripts" / "make_deployment_bundle.py", """
        '''This bundle does not include `.env.prod` or secrets.'''
        def validate_archive_path(relative_path: str):
            raise ValueError("Refusing to bundle env file")
    """)
    task_dir = root / ".trellis" / "tasks" / "06-29-06-29-initial-release-foundation-reliability-risk-gates"
    task_dir.mkdir(parents=True, exist_ok=True)
    write(task_dir / "risk-register.md", """
        | ID | Priority | Risk | Symptom | Gate / Evidence | Related Task | Status |
        | --- | --- | --- | --- | --- | --- |
        | FR-01 | P0 | Account/Server scope is not real | leak | test | task | not-started |
        | FR-02 | P0 | Product daemon command depends on source checkout | no install | test | task | not-started |
        | FR-03 | P0 | Duplicate Computer identity | duplicate | test | task | warn |
        | FR-04 | P0 | Daemon WebSocket production route broken | no ws | test | task | warn |
        | FR-05 | P0 | TaskRun accepted but not executable/observable | stuck | test | task | not-started |
        | FR-06 | P0 | Deployment only works from local dev assumptions | localhost | test | task | warn |
        | FR-07 | P0 | No backup/restore confidence | data loss | test | task | not-started |
        | FR-08 | P0 | Secrets/config leak or partial prod env | leak | test | task | warn |
    """)
    write(root / "backend" / "routers" / "public_api.py", """
        def _computer_connect_command(connect_token: str, server_url: str) -> str:
            return "smallkhoj-daemon connect --token " + connect_token + " --server " + server_url
    """)


class FoundationGateTests(unittest.TestCase):
    def test_foundation_gate_passes_static_and_deployed_smoke_for_ready_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            self.assertEqual(report.failures, 0)
            self.assertEqual(report.blocked, 0)
            self.assertTrue(report.ready)
            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["foundation.riskRegister"].status, "passed")
            self.assertEqual(by_name["daemon.commandShape"].status, "passed")
            self.assertEqual(by_name["smoke.ws.daemonAuth"].risk_id, "FR-04")

    def test_missing_base_url_blocks_deployed_gates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_foundation_repo(root)

            report = gate.run_foundation_gate(root=root, require_all_p0=False)

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["smoke.publicUrl"].status, "blocked")
            self.assertEqual(by_name["smoke.daemonWebSocket"].status, "blocked")
            self.assertFalse(report.ready)
            self.assertEqual(gate.exit_code_for(report, strict_warnings=False), 3)

    def test_development_path_daemon_command_fails_fr02(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            write(root / "backend" / "routers" / "public_api.py", """
                from pathlib import Path
                DEFAULT_DAEMON_LAUNCHER = Path(__file__).resolve().parents[2] / "smallkhoj-daemon"
                def _computer_connect_command(connect_token: str, server_url: str) -> str:
                    return str(DEFAULT_DAEMON_LAUNCHER)
            """)

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["daemon.commandShape"].status, "failed")
            self.assertEqual(by_name["daemon.commandShape"].risk_id, "FR-02")
            self.assertFalse(report.ready)

    def test_json_output_has_risk_summary_and_omits_secret_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            env_file = root / ".env.prod"
            write(env_file, """
                SMALLKHOJ_SITE_ADDRESS=localhost
                SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:test
                SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:test
                POSTGRES_PASSWORD=super-secret-password
                BACKEND_CORS_ORIGINS=http://127.0.0.1
            """)

            report = gate.run_foundation_gate(
                root=root,
                env_file=env_file,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )
            payload = json.loads(gate.to_json(report))

            self.assertIn("risks", payload)
            self.assertIn("FR-08", payload["risks"])
            self.assertNotIn("super-secret-password", gate.to_json(report))

    def test_default_gate_blocks_unwired_p0_risks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)

            report = gate.run_foundation_gate(root=root, base_url=base_url, allow_http=True, timeout=2)

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["risk.FR-03.coverage"].status, "blocked")
            self.assertEqual(by_name["risk.FR-05.coverage"].status, "blocked")
            self.assertEqual(by_name["risk.FR-07.coverage"].status, "blocked")
            self.assertEqual(by_name["secrets.gitignore"].status, "passed")
            self.assertNotIn("risk.FR-08.coverage", by_name)
            self.assertFalse(report.ready)

    def test_missing_secret_guardrail_fails_fr08(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            write(root / ".gitignore", """
                .env
            """)

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["secrets.gitignore"].status, "failed")
            self.assertEqual(by_name["secrets.gitignore"].risk_id, "FR-08")


if __name__ == "__main__":
    unittest.main()
