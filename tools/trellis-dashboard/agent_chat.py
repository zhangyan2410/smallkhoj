"""Trellis Dashboard 的 DSH 原生对话桥（dsh web 本地 HTTP API）。

设计:
- 承载：本地 dsh web（127.0.0.1:3080）的 /api/* JSON-RPC——GLM provider、
  standard preset（含 .agents/skills 的 skill 发现）、会话持久化全部复用
  web runtime；同一会话在 DSH Web UI 里可见（trajectory/审批）。
- 持久会话：固定 sessionId（td-chat），跨消息延续。
- 本地转录：.trellis/.runtime/agent-chat/log.jsonl（user/assistant/error）。
- 单飞：与工作流共用 agent_runner.run_state（对话期间工作流 409，反之亦然）。
- wire 契约（rc 阶段内部接口，随 CLI 版本锁定）：
  POST /api/<method> {"type":"client-request","rpcId":..,"method":..,"payload":{args}}
  → {"type":"server-response","rpcId":..,"result":{"ok":bool,"value":..}}
"""

from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

import agent_runner

CHAT_SESSION_ID = "td-chat"
CHAT_DIR_NAME = ".trellis/.runtime/agent-chat"
WEB_BASE = "http://127.0.0.1:3080"
POLL_INTERVAL_SECONDS = 2.0
MAX_WAIT_SECONDS = 600

_chat_state = threading.Lock()
chat_busy = False


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _chat_dir(root: Path) -> Path:
    d = root / CHAT_DIR_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def _log_path(root: Path) -> Path:
    return _chat_dir(root) / "log.jsonl"


def append_log(root: Path, role: str, text: str, **extra) -> dict:
    entry = {"role": role, "text": text, "at": _now_iso(), **extra}
    with _log_path(root).open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def read_log(root: Path, limit: int = 40) -> list[dict]:
    path = _log_path(root)
    if not path.is_file():
        return []
    entries = []
    for line in reversed(path.read_text(encoding="utf-8", errors="replace").splitlines()):
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(entries) >= limit:
            break
    entries.reverse()
    return entries


# ---------------------------------------------------------------------------
# dsh web 生命周期与 RPC
# ---------------------------------------------------------------------------

def web_up(timeout: float = 0.3) -> bool:
    import socket

    sock = socket.socket()
    sock.settimeout(timeout)
    try:
        sock.connect(("127.0.0.1", 3080))
        return True
    except OSError:
        return False
    finally:
        sock.close()


def ensure_dsh_web(root: Path) -> None:
    """dsh web 不在跑就拉起（cwd=仓库根；日志 .trellis/.runtime/dsh-web.log）。"""
    if web_up():
        return
    import subprocess

    log_dir = root / ".trellis" / ".runtime"
    log_dir.mkdir(parents=True, exist_ok=True)
    log = (log_dir / "dsh-web.log").open("w", encoding="utf-8")
    try:
        subprocess.Popen(
            [agent_runner.DSH_BIN, "web", "--port", "3080"],
            cwd=str(root),
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    except FileNotFoundError:
        log.close()
        raise RuntimeError("dsh 不可用（未安装或不在 PATH）")
    for _ in range(20):
        time.sleep(1)
        if web_up(timeout=0.5):
            return
    raise RuntimeError("dsh web 启动超时（详见 .trellis/.runtime/dsh-web.log）")


def web_rpc(method: str, payload: dict) -> dict:
    """调用 dsh web 的 /api/<method>；返回 result.value，失败抛 RuntimeError。"""
    body = json.dumps({
        "type": "client-request",
        "rpcId": f"td-{uuid.uuid4().hex[:8]}",
        "method": method,
        "payload": payload,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{WEB_BASE}/api/{method}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"dsh web RPC {method} 失败: {exc}") from exc
    result = data.get("result") or {}
    if not result.get("ok"):
        raise RuntimeError(f"{method}: {json.dumps(result.get('error', {}), ensure_ascii=False)[:200]}")
    return result.get("value") or {}


# ---------------------------------------------------------------------------
# 对话
# ---------------------------------------------------------------------------

def _history_events() -> list[dict]:
    value = web_rpc("session.history", {"sessionId": CHAT_SESSION_ID})
    return [w.get("event", {}) for w in value.get("events", [])]


def _assistant_text_after(events: list[dict], baseline_seq: int) -> str | None:
    """baseline 之后最后一条 assistant/message 的文本；没有则 None。"""
    text = None
    for e in events:
        if e.get("type") == "assistant/message" and (e.get("seq") or 0) > baseline_seq:
            data = e.get("data") or {}
            parts = data.get("content") or (data.get("message") or {}).get("content") or []
            candidate = "\n".join(
                p.get("text", "") for p in parts if isinstance(p, dict) and p.get("type") == "text"
            ).strip()
            if candidate:
                text = candidate
    return text


def _turn_ended_after(events: list[dict], baseline_seq: int) -> bool:
    return any(
        e.get("type") == "turn/end" and (e.get("seq") or 0) > baseline_seq
        for e in events
    )


def send_message(root: Path, text: str) -> dict:
    """发送一条用户消息，阻塞等待本轮回复（server 在后台线程调用）。"""
    global chat_busy
    text = (text or "").strip()
    if not text:
        raise ValueError("消息为空")
    with _chat_state:
        if chat_busy:
            raise RuntimeError("对话 agent 正在处理上一条消息")
        acquired = agent_runner.run_state.lock.acquire(blocking=False)
        if not acquired:
            raise RuntimeError(f"agent 正忙: {agent_runner.run_state.running}")
        chat_busy = True
        agent_runner.run_state.running = {
            "runId": f"chat-{datetime.now().strftime('%Y%m%d-%H%M%S')}",
            "workflowId": "chat",
            "status": "running",
        }
    entry = append_log(root, "user", text)
    try:
        ensure_dsh_web(root)
        # 会话不存在才创建（cwd=仓库根 → standard preset 发现 .agents/skills）
        sessions = web_rpc("session.list", {}).get("items", [])
        if not any(s.get("sessionId") == CHAT_SESSION_ID for s in sessions):
            web_rpc("session.create", {
                "sessionId": CHAT_SESSION_ID,
                "cwd": str(root),
                "agentPreset": "standard",
            })
        baseline_events = _history_events()
        baseline = max((e.get("seq") or 0) for e in baseline_events)
        web_rpc("session.prompt", {
            "sessionId": CHAT_SESSION_ID,
            "mode": "queue",
            "content": [{"type": "text", "text": text}],
        })
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        while time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_SECONDS)
            events = _history_events()
            if _turn_ended_after(events, baseline):
                reply = _assistant_text_after(events, baseline) or "(本轮无文本回复)"
                return append_log(root, "assistant", reply)
        return append_log(root, "error", "等待回复超时（10 分钟）——会话仍在 dsh web 中，可打开 Web UI 查看")
    except Exception as exc:  # noqa: BLE001
        return append_log(root, "error", f"{type(exc).__name__}: {exc}")
    finally:
        with _chat_state:
            chat_busy = False
            agent_runner.run_state.running = None
            agent_runner.run_state.lock.release()


def chat_status(root: Path) -> dict:
    return {
        "webUp": web_up(),
        "busy": chat_busy,
        "messages": read_log(root),
    }
