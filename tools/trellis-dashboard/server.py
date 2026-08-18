"""Trellis Dashboard 本地只读 HTTP 服务。

安全模型（对齐 Comet Dashboard）:
    - 只绑定 127.0.0.1，不对外暴露
    - 静态文件 resolve 后必须仍位于 web/ 内（防路径穿越）
    - 工件预览见 collector.read_artifact_preview（任务目录内 + 256KiB 截断）
    - 所有响应 Cache-Control: no-store
"""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import agent_runner
from collector import (
    IMAGE_EXTENSIONS,
    IMAGE_RAW_LIMIT_BYTES,
    collect_snapshot,
    read_artifact_preview,
    read_spec_file,
    resolve_artifact,
)

WEB_ROOT = Path(__file__).resolve().parent / "web"
DEFAULT_PORT = 4322
PORT_RETRY_LIMIT = 20

_MIME_OVERRIDES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
}


class DashboardServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], handler_class, root: Path) -> None:
        super().__init__(address, handler_class)
        self.root = root


class DashboardHandler(BaseHTTPRequestHandler):
    server: DashboardServer

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        # 静默常规访问日志（30 秒轮询会刷屏）；错误仍通过 send_error 输出
        return

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if unquote(parsed.path) != "/api/agent-runs":
            self._send_json({"error": "not found"}, status=404)
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
            record = agent_runner.start_run(self.server.root, str(body.get("id", "")))
            self._send_json(record, status=202)
        except KeyError as exc:
            self._send_json({"error": str(exc)}, status=404)
        except RuntimeError as exc:
            self._send_json({"error": str(exc)}, status=409)
        except Exception as exc:  # noqa: BLE001
            self._send_json({"error": f"bad request: {exc}"}, status=400)

    def do_HEAD(self) -> None:  # noqa: N802
        self._route(head=True)

    def do_GET(self) -> None:  # noqa: N802
        self._route(head=False)

    def _route(self, *, head: bool) -> None:
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path == "/api/dashboard":
                self._send_json(collect_snapshot(self.server.root), head=head)
            elif path == "/api/artifact":
                self._handle_artifact(parse_qs(parsed.query), head=head)
            elif path == "/api/artifact-raw":
                self._handle_artifact_raw(parse_qs(parsed.query), head=head)
            elif path == "/api/spec-file":
                self._handle_spec_file(parse_qs(parsed.query), head=head)
            else:
                self._serve_static(path, head=head)
        except Exception as exc:  # noqa: BLE001 - 服务器顶层兜底，不让线程崩溃
            self._send_json({"error": f"internal error: {exc}"}, status=500, head=head)

    def _handle_artifact(self, query: dict, *, head: bool) -> None:
        task = (query.get("task") or [""])[0].strip()
        file_ref = (query.get("file") or [""])[0].strip()
        if not task or not file_ref:
            self._send_json({"error": "缺少 task / file 参数"}, status=400, head=head)
            return
        result = read_artifact_preview(self.server.root, task, file_ref)
        if result is None:
            self._send_json({"error": "工件不存在或路径被拒绝"}, status=404, head=head)
            return
        self._send_json(result, head=head)

    def _handle_artifact_raw(self, query: dict, *, head: bool) -> None:
        """图片原件端点：仅限图片扩展名，超过 4 MiB 拒绝，供 <img> 直接加载。"""
        task = (query.get("task") or [""])[0].strip()
        file_ref = (query.get("file") or [""])[0].strip()
        if not task or not file_ref:
            self._send_json({"error": "缺少 task / file 参数"}, status=400, head=head)
            return
        artifact = resolve_artifact(self.server.root, task, file_ref)
        if artifact is None:
            self._send_json({"error": "工件不存在或路径被拒绝"}, status=404, head=head)
            return
        if artifact.suffix.lower() not in IMAGE_EXTENSIONS:
            self._send_json({"error": "该端点仅支持图片文件"}, status=400, head=head)
            return
        if artifact.stat().st_size > IMAGE_RAW_LIMIT_BYTES:
            self._send_json({"error": "图片超过 4 MiB 上限"}, status=413, head=head)
            return
        mime = _MIME_OVERRIDES.get(artifact.suffix.lower()) or (
            mimetypes.guess_type(artifact.name)[0] or "application/octet-stream"
        )
        self._send_bytes(artifact.read_bytes(), mime, head=head)

    def _handle_spec_file(self, query: dict, *, head: bool) -> None:
        rel = (query.get("path") or [""])[0].strip()
        lang = (query.get("lang") or ["orig"])[0].strip()
        if not rel:
            self._send_json({"error": "缺少 path 参数"}, status=400, head=head)
            return
        result = read_spec_file(self.server.root, rel, lang if lang in ("orig", "zh") else "orig")
        if result is None:
            self._send_json({"error": "spec 文件不存在或路径被拒绝"}, status=404, head=head)
            return
        self._send_json(result, head=head)

    def _serve_static(self, path: str, *, head: bool) -> None:
        rel = "index.html" if path in ("", "/") else path.lstrip("/")
        candidate = (WEB_ROOT / rel).resolve()
        web_root = WEB_ROOT.resolve()
        if candidate != web_root and web_root not in candidate.parents:
            self._send_json({"error": "forbidden"}, status=403, head=head)
            return
        if not candidate.is_file():
            self._send_json({"error": "not found"}, status=404, head=head)
            return
        suffix = candidate.suffix.lower()
        mime = _MIME_OVERRIDES.get(suffix) or (
            mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        )
        self._send_bytes(candidate.read_bytes(), mime, head=head)

    def _send_json(self, obj: object, *, status: int = 200, head: bool = False) -> None:
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send_bytes(payload, "application/json; charset=utf-8", status=status, head=head)

    def _send_bytes(self, data: bytes, content_type: str, *, status: int = 200,
                    head: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'")
        self.end_headers()
        if not head:
            self.wfile.write(data)


def create_server(root: Path, port: int) -> tuple[DashboardServer, int]:
    """绑定 127.0.0.1；port=0 让系统随机分配，否则被占用时向后重试。"""
    if port == 0:
        server = DashboardServer(("127.0.0.1", 0), DashboardHandler, root)
        return server, server.server_address[1]

    last_error: OSError | None = None
    for candidate in range(port, port + PORT_RETRY_LIMIT + 1):
        try:
            server = DashboardServer(("127.0.0.1", candidate), DashboardHandler, root)
            return server, candidate
        except OSError as exc:
            last_error = exc
    raise RuntimeError(f"端口 {port}~{port + PORT_RETRY_LIMIT} 均不可用: {last_error}")
