import tempfile
import textwrap
import unittest
from pathlib import Path

from scripts import initial_release_deploy_preflight as preflight


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")


def make_repo(root: Path, *, standalone: bool = True) -> None:
    write(root / "docker-compose.prod.yml", """
        name: smallkhoj-prod
        services:
          db:
            image: pgvector/pgvector:pg16
          backend:
            image: smallkhoj-backend:latest
            expose:
              - "8000"
          frontend:
            image: smallkhoj-frontend:latest
            expose:
              - "3000"
          feishu-worker:
            image: smallkhoj-backend:latest
            profiles:
              - feishu-worker
          caddy:
            image: caddy:2
            ports:
              - "80:80"
              - "443:443"
    """)
    write(root / "deploy" / "Caddyfile", """
        {$SMALLKHOJ_SITE_ADDRESS:localhost} {
          @backend_api path /api /api/*
          reverse_proxy @backend_api backend:8000
          @backend_internal path /internal /internal/*
          reverse_proxy @backend_internal backend:8000
          @backend_docs path /docs /docs/* /openapi.json
          reverse_proxy @backend_docs backend:8000
          reverse_proxy frontend:3000
        }
    """)
    output_line = 'output: "standalone",' if standalone else ""
    write(root / "frontend" / "next.config.mjs", f"""
        const nextConfig = {{
          allowedDevOrigins: ["127.0.0.1"],
          {output_line}
        }}
        export default nextConfig
    """)
    write(root / "frontend" / "Dockerfile", """
        FROM oven/bun:1 AS runner
        COPY --from=builder /app/.next/standalone ./
        COPY --from=builder /app/.next/static ./.next/static
        CMD ["bun", "run", "server.js"]
    """)


class DeployPreflightTests(unittest.TestCase):
    def test_repo_config_passes_for_expected_deploy_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)

            report = preflight.run_preflight(root=root)

            self.assertTrue(report.ready)
            self.assertEqual(report.failures, 0)
            self.assertTrue(any(check.name == "repo.frontend.standalone" for check in report.checks))

    def test_repo_config_fails_when_standalone_output_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, standalone=False)

            report = preflight.run_preflight(root=root)

            self.assertFalse(report.ready)
            failed = [check for check in report.checks if check.name == "repo.frontend.standalone"]
            self.assertEqual(failed[0].status, "failed")

    def test_env_file_reports_missing_required_values_without_secret_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            env_file = root / ".env.prod"
            write(env_file, """
                SMALLKHOJ_SITE_ADDRESS=smallkhoj.example.com
                SMALLKHOJ_BACKEND_IMAGE=registry/smallkhoj-backend:test
            """)

            report = preflight.run_preflight(root=root, env_file=env_file)

            self.assertFalse(report.ready)
            env_check = next(check for check in report.checks if check.name == "env.required")
            self.assertEqual(env_check.status, "failed")
            self.assertEqual(
                env_check.details,
                {"missing": ["SMALLKHOJ_FRONTEND_IMAGE", "POSTGRES_PASSWORD", "BACKEND_CORS_ORIGINS"]},
            )
            self.assertNotIn("registry/smallkhoj-backend:test", preflight.to_json(report))

    def test_warning_exit_semantics(self) -> None:
        report = preflight.PreflightReport(
            checks=[
                preflight.CheckResult(
                    name="env.siteAddress",
                    status="warning",
                    reason_code="DEPLOY_PREFLIGHT_SITE_ADDRESS_LOCAL",
                    reason="Site address is local.",
                )
            ]
        )

        self.assertEqual(preflight.exit_code_for(report, strict_warnings=False), 0)
        self.assertEqual(preflight.exit_code_for(report, strict_warnings=True), 2)


if __name__ == "__main__":
    unittest.main()
