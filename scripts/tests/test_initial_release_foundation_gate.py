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
    write(root / "scripts" / "build_daemon_distribution.py", """
        PLATFORM = "darwin-arm64"
        ARTIFACT = "smallkhoj-daemon-v0.2.0-darwin-arm64.tar.gz"
        version = "0.2.0"
    """)
    write(root / "scripts" / "postgres_backup_restore_drill.py", """
        def placeholder():
            return "pg_dump pg_restore SELECT 1"
    """)
    write(root / "backend" / "tests" / "test_daemon_control.py", """
        def test_daemon_connect_rejects_version_below_minimum():
            assert "426"

        def test_daemon_heartbeat_accepts_version_field_for_compatibility_checks():
            assert "daemonVersion"

        def test_placeholder():
            assert True
    """)
    write(root / "backend" / "tests" / "test_task_runs.py", """
        def test_placeholder():
            assert True
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
    write(root / "backend" / "routers" / "agent_api.py", """
        def _require_supported_daemon_version(version):
            minimum = settings.minimum_daemon_version
            raise HTTPException(426, "Unsupported daemon version")

        async def connect_daemon(body):
            _require_supported_daemon_version(body.daemonVersion)

        async def register_daemon(body):
            _require_supported_daemon_version(body.daemonVersion)

        async def daemon_heartbeat(body):
            _require_supported_daemon_version(body.daemonVersion)
    """)
    write(root / "agent" / "daemon" / "aaa-daemon" / "src" / "daemon" / "daemon.ts", """
        export function defaultDaemonWorkspaceRoot(env = process.env) {
          const explicitRoot = env.SMALLKHOJ_DAEMON_WORKSPACE_ROOT;
          return explicitRoot || join(homedir(), '.smallkhoj', 'daemon', 'workspaces');
        }
        export function daemonRuntimeWorkspacePath(basePath, options) {
          const serverSegment = options.serverId;
          const computerSegment = options.computerId || options.machineId;
          const workspaceSegment = options.workspaceId || options.agentId;
          return join(basePath, '.slock-runtimes', serverSegment, computerSegment, workspaceSegment);
        }
    """)
    write(root / "agent" / "daemon" / "aaa-daemon" / "test" / "daemon-runtime.test.mjs", """
        test('daemon default workspace root is stable and configurable', () => {});
        test('daemon runtime workspace path isolates different computers on the same server', () => {});
        assert.notEqual(first, second);
    """)
    write(root / ".codex" / "hooks" / "inject-workflow-state.py", '''
        """UserPromptSubmit hook that emits <workflow-state> from workflow.md."""
        WORKFLOW_BLOCK_RE = r"\\[workflow-state:([A-Za-z0-9_-]+)\\]"

        def parse_workflow_blocks(root):
            workflow = root / ".trellis" / "workflow.md"
            return workflow.read_text()

        def _read_trellis_config(root):
            return {"codex": {"dispatch_mode": "inline"}}

        def _build_compact_current_state(trellis_dir, hook_input, spec_index_paths):
            return "compact"

        def _build_workflow_state():
            return "<workflow-state>\\nFlow: `trellis-before-dev` -> edit -> `trellis-check` -> validation -> `trellis-update-spec` -> commit\\n</workflow-state>"

        HOOK_EVENT = "UserPromptSubmit"
    ''')
    write(root / ".trellis" / "workflow.md", """
        [workflow-state:in_progress-inline]
        Flow: `trellis-before-dev` -> edit -> `trellis-check` -> validation -> `trellis-update-spec` -> commit (Phase 3.4) -> `/trellis:finish-work`.
        Do not dispatch implement/check sub-agents in inline mode.
        [/workflow-state:in_progress-inline]
    """)


def write_restore_evidence(root: Path, payload: dict) -> Path:
    evidence_dir = (
        root
        / ".trellis"
        / "tasks"
        / "06-29-06-29-initial-release-foundation-reliability-risk-gates"
        / "evidence"
    )
    evidence_dir.mkdir(parents=True, exist_ok=True)
    evidence_path = evidence_dir / "postgres_backup_restore_drill_20260629.json"
    evidence_path.write_text(json.dumps(payload), encoding="utf-8")
    return evidence_path


def archive_foundation_task(root: Path) -> Path:
    task_dir = root / ".trellis" / "tasks" / "06-29-06-29-initial-release-foundation-reliability-risk-gates"
    archive_dir = (
        root
        / ".trellis"
        / "tasks"
        / "archive"
        / "2026-06"
        / "06-29-06-29-initial-release-foundation-reliability-risk-gates"
    )
    archive_dir.parent.mkdir(parents=True, exist_ok=True)
    task_dir.rename(archive_dir)
    return archive_dir


class FoundationGateTests(unittest.TestCase):
    def test_foundation_gate_surfaces_p0_backup_warning_for_static_and_deployed_smoke(self) -> None:
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
            self.assertEqual(report.p0_warnings, 1)
            self.assertFalse(report.ready)
            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["foundation.riskRegister"].status, "passed")
            self.assertEqual(by_name["foundation.riskRegister"].risk_id, "FOUNDATION")
            self.assertEqual(by_name["daemon.commandShape"].status, "passed")
            self.assertEqual(by_name["daemon.distributionArtifact"].status, "passed")
            self.assertEqual(by_name["database.backupRestoreDrill"].status, "warning")
            self.assertEqual(by_name["smoke.ws.daemonAuth"].risk_id, "FR-04")
            self.assertEqual(gate.exit_code_for(report, strict_warnings=False), 2)

    def test_real_backup_restore_evidence_must_include_required_steps(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            write_restore_evidence(
                root,
                {
                    "ready": True,
                    "dryRun": False,
                    "restoreDatabase": "smallkhoj_restore_drill",
                    "steps": [
                        {
                            "name": "verify-restore",
                            "exitCode": 0,
                            "stdoutTail": "1\n",
                        }
                    ],
                },
            )

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["database.backupRestoreDrill"].status, "warning")
            self.assertEqual(by_name["database.backupRestoreDrill"].risk_id, "FR-07")
            self.assertIn("missingSteps", by_name["database.backupRestoreDrill"].details)
            self.assertFalse(report.ready)

    def test_real_backup_restore_evidence_covers_fr07(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            evidence_path = write_restore_evidence(
                root,
                {
                    "ready": True,
                    "dryRun": False,
                    "backupFile": "/backups/smallkhoj_backup.dump",
                    "restoreDatabase": "smallkhoj_restore_drill",
                    "steps": [
                        {"name": "backup", "exitCode": 0, "stdoutTail": ""},
                        {"name": "drop-restore-db-before", "exitCode": 0, "stdoutTail": ""},
                        {"name": "create-restore-db", "exitCode": 0, "stdoutTail": ""},
                        {"name": "restore", "exitCode": 0, "stdoutTail": ""},
                        {"name": "verify-restore", "exitCode": 0, "stdoutTail": "1\n"},
                        {"name": "drop-restore-db-after", "exitCode": 0, "stdoutTail": ""},
                    ],
                },
            )

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["database.backupRestoreDrill"].status, "passed")
            self.assertEqual(by_name["database.backupRestoreDrill"].risk_id, "FR-07")
            self.assertEqual(Path(by_name["database.backupRestoreDrill"].details["evidence"]).resolve(), evidence_path.resolve())
            self.assertNotIn("risk.FR-07.coverage", by_name)

    def test_archived_foundation_task_evidence_is_used(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            evidence_path = write_restore_evidence(
                root,
                {
                    "ready": True,
                    "dryRun": False,
                    "backupFile": "/backups/smallkhoj_backup.dump",
                    "restoreDatabase": "smallkhoj_restore_drill",
                    "steps": [
                        {"name": "backup", "exitCode": 0, "stdoutTail": ""},
                        {"name": "drop-restore-db-before", "exitCode": 0, "stdoutTail": ""},
                        {"name": "create-restore-db", "exitCode": 0, "stdoutTail": ""},
                        {"name": "restore", "exitCode": 0, "stdoutTail": ""},
                        {"name": "verify-restore", "exitCode": 0, "stdoutTail": "1\n"},
                        {"name": "drop-restore-db-after", "exitCode": 0, "stdoutTail": ""},
                    ],
                },
            )
            archived_task = archive_foundation_task(root)
            archived_evidence = archived_task / "evidence" / evidence_path.name

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["foundation.riskRegister"].status, "passed")
            self.assertEqual(by_name["database.backupRestoreDrill"].status, "passed")
            self.assertEqual(Path(by_name["database.backupRestoreDrill"].details["evidence"]).resolve(), archived_evidence.resolve())

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
            self.assertGreaterEqual(payload["p0Warnings"], 1)
            self.assertIn("FR-08", payload["risks"])
            self.assertNotIn("super-secret-password", gate.to_json(report))

    def test_default_gate_blocks_unwired_p0_risks(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)

            report = gate.run_foundation_gate(root=root, base_url=base_url, allow_http=True, timeout=2)

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["risk.FR-01.coverage"].status, "blocked")
            self.assertEqual(by_name["risk.FR-05.coverage"].status, "blocked")
            self.assertEqual(by_name["daemon.runtimeWorkspaceContract"].risk_id, "FR-03")
            self.assertNotIn("risk.FR-03.coverage", by_name)
            self.assertEqual(by_name["database.backupRestoreDrill"].status, "warning")
            self.assertEqual(by_name["secrets.gitignore"].status, "passed")
            self.assertNotIn("risk.FR-08.coverage", by_name)
            self.assertNotIn("risk.FR-07.coverage", by_name)
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

    def test_missing_daemon_distribution_builder_blocks_fr02(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            (root / "scripts" / "build_daemon_distribution.py").unlink()

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["daemon.commandShape"].status, "passed")
            self.assertEqual(by_name["daemon.distributionArtifact"].status, "blocked")
            self.assertEqual(by_name["daemon.distributionArtifact"].risk_id, "FR-02")

    def test_daemon_runtime_workspace_contract_can_cover_fr03(self) -> None:
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

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["daemon.runtimeWorkspaceContract"].status, "passed")
            self.assertEqual(by_name["daemon.runtimeWorkspaceContract"].risk_id, "FR-03")

    def test_daemon_runtime_workspace_contract_fails_when_computer_segment_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            write(root / "agent" / "daemon" / "aaa-daemon" / "src" / "daemon" / "daemon.ts", """
                export function defaultDaemonWorkspaceRoot(env = process.env) {
                  return env.SMALLKHOJ_DAEMON_WORKSPACE_ROOT;
                }
                export function daemonRuntimeWorkspacePath(basePath, options) {
                  return join(basePath, '.slock-runtimes', options.serverId, options.workspaceId);
                }
            """)

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["daemon.runtimeWorkspaceContract"].status, "failed")
            self.assertEqual(by_name["daemon.runtimeWorkspaceContract"].risk_id, "FR-03")
            self.assertIn("computerId", by_name["daemon.runtimeWorkspaceContract"].details["missingMarkers"])

    def test_daemon_minimum_version_contract_can_cover_fr11(self) -> None:
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

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["daemon.minimumVersionContract"].status, "passed")
            self.assertEqual(by_name["daemon.minimumVersionContract"].risk_id, "FR-11")

    def test_daemon_minimum_version_contract_fails_without_426_rejection_test(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            write(root / "backend" / "tests" / "test_daemon_control.py", """
                def test_placeholder():
                    assert True
            """)

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["daemon.minimumVersionContract"].status, "failed")
            self.assertEqual(by_name["daemon.minimumVersionContract"].risk_id, "FR-11")
            self.assertIn("test_daemon_connect_rejects_version_below_minimum", by_name["daemon.minimumVersionContract"].details["missingMarkers"])

    def test_prompt_workflow_state_contract_passes_for_compact_workflow_hook(self) -> None:
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

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["prompt.workflowStateContract"].status, "passed")
            self.assertEqual(by_name["prompt.workflowStateContract"].risk_id, "PROMPT")

    def test_prompt_workflow_state_contract_fails_without_inline_workflow_markers(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            write(root / ".trellis" / "workflow.md", """
                [workflow-state:in_progress-inline]
                Flow: edit -> commit
                [/workflow-state:in_progress-inline]
            """)

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["prompt.workflowStateContract"].status, "failed")
            self.assertEqual(by_name["prompt.workflowStateContract"].risk_id, "PROMPT")
            self.assertIn("trellis-before-dev", by_name["prompt.workflowStateContract"].details["missingMarkers"])

    def test_missing_backup_restore_drill_script_blocks_fr07(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            (root / "scripts" / "postgres_backup_restore_drill.py").unlink()

            report = gate.run_foundation_gate(
                root=root,
                base_url=base_url,
                allow_http=True,
                timeout=2,
                require_all_p0=False,
            )

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["database.backupRestoreDrill"].status, "blocked")
            self.assertEqual(by_name["database.backupRestoreDrill"].risk_id, "FR-07")

    def test_missing_server_account_scope_tests_warn_fr01(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)

            def fake_run(command, **kwargs):
                return type(
                    "Completed",
                    (),
                    {
                        "returncode": 0,
                        "stdout": "target tests passed",
                        "stderr": "",
                    },
                )()

            original_run = gate.subprocess.run
            try:
                gate.subprocess.run = fake_run
                report = gate.run_foundation_gate(
                    root=root,
                    base_url=base_url,
                    allow_http=True,
                    timeout=2,
                    include_backend_tests=True,
                )
            finally:
                gate.subprocess.run = original_run

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["server.accountScopeBackendTests"].status, "warning")
            self.assertEqual(by_name["server.accountScopeBackendTests"].risk_id, "FR-01")
            self.assertNotIn("risk.FR-01.coverage", by_name)
            self.assertFalse(report.ready)
            self.assertEqual(gate.exit_code_for(report, strict_warnings=False), 2)

    def test_server_account_scope_tests_can_cover_fr01(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            write(root / "backend" / "tests" / "test_server_account_membership.py", """
                def test_placeholder():
                    assert True
            """)

            observed = {"commands": []}

            def fake_run(command, **kwargs):
                observed["commands"].append(command)
                return type(
                    "Completed",
                    (),
                    {
                        "returncode": 0,
                        "stdout": "1 passed",
                        "stderr": "",
                    },
                )()

            original_run = gate.subprocess.run
            try:
                gate.subprocess.run = fake_run
                report = gate.run_foundation_gate(
                    root=root,
                    base_url=base_url,
                    allow_http=True,
                    timeout=2,
                    include_backend_tests=True,
                )
            finally:
                gate.subprocess.run = original_run

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["server.accountScopeBackendTests"].status, "passed")
            self.assertEqual(by_name["server.accountScopeBackendTests"].risk_id, "FR-01")
            self.assertNotIn("risk.FR-01.coverage", by_name)
            self.assertTrue(any("tests/test_server_account_membership.py" in command for command in observed["commands"]))

    def test_backend_daemon_identity_tests_can_cover_fr03(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)

            observed = {"commands": []}

            def fake_run(command, **kwargs):
                observed["commands"].append(command)
                return type(
                    "Completed",
                    (),
                    {
                        "returncode": 0,
                        "stdout": "7 passed",
                        "stderr": "",
                    },
                )()

            original_run = gate.subprocess.run
            try:
                gate.subprocess.run = fake_run
                report = gate.run_foundation_gate(
                    root=root,
                    base_url=base_url,
                    allow_http=True,
                    timeout=2,
                    include_backend_tests=True,
                )
            finally:
                gate.subprocess.run = original_run

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["daemon.identityBackendTests"].status, "passed")
            self.assertEqual(by_name["daemon.identityBackendTests"].risk_id, "FR-03")
            self.assertNotIn("risk.FR-03.coverage", by_name)
            self.assertTrue(
                any(
                    "tests/test_daemon_control.py::test_daemon_connect_reuses_offline_same_name_computer_when_machine_id_changed" in command
                    for command in observed["commands"]
                )
            )

    def test_backend_taskrun_tests_can_cover_fr05(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, FakeDeploymentServer() as base_url:
            root = Path(tmp)
            make_foundation_repo(root)
            commands = []

            def fake_run(command, **kwargs):
                commands.append(command)
                return type(
                    "Completed",
                    (),
                    {
                        "returncode": 0,
                        "stdout": "tests passed",
                        "stderr": "",
                    },
                )()

            original_run = gate.subprocess.run
            try:
                gate.subprocess.run = fake_run
                report = gate.run_foundation_gate(
                    root=root,
                    base_url=base_url,
                    allow_http=True,
                    timeout=2,
                    include_backend_tests=True,
                )
            finally:
                gate.subprocess.run = original_run

            by_name = {check.name: check for check in report.checks}
            self.assertEqual(by_name["taskrun.lifecycleBackendTests"].status, "passed")
            self.assertEqual(by_name["taskrun.lifecycleBackendTests"].risk_id, "FR-05")
            self.assertNotIn("risk.FR-05.coverage", by_name)
            self.assertTrue(any("tests/test_task_runs.py::test_serialize_completed_task_run_classifies_missing_evidence" in command for command in commands))


if __name__ == "__main__":
    unittest.main()
