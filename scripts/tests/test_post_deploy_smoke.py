import json
import os
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scripts import post_deploy_smoke as smoke


TEST_DAEMON_PACKAGE_VERSION = json.loads(
    (
        Path(__file__).resolve().parents[2]
        / "agent"
        / "daemon"
        / "aaa-daemon"
        / "package.json"
    ).read_text(encoding="utf-8")
)["version"]


class FakeDeploymentHandler(BaseHTTPRequestHandler):
    health_status = "ok"
    daemon_ws_status = 403
    daemon_package_status = 200

    def log_message(self, format: str, *args) -> None:
        return

    def do_GET(self) -> None:
        if self.path == "/":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<!doctype html><html><body>SmallKhoj</body></html>")
            return
        if self.path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": self.health_status, "version": "test"}).encode())
            return
        if self.path == "/docs":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"<html>Docs</html>")
            return
        if self.path == "/openapi.json":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"openapi": "3.1.0", "paths": {"/api/health": {}}}).encode())
            return
        if self.path == (
            "/downloads/smallkhoj-daemon/"
            f"{smoke.DAEMON_PACKAGE_NAME}-{TEST_DAEMON_PACKAGE_VERSION}.tgz"
        ):
            self.send_response(self.daemon_package_status)
            self.send_header("Content-Type", "application/x-tar")
            self.end_headers()
            if self.daemon_package_status == 200:
                self.wfile.write(b"tgz-bytes")
            return
        if self.path == "/internal/agent-api/ws":
            self.send_response(self.daemon_ws_status)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()


class FakeDeploymentServer:
    def __init__(
        self,
        *,
        health_status: str = "ok",
        daemon_ws_status: int = 403,
        daemon_package_status: int = 200,
    ) -> None:
        self.handler = type(
            "Handler",
            (FakeDeploymentHandler,),
            {
                "health_status": health_status,
                "daemon_ws_status": daemon_ws_status,
                "daemon_package_status": daemon_package_status,
            },
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.previous_daemon_release_version = os.environ.get("DAEMON_RELEASE_VERSION")
        os.environ["DAEMON_RELEASE_VERSION"] = TEST_DAEMON_PACKAGE_VERSION
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __exit__(self, exc_type, exc, tb) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        if self.previous_daemon_release_version is None:
            os.environ.pop("DAEMON_RELEASE_VERSION", None)
        else:
            os.environ["DAEMON_RELEASE_VERSION"] = self.previous_daemon_release_version


class PostDeploySmokeTests(unittest.TestCase):
    def test_package_selection_prefers_explicit_version(self) -> None:
        selection = smoke.select_daemon_package_version(
            "9.9.9",
            artifact_dir=Path("/path/that/does/not/exist"),
            environ={},
        )

        self.assertEqual(selection.version, "9.9.9")
        self.assertEqual(selection.source, "--daemon-package-version")
        self.assertIsNone(selection.error)

    def test_package_selection_reads_one_generated_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            artifact_dir = Path(tmp)
            package_name = f"{smoke.DAEMON_PACKAGE_NAME}-{TEST_DAEMON_PACKAGE_VERSION}.tgz"
            (artifact_dir / package_name).write_bytes(b"tgz")
            (artifact_dir / "release.manifest.json").write_text(
                json.dumps({"version": TEST_DAEMON_PACKAGE_VERSION, "npmPackage": package_name}),
                encoding="utf-8",
            )

            selection = smoke.select_daemon_package_version(artifact_dir=artifact_dir, environ={})

        self.assertEqual(selection.version, TEST_DAEMON_PACKAGE_VERSION)
        self.assertEqual(selection.source, "release-artifacts")

    def test_package_selection_fails_closed_without_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            selection = smoke.select_daemon_package_version(
                artifact_dir=Path(tmp),
                environ={},
            )

        self.assertIsNone(selection.version)
        self.assertIn("not configured", selection.error or "")

    def test_successful_smoke_with_allow_http(self) -> None:
        with FakeDeploymentServer() as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=True, timeout=2)

        self.assertTrue(report.ready)
        self.assertEqual(report.failures, 0)
        self.assertEqual(report.warnings, 0)
        self.assertTrue(any(check.name == "http.health" for check in report.checks))
        self.assertTrue(any(check.name == "http.daemonPackage" for check in report.checks))
        self.assertTrue(any(check.name == "ws.daemonAuth" for check in report.checks))

    def test_daemon_package_must_be_downloadable(self) -> None:
        with FakeDeploymentServer(daemon_package_status=404) as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=True, timeout=2)

        by_name = {check.name: check for check in report.checks}
        self.assertFalse(report.ready)
        self.assertEqual(by_name["http.daemonPackage"].status, "failed")

    def test_daemon_websocket_no_auth_rejection_proves_route(self) -> None:
        with FakeDeploymentServer(daemon_ws_status=403) as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=True, timeout=2)

        by_name = {check.name: check for check in report.checks}
        self.assertTrue(report.ready)
        self.assertEqual(by_name["ws.daemonAuth"].status, "passed")
        self.assertEqual(by_name["ws.daemonAuth"].details["status"], 403)

    def test_daemon_websocket_must_not_accept_without_auth(self) -> None:
        with FakeDeploymentServer(daemon_ws_status=101) as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=True, timeout=2)

        by_name = {check.name: check for check in report.checks}
        self.assertFalse(report.ready)
        self.assertEqual(by_name["ws.daemonAuth"].status, "failed")

    def test_http_scheme_warns_without_allow_http(self) -> None:
        with FakeDeploymentServer() as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=False, timeout=2)

        by_name = {check.name: check for check in report.checks}
        self.assertTrue(report.ready)
        self.assertEqual(by_name["url.scheme"].status, "warning")
        self.assertEqual(smoke.exit_code_for(report, strict_warnings=False), 0)
        self.assertEqual(smoke.exit_code_for(report, strict_warnings=True), 2)

    def test_health_status_must_be_ok(self) -> None:
        with FakeDeploymentServer(health_status="degraded") as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=True, timeout=2)

        by_name = {check.name: check for check in report.checks}
        self.assertFalse(report.ready)
        self.assertEqual(by_name["http.health"].status, "failed")
        self.assertEqual(smoke.exit_code_for(report, strict_warnings=False), 1)

    def test_json_output_omits_response_bodies(self) -> None:
        with FakeDeploymentServer() as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=True, timeout=2)

        payload = smoke.to_json(report)
        self.assertIn('"baseUrl"', payload)
        self.assertNotIn("<!doctype html>", payload)


if __name__ == "__main__":
    unittest.main()
