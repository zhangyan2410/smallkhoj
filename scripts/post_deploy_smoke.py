#!/usr/bin/env python3
"""Read-only post-deploy smoke checks for the initial release public URL."""

from __future__ import annotations

import argparse
import base64
import http.client
import json
import os
import socket
import ssl
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.initial_release_deploy_preflight import (  # noqa: E402
    CheckResult,
    STATUS_FAILED,
    STATUS_PASSED,
    STATUS_WARNING,
)


READY = "POST_DEPLOY_SMOKE_READY"


@dataclass(frozen=True)
class HttpProbe:
    status: int
    content_type: str
    body: bytes


@dataclass(frozen=True)
class SmokeReport:
    base_url: str
    checks: list[CheckResult]

    @property
    def failures(self) -> int:
        return sum(1 for check in self.checks if check.status == STATUS_FAILED)

    @property
    def warnings(self) -> int:
        return sum(1 for check in self.checks if check.status == STATUS_WARNING)

    @property
    def ready(self) -> bool:
        return self.failures == 0


def passed(name: str, reason: str, details: dict[str, Any] | None = None) -> CheckResult:
    return CheckResult(name=name, status=STATUS_PASSED, reason_code=READY, reason=reason, details=details)


def warning(name: str, reason_code: str, reason: str, details: dict[str, Any] | None = None) -> CheckResult:
    return CheckResult(name=name, status=STATUS_WARNING, reason_code=reason_code, reason=reason, details=details)


def failed(name: str, reason_code: str, reason: str, details: dict[str, Any] | None = None) -> CheckResult:
    return CheckResult(name=name, status=STATUS_FAILED, reason_code=reason_code, reason=reason, details=details)


def normalize_base_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if not parsed.scheme and not parsed.netloc:
        parsed = urlparse(f"https://{value.strip()}")
    if not parsed.scheme:
        parsed = parsed._replace(scheme="https")
    if not parsed.netloc:
        raise ValueError("base URL must include a host")
    return urlunparse((parsed.scheme, parsed.netloc, "", "", "", "")).rstrip("/")


def default_port(parsed) -> int:
    if parsed.port:
        return parsed.port
    return 443 if parsed.scheme == "https" else 80


def get_url(url: str, *, timeout: float) -> HttpProbe:
    parsed = urlparse(url)
    connection_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    conn = connection_cls(parsed.hostname, parsed.port or default_port(parsed), timeout=timeout)
    try:
        conn.request("GET", path, headers={"User-Agent": "smallkhoj-post-deploy-smoke/1"})
        response = conn.getresponse()
        body = response.read(256 * 1024)
        return HttpProbe(
            status=response.status,
            content_type=response.getheader("content-type", ""),
            body=body,
        )
    finally:
        conn.close()


def is_success_status(status: int, *, allow_redirect: bool = True) -> bool:
    return 200 <= status < 300 or (allow_redirect and 300 <= status < 400)


def check_url_scheme(parsed, *, allow_http: bool) -> CheckResult:
    if parsed.scheme == "https":
        return passed("url.scheme", "Base URL uses HTTPS.")
    if parsed.scheme == "http" and allow_http:
        return passed("url.scheme", "Base URL uses HTTP because --allow-http was set.")
    if parsed.scheme == "http":
        return warning(
            "url.scheme",
            "POST_DEPLOY_SMOKE_HTTP_URL",
            "Base URL uses HTTP; production should use HTTPS unless this is an IP-only or tunnel smoke.",
        )
    return failed(
        "url.scheme",
        "POST_DEPLOY_SMOKE_UNSUPPORTED_SCHEME",
        "Base URL must use http or https.",
        {"scheme": parsed.scheme},
    )


def check_dns(parsed) -> CheckResult:
    try:
        addresses = socket.getaddrinfo(parsed.hostname, default_port(parsed), type=socket.SOCK_STREAM)
    except OSError as exc:
        return failed(
            "dns.resolve",
            "POST_DEPLOY_SMOKE_DNS_FAILED",
            "DNS resolution failed for the base URL host.",
            {"error": str(exc), "host": parsed.hostname},
        )
    unique_addresses = sorted({item[4][0] for item in addresses})
    return passed("dns.resolve", "Base URL host resolves.", {"host": parsed.hostname, "addresses": unique_addresses[:5]})


def check_tcp(parsed, *, timeout: float) -> CheckResult:
    port = default_port(parsed)
    try:
        with socket.create_connection((parsed.hostname, port), timeout=timeout):
            pass
    except OSError as exc:
        return failed(
            "tcp.connect",
            "POST_DEPLOY_SMOKE_TCP_FAILED",
            "TCP connection failed for the base URL host and port.",
            {"error": str(exc), "host": parsed.hostname, "port": port},
        )
    return passed("tcp.connect", "TCP connection to base URL host and port succeeded.", {"host": parsed.hostname, "port": port})


