"""Lightweight latency trace helpers for local SmallKhoj flows."""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from fastapi import Request

TRACE_HEADER = "X-SmallKhoj-Trace-Id"


def trace_id_from_request(
    request: Request,
    body: dict[str, Any] | None = None,
    *,
    prefix: str = "trace",
) -> str:
    """Resolve or create a trace id without trusting arbitrary long input."""
    raw = request.headers.get(TRACE_HEADER) or request.headers.get(TRACE_HEADER.lower())
    if not raw and body:
        raw = body.get("traceId") or body.get("trace_id")
    if isinstance(raw, str):
        cleaned = "".join(ch for ch in raw.strip() if ch.isalnum() or ch in "-_:.")
        if cleaned:
            return cleaned[:120]
    return f"{prefix}:{uuid.uuid4().hex[:12]}"


class LatencyTrace:
    """Emit structured timeline events that smallkhoj-trace can group."""

    def __init__(self, trace_id: str, flow: str, **attrs: Any) -> None:
        self.trace_id = trace_id
        self.flow = flow
        self.attrs = _clean_attrs(attrs)
        self.started = time.perf_counter()

    def mark(self, span: str, **attrs: Any) -> None:
        emit_latency_trace(
            trace_id=self.trace_id,
            flow=self.flow,
            span=span,
            elapsed_ms=(time.perf_counter() - self.started) * 1000,
            attrs={**self.attrs, **_clean_attrs(attrs)},
        )

    @contextmanager
    def time(self, span: str, **attrs: Any) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
            status = "ok"
        except Exception:
            status = "error"
            raise
        finally:
            emit_latency_trace(
                trace_id=self.trace_id,
                flow=self.flow,
                span=span,
                elapsed_ms=(time.perf_counter() - self.started) * 1000,
                duration_ms=(time.perf_counter() - started) * 1000,
                status=status,
                attrs={**self.attrs, **_clean_attrs(attrs)},
            )

    def finish(self, span: str = "total", **attrs: Any) -> None:
        emit_latency_trace(
            trace_id=self.trace_id,
            flow=self.flow,
            span=span,
            elapsed_ms=(time.perf_counter() - self.started) * 1000,
            duration_ms=(time.perf_counter() - self.started) * 1000,
            attrs={**self.attrs, **_clean_attrs(attrs)},
        )


def emit_latency_trace(
    *,
    trace_id: str,
    flow: str,
    span: str,
    elapsed_ms: float,
    duration_ms: float | None = None,
    status: str = "ok",
    attrs: dict[str, Any] | None = None,
) -> None:
    payload = {
        "at": datetime.now(timezone.utc).isoformat(),
        "traceId": trace_id,
        "flow": flow,
        "span": span,
        "elapsedMs": round(elapsed_ms, 3),
        "status": status,
        "attrs": _clean_attrs(attrs or {}),
    }
    if duration_ms is not None:
        payload["durationMs"] = round(duration_ms, 3)
    try:
        print(f"Latency trace: {json.dumps(payload, separators=(',', ':'), default=str)}", flush=True)
    except Exception:
        # Observability must never break the realtime message path.
        pass


def _clean_attrs(attrs: dict[str, Any]) -> dict[str, Any]:
    cleaned: dict[str, Any] = {}
    for key, value in attrs.items():
        if value is None:
            continue
        if isinstance(value, (str, int, float, bool)):
            cleaned[key] = value
        elif isinstance(value, uuid.UUID):
            cleaned[key] = str(value)
        else:
            cleaned[key] = str(value)
    return cleaned
