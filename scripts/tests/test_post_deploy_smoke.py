import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from scripts import post_deploy_smoke as smoke


class FakeDeploymentHandler(BaseHTTPRequestHandler):
    health_status = "ok"
    daemon_ws_status = 403

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
        if self.path == "/internal/agent-api/ws":
            self.send_response(self.daemon_ws_status)
            self.end_headers()
            return
        self.send_response(404)
        self.end_headers()


class FakeDeploymentServer:
    def __init__(self, *, health_status: str = "ok", daemon_ws_status: int = 403) -> None:
        self.handler = type(
            "Handler",
            (FakeDeploymentHandler,),
            {"health_status": health_status, "daemon_ws_status": daemon_ws_status},
        )
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), self.handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def __exit__(self, exc_type, exc, tb) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)


class PostDeploySmokeTests(unittest.TestCase):
    def test_successful_smoke_with_allow_http(self) -> None:
        with FakeDeploymentServer() as base_url:
            report = smoke.run_smoke(base_url=base_url, allow_http=True, timeout=2)

        self.assertTrue(report.ready)
        self.assertEqual(report.failures, 0)
        self.assertEqual(report.warnings, 0)
        self.assertTrue(any(check.name == "http.health" for check in report.checks))
        self.assertTrue(any(check.name == "ws.daemonAuth" for check in report.checks))

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
