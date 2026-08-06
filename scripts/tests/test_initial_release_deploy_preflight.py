import tempfile
import textwrap
import unittest
from pathlib import Path

from scripts import initial_release_deploy_preflight as preflight


def write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(content).strip() + "\n", encoding="utf-8")


def make_repo(
    root: Path,
    *,
    standalone: bool = True,
    overridable_ports: bool = False,
    caddy_build: bool = True,
) -> None:
    caddy_ports = (
        """
              - "${SMALLKHOJ_HTTP_PORT:-80}:80"
              - "${SMALLKHOJ_HTTPS_PORT:-443}:443"
        """
        if overridable_ports
        else """
              - "80:80"
              - "443:443"
        """
    )
    caddy_build_block = (
        """
            build:
              context: ./deploy/caddy
        """
        if caddy_build
        else ""
    )
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
    """ + caddy_build_block + """
            ports:
    """ + caddy_ports)
    write(root / "deploy" / "caddy" / "Caddyfile", """
        {$SMALLKHOJ_SITE_ADDRESS:localhost} {
          @backend_api path /api /api/*
          reverse_proxy @backend_api backend:8000
          @backend_internal path /internal /internal/*
          reverse_proxy @backend_internal backend:8000
          @backend_docs path /docs /docs/* /openapi.json
          reverse_proxy @backend_docs backend:8000
          @backend_downloads path /downloads/smallkhoj-daemon /downloads/smallkhoj-daemon/*
          reverse_proxy @backend_downloads backend:8000
          reverse_proxy frontend:3000
        }
    """)
    write(root / "deploy" / "caddy" / "Dockerfile", """
        FROM caddy:2
        COPY Caddyfile /etc/caddy/Caddyfile
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
        FROM oven/bun:1 AS builder
        ARG BETTER_AUTH_SECRET=sk_better_auth_build_placeholder_min_32_chars
        ARG BETTER_AUTH_URL=http://localhost
        ARG BETTER_AUTH_DATABASE_URL=postgresql://smallkhoj:smallkhoj@localhost:5432/smallkhoj
        ARG AUTH_BRIDGE_SECRET=sk_auth_bridge_build_placeholder_min_32_chars
        ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
        ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
        ENV BETTER_AUTH_DATABASE_URL=$BETTER_AUTH_DATABASE_URL
        ENV AUTH_BRIDGE_SECRET=$AUTH_BRIDGE_SECRET
        RUN bun run build
        FROM oven/bun:1 AS runner
        COPY --from=builder /app/.next/standalone ./
        COPY --from=builder /app/.next/static ./.next/static
        CMD ["bun", "run", "server.js"]
    """)
    write(root / "backend" / "Dockerfile", """
        FROM python:3.12-slim
        WORKDIR /app/backend
        COPY backend/ ./
        COPY release-artifacts/ /app/release-artifacts/
        CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
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

    def test_repo_config_accepts_overridable_caddy_host_ports(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, overridable_ports=True)

            report = preflight.run_preflight(root=root)

            self.assertTrue(report.ready)
            self.assertEqual(report.failures, 0)
            port_check = next(check for check in report.checks if check.name == "repo.compose.caddyPorts")
            self.assertEqual(port_check.status, "passed")

    def test_repo_config_fails_without_caddy_build_contract(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, caddy_build=False)

            report = preflight.run_preflight(root=root)

            self.assertFalse(report.ready)
            build_check = next(check for check in report.checks if check.name == "repo.compose.caddyBuild")
            self.assertEqual(build_check.status, "failed")

    def test_repo_config_fails_when_standalone_output_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root, standalone=False)

            report = preflight.run_preflight(root=root)

            self.assertFalse(report.ready)
            failed = [check for check in report.checks if check.name == "repo.frontend.standalone"]
            self.assertEqual(failed[0].status, "failed")

    def test_repo_config_fails_when_frontend_build_auth_env_is_missing(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            write(root / "frontend" / "Dockerfile", """
                FROM oven/bun:1 AS runner
                COPY --from=builder /app/.next/standalone ./
                COPY --from=builder /app/.next/static ./.next/static
                CMD ["bun", "run", "server.js"]
            """)

            report = preflight.run_preflight(root=root)

            self.assertFalse(report.ready)
            failed = [check for check in report.checks if check.name == "repo.frontend.buildAuthEnv"]
            self.assertEqual(failed[0].status, "failed")

    def test_repo_config_passes_when_build_runs_in_multiline_buildkit_secret_run(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            # The production Dockerfile executes `bun run build` inside a
            # multi-line RUN block that mounts a BuildKit secret. The gate must
            # recognize this without weakening the auth-env contract.
            write(root / "frontend" / "Dockerfile", """
                FROM oven/bun:1 AS builder
                ARG BETTER_AUTH_SECRET=sk_better_auth_build_placeholder_min_32_chars
                ARG BETTER_AUTH_URL=http://localhost
                ARG BETTER_AUTH_DATABASE_URL=postgresql://smallkhoj:smallkhoj@localhost:5432/smallkhoj
                ARG AUTH_BRIDGE_SECRET=sk_auth_bridge_build_placeholder_min_32_chars
                ENV BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET
                ENV BETTER_AUTH_URL=$BETTER_AUTH_URL
                ENV BETTER_AUTH_DATABASE_URL=$BETTER_AUTH_DATABASE_URL
                ENV AUTH_BRIDGE_SECRET=$AUTH_BRIDGE_SECRET
                RUN --mount=type=secret,id=public_api_key \\
                    public_api_key=""; \\
                    if [ "$NEXT_PUBLIC_DEPLOYMENT_ENV" = "local-dev" ]; then \\
                      public_api_key="$NEXT_PUBLIC_API_KEY"; \\
                    fi; \\
                    NEXT_PUBLIC_API_KEY="$public_api_key" bun run build
                FROM oven/bun:1 AS runner
                COPY --from=builder /app/.next/standalone ./
                COPY --from=builder /app/.next/static ./.next/static
                CMD ["bun", "run", "server.js"]
            """)

            report = preflight.run_preflight(root=root)

            self.assertTrue(report.ready)
            self.assertEqual(report.failures, 0)
            build_check = next(check for check in report.checks if check.name == "repo.frontend.buildAuthEnv")
            self.assertEqual(build_check.status, "passed")

    def test_repo_config_fails_when_backend_image_omits_daemon_release_artifacts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            write(root / "backend" / "Dockerfile", """
                FROM python:3.12-slim
                WORKDIR /app
                COPY backend/ ./
                CMD ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
            """)

            report = preflight.run_preflight(root=root)

            self.assertFalse(report.ready)
            failed = [check for check in report.checks if check.name == "repo.backend.daemonArtifacts"]
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
                {
                    "missing": [
                        "SMALLKHOJ_FRONTEND_IMAGE",
                        "POSTGRES_PASSWORD",
                        "BACKEND_CORS_ORIGINS",
                        "BETTER_AUTH_SECRET",
                        "BETTER_AUTH_URL",
                        "AUTH_BRIDGE_SECRET",
                        "MINIMUM_DAEMON_VERSION",
                        "DAEMON_RELEASE_VERSION",
                    ],
                    "placeholder": [],
                },
            )
            self.assertNotIn("registry/smallkhoj-backend:test", preflight.to_json(report))

    def test_env_file_reports_placeholder_values_as_missing_without_leaking_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            env_file = root / ".env.prod"
            write(env_file, """
                SMALLKHOJ_SITE_ADDRESS=<domain-or-ip-site-address>
                SMALLKHOJ_BACKEND_IMAGE=<registry>/smallkhoj-backend:<tag>
                SMALLKHOJ_FRONTEND_IMAGE=<registry>/smallkhoj-frontend:<tag>
                POSTGRES_PASSWORD=<set-outside-repo>
                BACKEND_CORS_ORIGINS=<public-origin>
                BETTER_AUTH_SECRET=<set-outside-repo>
                BETTER_AUTH_URL=<public-origin>
                AUTH_BRIDGE_SECRET=<set-outside-repo>
                MINIMUM_DAEMON_VERSION=<compatibility-floor>
                DAEMON_RELEASE_VERSION=<published-package-version>
            """)

            report = preflight.run_preflight(root=root, env_file=env_file)

            self.assertFalse(report.ready)
            env_check = next(check for check in report.checks if check.name == "env.required")
            self.assertEqual(env_check.status, "failed")
            self.assertEqual(
                env_check.details,
                {
                    "missing": [],
                    "placeholder": [
                        "SMALLKHOJ_SITE_ADDRESS",
                        "SMALLKHOJ_BACKEND_IMAGE",
                        "SMALLKHOJ_FRONTEND_IMAGE",
                        "POSTGRES_PASSWORD",
                        "BACKEND_CORS_ORIGINS",
                        "BETTER_AUTH_SECRET",
                        "BETTER_AUTH_URL",
                        "AUTH_BRIDGE_SECRET",
                        "MINIMUM_DAEMON_VERSION",
                        "DAEMON_RELEASE_VERSION",
                    ],
                },
            )
            payload = preflight.to_json(report)
            self.assertNotIn("<set-outside-repo>", payload)
            self.assertNotIn("<registry>/smallkhoj-backend:<tag>", payload)
            self.assertNotIn("<domain-or-ip-site-address>", payload)
            self.assertNotIn("<public-origin>", payload)

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

    def test_env_file_rejects_non_semantic_daemon_release_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            make_repo(root)
            env_file = root / ".env.prod"
            write(env_file, """
                SMALLKHOJ_SITE_ADDRESS=smallkhoj.example.com
                SMALLKHOJ_BACKEND_IMAGE=registry/smallkhoj-backend:test
                SMALLKHOJ_FRONTEND_IMAGE=registry/smallkhoj-frontend:test
                POSTGRES_PASSWORD=secret
                BACKEND_CORS_ORIGINS=https://smallkhoj.example.com
                BETTER_AUTH_SECRET=abcdefghijklmnopqrstuvwxyz123456
                BETTER_AUTH_URL=https://smallkhoj.example.com
                AUTH_BRIDGE_SECRET=abcdefghijklmnopqrstuvwxyz123456
                MINIMUM_DAEMON_VERSION=0.0.1
                DAEMON_RELEASE_VERSION=latest
            """)

            report = preflight.run_preflight(root=root, env_file=env_file)

            check = next(check for check in report.checks if check.name == "env.daemonReleaseVersion")
            self.assertEqual(check.status, "failed")


if __name__ == "__main__":
    unittest.main()