def check_tls(parsed, *, timeout: float) -> CheckResult | None:
    if parsed.scheme != "https":
        return None
    port = default_port(parsed)
    context = ssl.create_default_context()
    try:
        with socket.create_connection((parsed.hostname, port), timeout=timeout) as sock:
            with context.wrap_socket(sock, server_hostname=parsed.hostname) as tls:
                cert = tls.getpeercert()
    except Exception as exc:
        return failed(
            "tls.handshake",
            "POST_DEPLOY_SMOKE_TLS_FAILED",
            "TLS handshake failed for the HTTPS base URL.",
            {"error": str(exc), "host": parsed.hostname, "port": port},
        )
    return passed("tls.handshake", "TLS handshake succeeded.", {"subject": cert.get("subject", [])[:1] if isinstance(cert, dict) else []})


def check_frontend(base_url: str, *, timeout: float) -> CheckResult:
    try:
        probe = get_url(f"{base_url}/", timeout=timeout)
    except Exception as exc:
        return failed("http.frontend", "POST_DEPLOY_SMOKE_FRONTEND_UNREACHABLE", "Frontend root request failed.", {"error": str(exc)})
    content_sample = probe.body[:512].lower()
    looks_html = b"<html" in content_sample or b"<!doctype html" in content_sample
    if is_success_status(probe.status) and looks_html:
        return passed("http.frontend", "Frontend root is reachable and returned HTML.", {"status": probe.status, "contentType": probe.content_type})
    return failed(
        "http.frontend",
        "POST_DEPLOY_SMOKE_FRONTEND_UNEXPECTED",
        "Frontend root did not return expected HTML.",
        {"status": probe.status, "contentType": probe.content_type},
    )


def parse_json_body(body: bytes) -> Any:
    return json.loads(body.decode("utf-8"))


def check_health(base_url: str, *, timeout: float) -> CheckResult:
    try:
        probe = get_url(urljoin(base_url, "/api/health"), timeout=timeout)
    except Exception as exc:
        return failed("http.health", "POST_DEPLOY_SMOKE_HEALTH_UNREACHABLE", "Backend health request failed.", {"error": str(exc)})
    try:
        payload = parse_json_body(probe.body)
    except Exception as exc:
        return failed(
            "http.health",
            "POST_DEPLOY_SMOKE_HEALTH_NOT_JSON",
            "Backend health route did not return JSON.",
            {"status": probe.status, "error": str(exc), "contentType": probe.content_type},
        )
    if is_success_status(probe.status, allow_redirect=False) and isinstance(payload, dict) and payload.get("status") == "ok":
        return passed("http.health", "Backend health route returned status ok.", {"status": probe.status, "version": payload.get("version")})
    return failed(
        "http.health",
        "POST_DEPLOY_SMOKE_HEALTH_NOT_OK",
        "Backend health route did not return status ok.",
        {"status": probe.status, "healthStatus": payload.get("status") if isinstance(payload, dict) else None},
    )


def check_docs(base_url: str, *, timeout: float) -> CheckResult:
    try:
        probe = get_url(urljoin(base_url, "/docs"), timeout=timeout)
    except Exception as exc:
        return failed("http.docs", "POST_DEPLOY_SMOKE_DOCS_UNREACHABLE", "Docs request failed.", {"error": str(exc)})
    if is_success_status(probe.status):
        return passed("http.docs", "Docs route is reachable.", {"status": probe.status, "contentType": probe.content_type})
    return failed("http.docs", "POST_DEPLOY_SMOKE_DOCS_UNEXPECTED", "Docs route returned an unexpected status.", {"status": probe.status})


def check_openapi(base_url: str, *, timeout: float) -> CheckResult:
    try:
        probe = get_url(urljoin(base_url, "/openapi.json"), timeout=timeout)
    except Exception as exc:
        return failed("http.openapi", "POST_DEPLOY_SMOKE_OPENAPI_UNREACHABLE", "OpenAPI request failed.", {"error": str(exc)})
    try:
        payload = parse_json_body(probe.body)
    except Exception as exc:
        return failed(
            "http.openapi",
            "POST_DEPLOY_SMOKE_OPENAPI_NOT_JSON",
            "OpenAPI route did not return JSON.",
            {"status": probe.status, "error": str(exc), "contentType": probe.content_type},
        )
    if is_success_status(probe.status, allow_redirect=False) and isinstance(payload, dict) and payload.get("openapi") and isinstance(payload.get("paths"), dict):
        return passed("http.openapi", "OpenAPI route returned an OpenAPI document.", {"status": probe.status, "pathCount": len(payload.get("paths", {}))})
    return failed("http.openapi", "POST_DEPLOY_SMOKE_OPENAPI_UNEXPECTED", "OpenAPI route returned unexpected JSON.", {"status": probe.status})


