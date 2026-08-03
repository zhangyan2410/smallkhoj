import json
import re
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"


class DeliveryContractTest(unittest.TestCase):
    def test_backend_root_build_context_excludes_local_env_files(self):
        dockerfile = (ROOT / "backend" / "Dockerfile").read_text()
        dockerignore = (ROOT / ".dockerignore").read_text().splitlines()

        self.assertIn("COPY backend/ ./", dockerfile)
        self.assertIn("COPY release-artifacts/ /app/release-artifacts/", dockerfile)
        for pattern in ("**/.env", "**/.env.*", "!**/.env.example"):
            self.assertIn(pattern, dockerignore)

    def test_ci_requires_real_backend_and_frontend_gates(self):
        workflow = WORKFLOW.read_text()
        makefile = (ROOT / "Makefile").read_text()

        for fragment in (
            "services:",
            "postgres:",
            "SMALLKHOJ_MIGRATION_TEST_ADMIN_URL",
            "SMALLKHOJ_MIGRATION_TEST_DATABASE_URL",
            "NEXT_PUBLIC_DEPLOYMENT_ENV: production",
            "NEXT_PUBLIC_API_KEY:",
            "git diff --check",
            "make backend-ci",
            "make frontend-ci",
        ):
            self.assertIn(fragment, workflow)

        for fragment in (
            "uv lock --check",
            "uv sync --dev --locked",
            "uv run alembic upgrade head",
            "uv run alembic check",
            "uv run pytest -q",
            "uv run ruff check .",
            "bun install --frozen-lockfile",
            "NODE_ENV=test NEXT_PUBLIC_DEPLOYMENT_ENV=local-dev NEXT_PUBLIC_API_KEY= bun run test",
            "bun run lint",
            "bun run typecheck",
            "bun run typecheck:e2e",
            "bun run build",
            "python3 scripts/validate_delivery_env.py backend",
            "docker image inspect --format",
            "node --check tools/twd-guard/twd-auth-guard.mjs",
            "node --test tools/twd-guard/twd-auth-guard.test.mjs",
        ):
            self.assertIn(fragment, makefile)

        self.assertNotIn("uv sync --dev --frozen", makefile)

        self.assertNotIn("continue-on-error: true", workflow)

    def test_source_hygiene_installs_webdriver_requirements_before_scripts_tests(self):
        workflow = WORKFLOW.read_text()
        source_job = workflow.split("  source-hygiene:", 1)[1].split("  backend:", 1)[0]
        install_command = (
            "python3 -m pip install --requirement "
            "agent/daemon/webdriver/requirements.txt"
        )

        self.assertIn(install_command, source_job)
        self.assertLess(source_job.index(install_command), source_job.index("make scripts-test"))

    def test_ci_runs_authenticated_flow_against_disposable_services(self):
        workflow = WORKFLOW.read_text()
        self.assertIn("  authenticated-e2e:", workflow)
        e2e_job = workflow.split("  authenticated-e2e:", 1)[1]

        for fragment in (
            "needs: [backend, frontend]",
            "E2E_DATABASE_SCOPE: disposable",
            "E2E_PUBLIC_API_KEY:",
            "E2E_RUN_NAMESPACE:",
            "make migration-check",
            "uv run uvicorn main:app",
            "http://127.0.0.1:8000/api/health",
            "make frontend-image-build",
            "docker run",
            "playwright install --with-deps chromium",
            "make e2e-authenticated",
            'grep -Fq -- "$value" "${logs[@]}"',
            'grep -Eq -- "$pattern" "${logs[@]}"',
            'scan_exact "auth bridge secret" "$AUTH_BRIDGE_SECRET"',
            'scan_exact "Better Auth secret" "$BETTER_AUTH_SECRET"',
            "sk_(session|connect|machine)_[A-Za-z0-9_-]+",
            'test -r "${RUNNER_TEMP}/smallkhoj-backend.log"',
            'test -r "${RUNNER_TEMP}/smallkhoj-frontend.log"',
        ):
            self.assertIn(fragment, e2e_job)

        self.assertNotIn("continue-on-error: true", e2e_job)
        self.assertNotIn("rg --quiet", e2e_job)
        self.assertNotIn("bun run start", e2e_job)
        self.assertNotIn("for attempt in", e2e_job)
        self.assertIn("--network host", e2e_job)
        self.assertIn("--env INTERNAL_API_BASE_URL", e2e_job)
        self.assertIn("--env BETTER_AUTH_DATABASE_URL", e2e_job)
        self.assertNotIn("host.docker.internal", e2e_job)
        self.assertNotIn("--env BETTER_AUTH_DATABASE_URL=", e2e_job)
        self.assertIn("agent/daemon/aaa-daemon/package.json", e2e_job)
        self.assertIn("DAEMON_RELEASE_VERSION=$daemon_version", e2e_job)
        self.assertIn("E2E_DAEMON_VERSION=$daemon_version", e2e_job)
        self.assertIn('"$GITHUB_ENV"', e2e_job)
        self.assertIn("Daemon package version must be a stable semantic version", e2e_job)
        self.assertIn("sys.exit(", e2e_job)
        self.assertNotIn("assert isinstance(value", e2e_job)
        for variable in (
            "daemon_version",
            "DAEMON_RELEASE_VERSION",
            "E2E_DAEMON_VERSION",
        ):
            self.assertNotRegex(
                e2e_job,
                rf"(?m){variable}(?:\s*:|=)\s*[\"']?\d+\.\d+\.\d+",
                f"{variable} must be derived from package.json, not assigned a version literal",
            )

    def test_local_command_matrix_matches_ci(self):
        makefile = (ROOT / "Makefile").read_text()
        for target in (
            "test:",
            "test-backend:",
            "test-frontend:",
            "lint:",
            "typecheck:",
            "build-frontend:",
            "backend-ci:",
            "frontend-ci:",
            "e2e-authenticated:",
            "verify-backend-env:",
            "verify-frontend-env:",
            "verify-e2e-env:",
            "frontend-image-build:",
            "ci:",
        ):
            self.assertIn(target, makefile)
        self.assertGreaterEqual(makefile.count('E2E_DATABASE_SCOPE" = "disposable"'), 2)
        self.assertIn("python3 scripts/validate_delivery_env.py backend", makefile)
        self.assertIn("python3 scripts/validate_delivery_env.py e2e", makefile)

    def test_bun_is_the_only_frontend_package_manager_truth(self):
        package = json.loads((FRONTEND / "package.json").read_text())

        self.assertEqual(package["packageManager"], "bun@1.3.14")
        self.assertIn("test", package["scripts"])
        self.assertEqual(package["scripts"]["typecheck"], "tsc --noEmit")
        self.assertEqual(
            package["scripts"]["typecheck:e2e"],
            "tsc --noEmit -p tsconfig.e2e.json",
        )
        self.assertTrue(
            package["scripts"]["e2e"].startswith(
                "python3 ../scripts/validate_delivery_env.py e2e && "
            ),
            "the directly documented Bun E2E entrypoint must fail closed before Playwright",
        )
        self.assertTrue((FRONTEND / "tsconfig.e2e.json").is_file())
        self.assertTrue((FRONTEND / "bun.lock").is_file())
        self.assertFalse((FRONTEND / "package-lock.json").exists())
        self.assertFalse((FRONTEND / "pnpm-lock.yaml").exists())
        self.assertFalse((FRONTEND / "yarn.lock").exists())
        self.assertFalse((FRONTEND / ".yarn").exists())

        self.assertNotIn("react-use-websocket", package["dependencies"])
        self.assertIn("ws", package["dependencies"])
        self.assertIn("@types/ws", package["devDependencies"])
        self.assertFalse((FRONTEND / "hooks" / "use-websocket.ts").exists())
        self.assertIn('from "ws"', (FRONTEND / "server.ts").read_text())
        self.assertFalse((FRONTEND / ".runtime").exists())
        self.assertIn("/frontend/.runtime/", (ROOT / ".gitignore").read_text().splitlines())

        tracked_frontend = subprocess.run(
            ["git", "ls-files", "frontend"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
        unsupported_tracked_command = re.compile(
            r"(?:^|[ `$])(?:npm|yarn|pnpm)\s+"
            r"(?:add|build|ci|dev|e2e|install|lint|remove|run|start|test|typecheck)",
            re.IGNORECASE | re.MULTILINE,
        )
        for relative in tracked_frontend:
            path = ROOT / relative
            if not path.is_file():
                continue
            try:
                source = path.read_text()
            except UnicodeDecodeError:
                continue
            self.assertIsNone(unsupported_tracked_command.search(source), relative)

        dockerfile = (FRONTEND / "Dockerfile").read_text()
        self.assertEqual(dockerfile.count("FROM oven/bun:1.3.14"), 2)
        self.assertNotIn("FROM oven/bun:1 ", dockerfile)
        self.assertIn("USER bun", dockerfile)
        self.assertIn("--chown=bun:bun", dockerfile)
        dockerignore = (FRONTEND / ".dockerignore").read_text().splitlines()
        for ignored in (
            ".env*",
            "!.env.example",
            ".runtime",
            "test-results",
            "playwright-report",
            "coverage",
            "*.log",
            "*.pid",
        ):
            self.assertIn(ignored, dockerignore)

    def test_docs_separate_committed_flow_from_ui_acceptance(self):
        docs = {
            "frontend README": (FRONTEND / "README.md").read_text(),
            "multi-agent workflow": (ROOT / "docs" / "multi-agent-development-workflow.md").read_text(),
            "deployment spec": (ROOT / ".trellis" / "spec" / "backend" / "deployment-environment-contracts.md").read_text(),
        }
        agents = (ROOT / "AGENTS.md").read_text()

        self.assertIn("bun install --frozen-lockfile", docs["frontend README"])
        self.assertIn("bun run test", docs["frontend README"])
        unsupported_frontend_command = re.compile(
            r"(?:^|[ `$])(?:npm|yarn|pnpm)\s+"
            r"(?:add|build|ci|dev|e2e|install|lint|remove|run|start|test|typecheck)",
            re.IGNORECASE | re.MULTILINE,
        )
        self.assertIsNone(
            unsupported_frontend_command.search(docs["frontend README"]),
            "frontend README",
        )
        workflow_frontend = docs["multi-agent workflow"].split("Frontend:", 1)[1].split(
            "Daemon:", 1
        )[0]
        self.assertIsNone(
            unsupported_frontend_command.search(workflow_frontend),
            "multi-agent workflow frontend section",
        )
        self.assertNotIn("rtk pnpm dev", docs["deployment spec"])
        self.assertIn("rtk bun run dev", docs["deployment spec"])
        self.assertIn("npm install", docs["multi-agent workflow"])
        self.assertIn("npm test", docs["multi-agent workflow"])
        self.assertIn("committed Playwright", agents)
        self.assertIn("./twd", agents)
        self.assertIn("not UI acceptance", agents)

    def test_e2e_source_has_no_literal_or_url_credential(self):
        e2e_source = (ROOT / "e2e" / "management-flow.spec.ts").read_text()
        workflow = WORKFLOW.read_text()
        capsule = (ROOT / "docs" / "bug-report" / "authenticated-management-flow" / "bug-report.md").read_text()
        known_development_key = "sk_" + "public_" + "local"

        for source in (e2e_source, workflow, capsule):
            self.assertNotIn(known_development_key, source)
            self.assertNotRegex(source, r"[?&](api_key|token)=")
        self.assertIn("E2E_PUBLIC_API_KEY", e2e_source)
        self.assertIn("E2E_RUN_NAMESPACE", e2e_source)
        self.assertIn("E2E_DATABASE_SCOPE", e2e_source)
        self.assertIn('requiredEnv("E2E_DAEMON_VERSION")', e2e_source)
        self.assertIn('requiredEnv("API_BASE")', e2e_source)
        self.assertIn('requiredEnv("FRONTEND_BASE")', e2e_source)
        self.assertIn("smallkhoj_session", e2e_source)
        self.assertIn("smallkhoj_active_server", e2e_source)
        authenticated_marker = "await expect(page.locator('[data-region=\"server-switcher\"]')).toBeVisible()"
        self.assertIn(authenticated_marker, e2e_source)
        self.assertLess(
            e2e_source.index(authenticated_marker),
            e2e_source.index("const cookies = await context.cookies()"),
            "the flow must wait for authenticated server HTML before reading server-action cookies",
        )
        self.assertIn("X-Server-Id", e2e_source)
        self.assertIn("/api/v1/auth/logout", e2e_source)
        self.assertIn("staleSession.status()).toBe(401)", e2e_source)
        self.assertIn('toContainText("--api-key")', e2e_source)
        self.assertIn("daemonVersion: DAEMON_VERSION", e2e_source)
        self.assertNotIn("SLOCK_CONNECT_TOKEN=", e2e_source)
        self.assertIn("cursor-live-", e2e_source)
        self.assertNotIn("collectEvents(ws, durationMs", e2e_source)
        self.assertNotIn(
            "target: `#${channel.channel.name}`",
            e2e_source,
            "the channel API already returns the canonical #name label",
        )
        self.assertIn("target: channel.channel.name", e2e_source)


if __name__ == "__main__":
    unittest.main()