def check_daemon_package(base_url: str, *, timeout: float) -> CheckResult:
    package_path = "/downloads/smallkhoj-daemon/smallkhoj-smallkhoj-daemon-0.2.0.tgz"
    try:
        probe = get_url(urljoin(base_url, package_path), timeout=timeout)
    except Exception as exc:
        return failed(
            "http.daemonPackage",
            "POST_DEPLOY_SMOKE_DAEMON_PACKAGE_UNREACHABLE",
            "Self-hosted daemon package request failed.",
            {"error": str(exc), "path": package_path},
        )
    if is_success_status(probe.status, allow_redirect=False) and len(probe.body) > 0:
        return passed(
            "http.daemonPackage",
            "Self-hosted daemon package is reachable.",
            {
                "status": probe.status,
                "contentType": probe.content_type,
                "bytesRead": len(probe.body),
                "path": package_path,
            },
        )
    return failed(
        "http.daemonPackage",
        "POST_DEPLOY_SMOKE_DAEMON_PACKAGE_UNEXPECTED",
        "Self-hosted daemon package did not return a non-empty 2xx response.",
        {
            "status": probe.status,
            "contentType": probe.content_type,
            "bytesRead": len(probe.body),
            "path": package_path,
        },
    )


def websocket_url_for(base_url: str, path: str) -> str:
    parsed = urlparse(base_url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return urlunparse((scheme, parsed.netloc, path, "", "", ""))


def read_http_status_line(sock: socket.socket) -> tuple[int | None, str]:
    data = b""
    while b"\r\n" not in data and len(data) < 4096:
        chunk = sock.recv(1)
        if not chunk:
            break
        data += chunk
    status_line = data.decode("iso-8859-1", errors="replace").strip()
    parts = status_line.split()
    if len(parts) >= 2 and parts[0].startswith("HTTP/"):
        try:
            return int(parts[1]), status_line
        except ValueError:
            pass
    return None, status_line


def check_daemon_websocket_auth_route(base_url: str, *, timeout: float) -> CheckResult:
    parsed_base = urlparse(base_url)
    port = default_port(parsed_base)
    ws_url = websocket_url_for(base_url, "/internal/agent-api/ws")
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    request = "\r\n".join([
        "GET /internal/agent-api/ws HTTP/1.1",
        f"Host: {parsed_base.hostname}",
        "Upgrade: websocket",
        "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}",
        "Sec-WebSocket-Version: 13",
        "User-Agent: smallkhoj-post-deploy-smoke/1",
        "",
        "",
    ]).encode("ascii")
    try:
        with socket.create_connection((parsed_base.hostname, port), timeout=timeout) as raw_sock:
            raw_sock.settimeout(timeout)
            if parsed_base.scheme == "https":
                context = ssl.create_default_context()
                with context.wrap_socket(raw_sock, server_hostname=parsed_base.hostname) as tls_sock:
                    tls_sock.sendall(request)
                    status, status_line = read_http_status_line(tls_sock)
            else:
                raw_sock.sendall(request)
                status, status_line = read_http_status_line(raw_sock)
    except Exception as exc:
        return failed(
            "ws.daemonAuth",
            "POST_DEPLOY_SMOKE_DAEMON_WS_UNREACHABLE",
            "Daemon WebSocket unauthenticated handshake did not reach a responding route.",
            {"error": str(exc), "url": ws_url},
        )

    if status in {401, 403}:
        return passed(
            "ws.daemonAuth",
            "Daemon WebSocket route rejects unauthenticated upgrade requests as expected.",
            {"status": status, "url": ws_url},
        )
    if status == 101:
        return failed(
            "ws.daemonAuth",
            "POST_DEPLOY_SMOKE_DAEMON_WS_ACCEPTED_WITHOUT_AUTH",
            "Daemon WebSocket accepted an unauthenticated upgrade request.",
            {"status": status, "url": ws_url},
        )
    return failed(
        "ws.daemonAuth",
        "POST_DEPLOY_SMOKE_DAEMON_WS_UNEXPECTED_STATUS",
        "Daemon WebSocket unauthenticated handshake returned an unexpected status.",
        {"status": status, "statusLine": status_line, "url": ws_url},
    )


def skipped_http_check(name: str, path: str) -> CheckResult:
    return failed(
        name,
        "POST_DEPLOY_SMOKE_NETWORK_PREREQUISITE_FAILED",
        f"Skipped {path} because DNS or TCP prerequisite checks failed.",
    )


def run_smoke(*, base_url: str, allow_http: bool = False, timeout: float = 8.0) -> SmokeReport:
    normalized = normalize_base_url(base_url)
    parsed = urlparse(normalized)
    checks: list[CheckResult] = [check_url_scheme(parsed, allow_http=allow_http)]
    dns_check = check_dns(parsed)
    checks.append(dns_check)
    tcp_check = check_tcp(parsed, timeout=timeout) if dns_check.status != STATUS_FAILED else failed(
        "tcp.connect",
        "POST_DEPLOY_SMOKE_TCP_SKIPPED",
        "Skipped TCP connection because DNS resolution failed.",
    )
    checks.append(tcp_check)

    network_ready = dns_check.status != STATUS_FAILED and tcp_check.status != STATUS_FAILED
    if not network_ready:
        checks.extend([
            skipped_http_check("http.frontend", "/"),
            skipped_http_check("http.health", "/api/health"),
            skipped_http_check("http.docs", "/docs"),
            skipped_http_check("http.openapi", "/openapi.json"),
            skipped_http_check("http.daemonPackage", "/downloads/smallkhoj-daemon/*.tgz"),
        ])
        return SmokeReport(base_url=normalized, checks=checks)

    tls_check = check_tls(parsed, timeout=timeout)
    if tls_check is not None:
        checks.append(tls_check)
        if tls_check.status == STATUS_FAILED:
            checks.extend([
                skipped_http_check("http.frontend", "/"),
                skipped_http_check("http.health", "/api/health"),
                skipped_http_check("http.docs", "/docs"),
                skipped_http_check("http.openapi", "/openapi.json"),
                skipped_http_check("http.daemonPackage", "/downloads/smallkhoj-daemon/*.tgz"),
            ])
            return SmokeReport(base_url=normalized, checks=checks)

    checks.extend([
        check_frontend(normalized, timeout=timeout),
        check_health(normalized, timeout=timeout),
        check_docs(normalized, timeout=timeout),
        check_openapi(normalized, timeout=timeout),
        check_daemon_package(normalized, timeout=timeout),
        check_daemon_websocket_auth_route(normalized, timeout=timeout),
    ])
    return SmokeReport(base_url=normalized, checks=checks)


def report_to_dict(report: SmokeReport) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []
    for check in report.checks:
        item = {
            "name": check.name,
            "status": check.status,
            "reasonCode": check.reason_code,
            "reason": check.reason,
        }
        if check.details is not None:
            item["details"] = check.details
        checks.append(item)
    return {
        "ready": report.ready,
        "warnings": report.warnings,
        "failures": report.failures,
        "baseUrl": report.base_url,
        "checks": checks,
    }


def to_json(report: SmokeReport) -> str:
    return json.dumps(report_to_dict(report), ensure_ascii=False, sort_keys=True)


def exit_code_for(report: SmokeReport, *, strict_warnings: bool) -> int:
    if report.failures:
        return 1
    if strict_warnings and report.warnings:
        return 2
    return 0


def print_human(report: SmokeReport) -> None:
    status = "READY" if report.ready else "NOT READY"
    print(f"Post-deploy smoke: {status} ({report.failures} failed, {report.warnings} warnings) {report.base_url}")
    for check in report.checks:
        marker = {STATUS_PASSED: "PASS", STATUS_WARNING: "WARN", STATUS_FAILED: "FAIL"}.get(check.status, check.status.upper())
        print(f"[{marker}] {check.name}: {check.reason}")
        if check.details:
            print(f"       details: {json.dumps(check.details, ensure_ascii=False, sort_keys=True)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run SmallKhoj initial-release post-deploy public URL smoke checks.")
    parser.add_argument("--base-url", required=True, help="Public deployment base URL, for example https://smallkhoj.example.com.")
    parser.add_argument("--allow-http", action="store_true", help="Accept HTTP without warning for IP-only local smoke tests.")
    parser.add_argument("--timeout", type=float, default=8.0, help="Per-network-operation timeout in seconds.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--strict-warnings", action="store_true", help="Return exit code 2 when warnings are present.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = run_smoke(base_url=args.base_url, allow_http=args.allow_http, timeout=args.timeout)
    except ValueError as exc:
        report = SmokeReport(
            base_url=args.base_url,
            checks=[
                failed("url.parse", "POST_DEPLOY_SMOKE_URL_INVALID", str(exc)),
            ],
        )
    if args.json:
        print(json.dumps(report_to_dict(report), ensure_ascii=False, indent=2, sort_keys=True))
    else:
        print_human(report)
    return exit_code_for(report, strict_warnings=args.strict_warnings)


if __name__ == "__main__":
    raise SystemExit(main())
