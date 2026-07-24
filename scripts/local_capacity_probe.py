#!/usr/bin/env python3
"""Local-only authenticated SSE and mixed-request capacity probe."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import ipaddress
import json
import math
import os
import platform
import re
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse, urlunparse

DISPOSABLE_DATABASE_TOKENS = ("audit", "ci", "disposable", "e2e", "remediation", "test")
REPORT_SCHEMA_VERSION = 5
EMPTY_GIT_DIFF_SHA256 = hashlib.sha256(b"").hexdigest()
FORMAL_PROFILE_ID = "formal-300-500-30-v1"
SMOKE_PROFILE_ID = "smoke"
FORMAL_POSTGRES_MAX_CONNECTIONS = 100
FORMAL_BACKEND_WORKERS = 1
FORMAL_NOTIFY_PUBLISHER_POOL_SIZE = 2
NOTIFY_LISTENER_CONNECTIONS_PER_BACKEND_WORKER = 1
FORMAL_NOTIFY_LISTENER_PER_BACKEND_WORKER = (
    NOTIFY_LISTENER_CONNECTIONS_PER_BACKEND_WORKER
)
FORMAL_DATABASE_POOL_SIZE = 5
FORMAL_DATABASE_MAX_OVERFLOW = 10
FORMAL_BETTER_AUTH_DATABASE_POOL_SIZE = 10
FORMAL_POSTGRES_CONNECTION_HEADROOM = 5
FORMAL_BACKEND_CONNECTIONS_PER_PROCESS = (
    FORMAL_DATABASE_POOL_SIZE
    + FORMAL_DATABASE_MAX_OVERFLOW
    + FORMAL_NOTIFY_PUBLISHER_POOL_SIZE
    + FORMAL_NOTIFY_LISTENER_PER_BACKEND_WORKER
)
FORMAL_FEISHU_WORKER_RESERVE = (
    FORMAL_DATABASE_POOL_SIZE + FORMAL_DATABASE_MAX_OVERFLOW
)
FORMAL_REQUIRED_POSTGRES_CONNECTIONS = (
    FORMAL_BACKEND_CONNECTIONS_PER_PROCESS * FORMAL_BACKEND_WORKERS
    + FORMAL_BETTER_AUTH_DATABASE_POOL_SIZE
    + FORMAL_FEISHU_WORKER_RESERVE
    + FORMAL_POSTGRES_CONNECTION_HEADROOM
)
FORMAL_POSTGRES_CONNECTION_BUDGET = {
    "databasePoolSize": FORMAL_DATABASE_POOL_SIZE,
    "databaseMaxOverflow": FORMAL_DATABASE_MAX_OVERFLOW,
    "notifyPublisherPoolSize": FORMAL_NOTIFY_PUBLISHER_POOL_SIZE,
    "notifyListenerPerBackendWorker": FORMAL_NOTIFY_LISTENER_PER_BACKEND_WORKER,
    "backendWorkers": FORMAL_BACKEND_WORKERS,
    "backendPerProcess": FORMAL_BACKEND_CONNECTIONS_PER_PROCESS,
    "backendTotal": FORMAL_BACKEND_CONNECTIONS_PER_PROCESS * FORMAL_BACKEND_WORKERS,
    "betterAuthDatabasePoolSize": FORMAL_BETTER_AUTH_DATABASE_POOL_SIZE,
    "feishuWorkerReserve": FORMAL_FEISHU_WORKER_RESERVE,
    "headroom": FORMAL_POSTGRES_CONNECTION_HEADROOM,
    "required": FORMAL_REQUIRED_POSTGRES_CONNECTIONS,
}
FORMAL_MIN_STEADY_SSE = 300
FORMAL_MIN_PEAK_SSE = 500
FORMAL_MIN_ACTIVE_USERS = 30
FORMAL_MAX_ACTIVE_CYCLE_SECONDS = 5.0
FORMAL_MIN_DURATION_SECONDS = 1_800.0
FORMAL_MAX_RAMP_SECONDS = 60.0
FORMAL_MIN_SPIKE_AT_SECONDS = 590.0
FORMAL_MAX_SPIKE_RAMP_SECONDS = 10.0
FORMAL_MIN_SPIKE_DURATION_SECONDS = 60.0
FORMAL_MIN_CLEANUP_SECONDS = 60.0
FORMAL_MAX_RESOURCE_SAMPLE_SECONDS = 5.0
FORMAL_THRESHOLD_LIMITS = {
    "sseReadyP95Ms": 2_000.0,
    "readP95Ms": 500.0,
    "writeP95Ms": 1_000.0,
    "eventDeliveryP95Ms": 2_000.0,
    "postgresHeadroom": 5,
    "postgresCleanupDelta": 2,
}
FORMAL_TARGET_RESOURCE_ENVELOPE = {
    "vcpus": 4,
    "guestMemoryBytes": 3_564_584_960,
    "maxAggregateCpuPercent": 320.0,
    "maxContainerMemoryBytes": 2_673_438_720,
}
CORE_COMPOSE_SERVICES = ("db", "backend", "frontend", "caddy")
CANDIDATE_IMAGE_SERVICES = ("backend", "frontend", "caddy")
SOURCE_REVISION_LABEL = "org.opencontainers.image.revision"
CONTAINER_SAMPLE_PHASES = (
    "baseline",
    "steady-ramp",
    "steady",
    "spike-ramp",
    "spike-hold",
    "post-spike",
    "cleanup",
)
REQUIRED_CONTAINER_PHASES = ("baseline", "steady-or-steady-ramp", "spike-hold", "post-spike", "cleanup")
DATABASE_COUNTER_FIELDS = ("xact_commit", "xact_rollback", "deadlocks", "temp_bytes")
POSTGRES_SAMPLE_FIELDS = (
    "total",
    "active",
    "idle",
    "idle_in_transaction",
    "waiting",
    "notify_publishers",
    "notify_listeners",
    "observers",
)
CONTAINER_SAMPLE_INTEGER_FIELDS = (
    "restartCount",
    "memoryUsageBytes",
    "networkRxBytes",
    "networkTxBytes",
    "blockReadBytes",
    "blockWriteBytes",
    "pids",
)
CONTAINER_SAMPLE_NUMBER_FIELDS = ("cpuPercent", "memoryPercent")
LATENCY_PERCENTILE_FIELDS = ("min", "p50", "p95", "p99", "max")
TIMELINE_ANCHOR_FIELDS = (
    "steadyRampStartedAtSeconds",
    "steadyReadyAtSeconds",
    "workloadStartedAtSeconds",
    "spikeRampStartedAtSeconds",
    "spikePeakReadyAtSeconds",
    "spikePeakEndedAtSeconds",
    "workloadEndedAtSeconds",
    "cleanupStartedAtSeconds",
    "cleanupEndedAtSeconds",
)
TIMELINE_TOLERANCE_SECONDS = 1.0
DURATION_EVIDENCE_TOLERANCE_SECONDS = 0.1
MAX_RESOURCE_SAMPLE_GAP_MULTIPLIER = 3.0
MAX_RESOURCE_SAMPLE_GAP_SLACK_SECONDS = 5.0
COMPOSE_PROJECT_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,62}")
DOCKER_STATE_FORMAT = (
    '{"containerId":{{json .Id}},"imageId":{{json .Image}},'
    '"status":{{json .State.Status}},"running":{{json .State.Running}},'
    '"restartCount":{{json .RestartCount}},"oomKilled":{{json .State.OOMKilled}}}'
)
DOCKER_REVISION_FORMAT = (
    '{"containerId":{{json .Id}},'
    '"sourceRevision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
)
DOCKER_STATS_FORMAT = "{{json .}}"


class SafetyError(ValueError):
    """Raised before the probe can target a non-disposable or remote service."""


class ProbeError(RuntimeError):
    """Raised for a fail-closed fixture or protocol error without response bodies."""


@dataclass(frozen=True)
class SafetyTarget:
    api_base: str
    database_url: str
    database_name: str


@dataclass(frozen=True)
class SseFrame:
    event: str
    event_id: str
    data: Any


@dataclass(frozen=True)
class Fixture:
    user_index: int
    session_token: str
    server_id: str
    channel_name: str | None = None


@dataclass
class StreamHandle:
    task: asyncio.Task[None]
    ready: asyncio.Future[bool]


@dataclass(frozen=True)
class Thresholds:
    sse_ready_p95_ms: float = 2_000.0
    read_p95_ms: float = 500.0
    write_p95_ms: float = 1_000.0
    event_delivery_p95_ms: float = 2_000.0
    postgres_headroom: int = 5
    postgres_cleanup_delta: int = 2


@dataclass(frozen=True)
class ProbeConfig:
    target: SafetyTarget
    profile_id: str
    namespace: str
    public_api_key: str
    auth_bridge_secret: str
    compose_project: str
    expected_postgres_max_connections: int
    expected_backend_workers: int
    expected_notify_publisher_pool_size: int
    expected_database_pool_size: int
    expected_database_max_overflow: int
    expected_better_auth_database_pool_size: int
    expected_postgres_connection_headroom: int
    steady_sse: int
    spike_total_sse: int
    active_users: int
    active_cycle_seconds: float
    duration_seconds: float
    ramp_seconds: float
    spike_at_seconds: float
    spike_ramp_seconds: float
    spike_duration_seconds: float
    cleanup_timeout_seconds: float
    connect_timeout_seconds: float
    request_timeout_seconds: float
    resource_sample_seconds: float
    fixture_concurrency: int
    backend_pid: int | None
    output: Path
    thresholds: Thresholds

    @property
    def fixture_users(self) -> int:
        return self.spike_total_sse

    @property
    def backend_connections_per_process(self) -> int:
        return (
            self.expected_database_pool_size
            + self.expected_database_max_overflow
            + self.expected_notify_publisher_pool_size
            + NOTIFY_LISTENER_CONNECTIONS_PER_BACKEND_WORKER
        )

    @property
    def backend_deployment_connections(self) -> int:
        return self.backend_connections_per_process * self.expected_backend_workers

    @property
    def feishu_worker_reserve(self) -> int:
        return self.expected_database_pool_size + self.expected_database_max_overflow

    @property
    def required_postgres_connections(self) -> int:
        return (
            self.backend_deployment_connections
            + self.expected_better_auth_database_pool_size
            + self.feishu_worker_reserve
            + self.expected_postgres_connection_headroom
        )

    @property
    def postgres_connection_budget(self) -> dict[str, int]:
        return {
            "databasePoolSize": self.expected_database_pool_size,
            "databaseMaxOverflow": self.expected_database_max_overflow,
            "notifyPublisherPoolSize": self.expected_notify_publisher_pool_size,
            "notifyListenerPerBackendWorker": (
                NOTIFY_LISTENER_CONNECTIONS_PER_BACKEND_WORKER
            ),
            "backendWorkers": self.expected_backend_workers,
            "backendPerProcess": self.backend_connections_per_process,
            "backendTotal": self.backend_deployment_connections,
            "betterAuthDatabasePoolSize": self.expected_better_auth_database_pool_size,
            "feishuWorkerReserve": self.feishu_worker_reserve,
            "headroom": self.expected_postgres_connection_headroom,
            "required": self.required_postgres_connections,
        }


class MetricRecorder:
    def __init__(self) -> None:
        self.latencies_ms: list[float] = []
        self.statuses: Counter[int] = Counter()
        self.error_types: Counter[str] = Counter()

    def record(self, *, status: int, latency_ms: float) -> None:
        self.statuses[status] += 1
        self.latencies_ms.append(latency_ms)

    def record_error(self, error_type: str) -> None:
        self.error_types[error_type] += 1

    def summary(self) -> dict[str, Any]:
        successes = sum(count for status, count in self.statuses.items() if 200 <= status < 300)
        non_2xx = sum(count for status, count in self.statuses.items() if not 200 <= status < 300)
        return {
            "requests": sum(self.statuses.values()) + sum(self.error_types.values()),
            "successes": successes,
            "non2xx": non_2xx,
            "errors": sum(self.error_types.values()),
            "statuses": {str(status): count for status, count in sorted(self.statuses.items())},
            "errorTypes": dict(sorted(self.error_types.items())),
            "latencyMs": latency_summary(self.latencies_ms),
        }


class EventLedger:
    def __init__(self) -> None:
        self._expected: dict[str, tuple[int, float]] = {}
        self._correct_receipts: Counter[str] = Counter()
        self._delivery_latencies_ms: list[float] = []
        self._wrong_scope = 0
        self._unexpected = 0

    def expect(self, trace_id: str, *, user_index: int, started_at: float) -> None:
        self._expected[trace_id] = (user_index, started_at)

    def discard(self, trace_id: str) -> None:
        self._expected.pop(trace_id, None)
        self._correct_receipts.pop(trace_id, None)

    def receive(self, trace_id: str, *, user_index: int, received_at: float) -> None:
        expected = self._expected.get(trace_id)
        if expected is None:
            self._unexpected += 1
            return
        expected_user, started_at = expected
        if expected_user != user_index:
            self._wrong_scope += 1
            return
        self._correct_receipts[trace_id] += 1
        if self._correct_receipts[trace_id] == 1:
            self._delivery_latencies_ms.append(max(0.0, (received_at - started_at) * 1_000))

    def summary(self) -> dict[str, Any]:
        missing = sum(1 for trace_id in self._expected if self._correct_receipts[trace_id] == 0)
        duplicates = sum(max(0, count - 1) for count in self._correct_receipts.values())
        return {
            "expected": len(self._expected),
            "received": sum(1 for count in self._correct_receipts.values() if count > 0),
            "missing": missing,
            "duplicates": duplicates,
            "wrongScope": self._wrong_scope,
            "unexpected": self._unexpected,
            "deliveryLatencyMs": latency_summary(self._delivery_latencies_ms),
        }


class StreamStats:
    def __init__(self) -> None:
        self.requested = 0
        self.ready = 0
        self.current_ready = 0
        self.peak_ready = 0
        self.ready_latencies_ms: list[float] = []
        self.setup_statuses: Counter[int] = Counter()
        self.setup_errors: Counter[str] = Counter()
        self.unexpected_closes = 0
        self.heartbeats = 0
        self.event_frames = 0
        self.invalid_json_frames = 0

    def request_started(self) -> None:
        self.requested += 1

    def stream_ready(self, *, latency_ms: float) -> None:
        self.ready += 1
        self.current_ready += 1
        self.peak_ready = max(self.peak_ready, self.current_ready)
        self.ready_latencies_ms.append(latency_ms)

    def stream_closed(self) -> None:
        self.current_ready = max(0, self.current_ready - 1)

    def summary(self) -> dict[str, Any]:
        return {
            "requested": self.requested,
            "ready": self.ready,
            "peakConcurrentReady": self.peak_ready,
            "setupStatuses": {str(status): count for status, count in sorted(self.setup_statuses.items())},
            "setupErrors": sum(self.setup_errors.values()),
            "setupErrorTypes": dict(sorted(self.setup_errors.items())),
            "unexpectedCloses": self.unexpected_closes,
            "heartbeats": self.heartbeats,
            "eventFrames": self.event_frames,
            "invalidJsonFrames": self.invalid_json_frames,
            "readyLatencyMs": latency_summary(self.ready_latencies_ms),
        }


def _postgres_summary(
    samples: list[dict[str, Any]],
    *,
    max_connections: int,
) -> dict[str, Any]:
    postgres_samples = [
        sample
        for sample in samples
        if isinstance(sample.get("postgres"), dict)
    ]
    baseline_sample = next(
        (sample["postgres"] for sample in postgres_samples if sample.get("phase") == "baseline"),
        {},
    )
    cleanup_sample = next(
        (sample["postgres"] for sample in reversed(postgres_samples) if sample.get("phase") == "cleanup"),
        {},
    )
    postgres_rows = [sample["postgres"] for sample in postgres_samples]
    return {
        "maxConnections": max_connections,
        "baselineConnections": int(baseline_sample.get("total", 0)),
        "peakConnections": max((int(sample.get("total", 0)) for sample in postgres_rows), default=0),
        "cleanupConnections": int(cleanup_sample.get("total", 0)),
        "peakActive": max((int(sample.get("active", 0)) for sample in postgres_rows), default=0),
        "peakWaiting": max((int(sample.get("waiting", 0)) for sample in postgres_rows), default=0),
        "peakNotifyPublishers": max(
            (int(sample.get("notify_publishers", 0)) for sample in postgres_rows),
            default=0,
        ),
        "peakNotifyListeners": max(
            (int(sample.get("notify_listeners", 0)) for sample in postgres_rows),
            default=0,
        ),
    }


class ResourceMonitor:
    def __init__(self, config: ProbeConfig, *, started_at: float | None = None) -> None:
        self.config = config
        self.connection: Any = None
        self.max_connections = 0
        self.samples: list[dict[str, Any]] = []
        self.error_types: Counter[str] = Counter()
        self.container_error_types: Counter[str] = Counter()
        self.container_ids: dict[str, str] = {}
        self.backend_runtime: dict[str, int] = {}
        self.frontend_runtime: dict[str, int] = {}
        self.optional_service_runtime: dict[str, int] = {}
        self.candidate_image_revisions: dict[str, str] = {}
        self.sampling_overruns = 0
        self.started_at = time.monotonic() if started_at is None else started_at

    async def start(self) -> None:
        import asyncpg

        self.connection = await asyncpg.connect(
            dsn=self.config.target.database_url,
            timeout=5,
            command_timeout=self.config.request_timeout_seconds,
            server_settings={"application_name": "smallkhoj-capacity-observer"},
        )
        self.max_connections = int(await self.connection.fetchval("SHOW max_connections"))
        if self.max_connections != self.config.expected_postgres_max_connections:
            raise ProbeError(
                "PostgreSQL max_connections does not match the expected profile"
            )
        self.container_ids = await asyncio.to_thread(
            discover_compose_containers,
            self.config.compose_project,
        )
        self.optional_service_runtime = await asyncio.to_thread(
            inspect_optional_capacity_services,
            self.config.compose_project,
        )
        self.backend_runtime = await asyncio.to_thread(
            inspect_backend_runtime_config,
            self.container_ids["backend"],
        )
        self.frontend_runtime = await asyncio.to_thread(
            inspect_frontend_runtime_config,
            self.container_ids["frontend"],
        )
        self.candidate_image_revisions = await asyncio.to_thread(
            inspect_candidate_image_revisions,
            self.container_ids,
        )
        expected_runtime = {
            "workers": self.config.expected_backend_workers,
            "databasePoolSize": self.config.expected_database_pool_size,
            "databaseMaxOverflow": self.config.expected_database_max_overflow,
            "notifyPublisherPoolSize": self.config.expected_notify_publisher_pool_size,
            "betterAuthDatabasePoolSize": (
                self.config.expected_better_auth_database_pool_size
            ),
            "postgresMaxConnections": self.config.expected_postgres_max_connections,
            "postgresConnectionHeadroom": (
                self.config.expected_postgres_connection_headroom
            ),
        }
        if self.backend_runtime != expected_runtime:
            raise ProbeError("backend runtime capacity config does not match the expected profile")
        expected_frontend_runtime = {
            "betterAuthDatabasePoolSize": (
                self.config.expected_better_auth_database_pool_size
            )
        }
        if self.frontend_runtime != expected_frontend_runtime:
            raise ProbeError("frontend runtime capacity config does not match the expected profile")

    async def sample(self, phase: str) -> dict[str, Any] | None:
        if self.connection is None:
            return None
        sample_started = time.monotonic()
        try:
            activity = await self.connection.fetchrow(
                """
                SELECT
                    count(*)::int AS total,
                    count(*) FILTER (WHERE state = 'active')::int AS active,
                    count(*) FILTER (WHERE state = 'idle')::int AS idle,
                    count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction,
                    count(*) FILTER (WHERE state = 'active' AND wait_event IS NOT NULL)::int AS waiting,
                    count(*) FILTER (WHERE application_name = 'smallkhoj-notify-publisher')::int AS notify_publishers,
                    count(*) FILTER (WHERE application_name = 'smallkhoj-notify-listener')::int AS notify_listeners,
                    count(*) FILTER (WHERE application_name = 'smallkhoj-capacity-observer')::int AS observers
                FROM pg_stat_activity
                WHERE datname = current_database()
                """
            )
            database = await self.connection.fetchrow(
                """
                SELECT xact_commit, xact_rollback, deadlocks, temp_bytes
                FROM pg_stat_database
                WHERE datname = current_database()
                """
            )
            try:
                container_states = await asyncio.to_thread(inspect_container_states, self.container_ids)
                container_stats = await asyncio.to_thread(sample_docker_stats, self.container_ids)
            except Exception as exc:
                self.container_error_types[type(exc).__name__] += 1
                raise
            sample_finished = time.monotonic()
            sample = {
                "elapsedSeconds": round(sample_finished - self.started_at, 3),
                "sampleStartedElapsedSeconds": round(sample_started - self.started_at, 3),
                "sampleFinishedElapsedSeconds": round(sample_finished - self.started_at, 3),
                "sampleDurationSeconds": round(max(0.0, sample_finished - sample_started), 3),
                "phase": phase,
                "postgres": dict(activity),
                "database": dict(database),
                "process": await asyncio.to_thread(process_snapshot, self.config.backend_pid),
                "containers": {
                    service: {**container_states[service], **container_stats[service]}
                    for service in CORE_COMPOSE_SERVICES
                },
            }
            self.samples.append(sample)
            return sample
        except Exception as exc:
            self.error_types[type(exc).__name__] += 1
            return None

    async def close(self) -> None:
        if self.connection is not None:
            await self.connection.close()
            self.connection = None

    def postgres_summary(self) -> dict[str, Any]:
        return _postgres_summary(self.samples, max_connections=self.max_connections)

    def process_summary(self) -> dict[str, Any]:
        process_samples = [sample["process"] for sample in self.samples if sample.get("process")]
        baseline = next(
            (sample["process"] for sample in self.samples if sample.get("phase") == "baseline"),
            process_samples[0] if process_samples else {},
        )
        cleanup = next(
            (sample["process"] for sample in reversed(self.samples) if sample.get("phase") == "cleanup"),
            process_samples[-1] if process_samples else {},
        )
        return {
            "pid": self.config.backend_pid,
            "baselineRssMiB": baseline.get("rssMiB"),
            "peakRssMiB": max(
                (float(sample["rssMiB"]) for sample in process_samples if sample.get("rssMiB") is not None),
                default=None,
            ),
            "cleanupRssMiB": cleanup.get("rssMiB"),
            "baselineFileDescriptors": baseline.get("fileDescriptors"),
            "peakFileDescriptors": max(
                (
                    int(sample["fileDescriptors"])
                    for sample in process_samples
                    if sample.get("fileDescriptors") is not None
                ),
                default=None,
            ),
            "cleanupFileDescriptors": cleanup.get("fileDescriptors"),
            "peakCpuPercent": max(
                (float(sample["cpuPercent"]) for sample in process_samples if sample.get("cpuPercent") is not None),
                default=None,
            ),
        }

    def container_summary(self) -> dict[str, Any]:
        return _container_summary(
            self.samples,
            monitoring_errors=sum(self.container_error_types.values()),
            sampling_overruns=self.sampling_overruns,
        )


class SseFrameParser:
    def __init__(self) -> None:
        self._event = "message"
        self._event_id = ""
        self._data_lines: list[str] = []

    def feed_line(self, line: str) -> list[SseFrame]:
        if line.startswith(":"):
            return []
        if line == "":
            if not self._data_lines:
                self._reset()
                return []
            import json

            raw_data = "\n".join(self._data_lines)
            try:
                data: Any = json.loads(raw_data)
            except json.JSONDecodeError:
                data = raw_data
            frame = SseFrame(event=self._event, event_id=self._event_id, data=data)
            self._reset()
            return [frame]
        if line.startswith("event:"):
            self._event = line.split(":", 1)[1].lstrip() or "message"
        elif line.startswith("id:"):
            self._event_id = line.split(":", 1)[1].lstrip()
        elif line.startswith("data:"):
            self._data_lines.append(line.split(":", 1)[1].lstrip())
        return []

    def _reset(self) -> None:
        self._event = "message"
        self._event_id = ""
        self._data_lines = []


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the local-only SmallKhoj 300-SSE/500-peak capacity profile.",
    )
    parser.add_argument(
        "--profile",
        dest="profile_id",
        choices=(FORMAL_PROFILE_ID, SMOKE_PROFILE_ID),
        default=FORMAL_PROFILE_ID,
        help=(
            "Evidence profile. Only formal-300-500-30-v1 can produce formal "
            "capacity acceptance; smoke is diagnostic only."
        ),
    )
    parser.add_argument("--steady-sse", type=int, default=300)
    parser.add_argument("--spike-total-sse", type=int, default=500)
    parser.add_argument("--active-users", type=int, default=30)
    parser.add_argument("--active-cycle-seconds", type=float, default=5.0)
    parser.add_argument("--duration-seconds", type=float, default=1_800.0)
    parser.add_argument("--ramp-seconds", type=float, default=60.0)
    parser.add_argument("--spike-at-seconds", type=float, default=590.0)
    parser.add_argument("--spike-ramp-seconds", type=float, default=10.0)
    parser.add_argument("--spike-duration-seconds", type=float, default=60.0)
    parser.add_argument("--cleanup-timeout-seconds", type=float, default=60.0)
    parser.add_argument("--connect-timeout-seconds", type=float, default=20.0)
    parser.add_argument("--request-timeout-seconds", type=float, default=20.0)
    parser.add_argument("--resource-sample-seconds", type=float, default=5.0)
    parser.add_argument("--fixture-concurrency", type=int, default=20)
    parser.add_argument("--sse-ready-p95-ms", type=float, default=2_000.0)
    parser.add_argument("--read-p95-ms", type=float, default=500.0)
    parser.add_argument("--write-p95-ms", type=float, default=1_000.0)
    parser.add_argument("--event-delivery-p95-ms", type=float, default=2_000.0)
    parser.add_argument("--postgres-headroom", type=int, default=5)
    parser.add_argument("--backend-pid", type=int)
    parser.add_argument("--output", type=Path, required=True)
    return parser.parse_args(argv)


def _is_loopback(hostname: str | None) -> bool:
    if not hostname:
        return False
    if hostname.lower() == "localhost":
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def validate_safety(*, api_base: str, database_url: str, database_scope: str) -> SafetyTarget:
    if database_scope != "disposable":
        raise SafetyError("capacity probe requires a disposable database scope")

    api = urlparse(api_base.strip())
    if (
        api.scheme not in {"http", "https"}
        or not _is_loopback(api.hostname)
        or api.username
        or api.password
        or api.query
        or api.fragment
        or api.params
        or api.path not in {"", "/"}
    ):
        raise SafetyError("capacity API target must be a credential-free loopback base URL")
    normalized_api = urlunparse((api.scheme, api.netloc, "", "", "", "")).rstrip("/")

    database = urlparse(database_url.strip())
    if database.scheme not in {"postgresql", "postgresql+asyncpg"} or not _is_loopback(database.hostname):
        raise SafetyError("capacity database target must be loopback PostgreSQL")
    if database.query or database.fragment or database.params:
        raise SafetyError("capacity database URL must not contain query or fragment data")
    database_name = database.path.lstrip("/")
    lowered_name = database_name.lower()
    if not database_name or not any(token in lowered_name for token in DISPOSABLE_DATABASE_TOKENS):
        raise SafetyError("capacity database name must be explicitly disposable")
    normalized_database = urlunparse(
        ("postgresql", database.netloc, database.path, "", "", ""),
    )

    return SafetyTarget(
        api_base=normalized_api,
        database_url=normalized_database,
        database_name=database_name,
    )


def percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    if not 0 < quantile <= 1:
        raise ValueError("quantile must be in (0, 1]")
    ordered = sorted(values)
    rank = max(1, math.ceil(len(ordered) * quantile))
    return ordered[rank - 1]


def latency_summary(values: list[float]) -> dict[str, float | int | None]:
    if not values:
        return {"count": 0, "min": None, "p50": None, "p95": None, "p99": None, "max": None}
    return {
        "count": len(values),
        "min": round(min(values), 3),
        "p50": round(percentile(values, 0.50) or 0.0, 3),
        "p95": round(percentile(values, 0.95) or 0.0, 3),
        "p99": round(percentile(values, 0.99) or 0.0, 3),
        "max": round(max(values), 3),
    }


def _is_strict_int(value: Any) -> bool:
    return type(value) is int


def _is_finite_number(value: Any) -> bool:
    return type(value) in {int, float} and math.isfinite(float(value))


def _candidate_provenance_valid(candidate: dict[str, Any]) -> bool:
    head = candidate.get("head")
    tree = candidate.get("tree")
    branch = candidate.get("branch")
    dirty = candidate.get("dirty")
    diff_hash = candidate.get("workingDiffSha256")
    evidence_valid = (
        isinstance(head, str)
        and re.fullmatch(r"[0-9a-f]{40}", head, flags=re.IGNORECASE) is not None
        and isinstance(tree, str)
        and re.fullmatch(r"[0-9a-f]{40}", tree, flags=re.IGNORECASE) is not None
        and isinstance(branch, str)
        and bool(branch.strip())
        and branch.strip().lower() != "unknown"
        and type(dirty) is bool
        and isinstance(diff_hash, str)
        and re.fullmatch(r"[0-9a-f]{64}", diff_hash, flags=re.IGNORECASE) is not None
    )
    if not evidence_valid:
        return False
    return dirty is True or diff_hash.lower() == EMPTY_GIT_DIFF_SHA256


def _latency_evidence_valid(summary: Any, *, expected_count: Any) -> bool:
    if (
        not isinstance(summary, dict)
        or not _is_strict_int(expected_count)
        or expected_count <= 0
        or not _is_strict_int(summary.get("count"))
        or summary["count"] != expected_count
    ):
        return False
    percentiles: list[float] = []
    for field in LATENCY_PERCENTILE_FIELDS:
        value = summary.get(field)
        if not _is_finite_number(value) or value < 0:
            return False
        percentiles.append(float(value))
    return percentiles == sorted(percentiles)


def _http_latency_expected_count(metric: Any) -> int | None:
    if not isinstance(metric, dict):
        return None
    fields = ("requests", "successes", "non2xx", "errors")
    if any(
        not _is_strict_int(metric.get(field)) or metric[field] < 0
        for field in fields
    ):
        return None
    timed_requests = metric["successes"] + metric["non2xx"]
    if metric["requests"] != timed_requests + metric["errors"]:
        return None
    return timed_requests


def _is_zero_count(value: Any) -> bool:
    return _is_strict_int(value) and value == 0


def _resource_sample_evidence_valid(samples: list[Any]) -> bool:
    previous_started: float | None = None
    previous_finished: float | None = None
    previous_database: dict[str, int] | None = None
    for sample in samples:
        if not isinstance(sample, dict) or sample.get("phase") not in CONTAINER_SAMPLE_PHASES:
            return False
        started = sample.get("sampleStartedElapsedSeconds")
        finished = sample.get("sampleFinishedElapsedSeconds")
        duration = sample.get("sampleDurationSeconds")
        elapsed = sample.get("elapsedSeconds")
        if (
            not _is_finite_number(started)
            or not _is_finite_number(finished)
            or not _is_finite_number(duration)
            or not _is_finite_number(elapsed)
            or started < 0
            or finished < started
            or duration < 0
            or abs(float(finished) - float(started) - float(duration))
            > DURATION_EVIDENCE_TOLERANCE_SECONDS
            or abs(float(elapsed) - float(finished)) > DURATION_EVIDENCE_TOLERANCE_SECONDS
        ):
            return False
        if (
            previous_started is not None
            and (
                float(started) < previous_started
                or (
                    previous_finished is not None
                    and float(started) + DURATION_EVIDENCE_TOLERANCE_SECONDS
                    < previous_finished
                )
            )
        ):
            return False
        previous_started = float(started)
        previous_finished = float(finished)

        postgres = sample.get("postgres")
        if not isinstance(postgres, dict) or any(
            not _is_strict_int(postgres.get(field)) or postgres[field] < 0
            for field in POSTGRES_SAMPLE_FIELDS
        ):
            return False
        if (
            postgres["active"] + postgres["idle"] + postgres["idle_in_transaction"]
            > postgres["total"]
            or postgres["waiting"] > postgres["active"]
            or any(
                postgres[field] > postgres["total"]
                for field in ("notify_publishers", "notify_listeners", "observers")
            )
        ):
            return False
        database = sample.get("database")
        if not isinstance(database, dict) or any(
            not _is_strict_int(database.get(field)) or database[field] < 0
            for field in DATABASE_COUNTER_FIELDS
        ):
            return False
        if previous_database is not None and any(
            database[field] < previous_database[field]
            for field in DATABASE_COUNTER_FIELDS
        ):
            return False
        previous_database = database
        if not isinstance(sample.get("process"), dict):
            return False

        containers = sample.get("containers")
        if not isinstance(containers, dict) or set(containers) != set(CORE_COMPOSE_SERVICES):
            return False
        for service in CORE_COMPOSE_SERVICES:
            observation = containers.get(service)
            if not isinstance(observation, dict):
                return False
            if any(
                not isinstance(observation.get(field), str) or not observation[field]
                for field in ("containerId", "imageId", "status")
            ):
                return False
            if type(observation.get("running")) is not bool or type(
                observation.get("oomKilled")
            ) is not bool:
                return False
            if any(
                not _is_strict_int(observation.get(field)) or observation[field] < 0
                for field in CONTAINER_SAMPLE_INTEGER_FIELDS
            ):
                return False
            if any(
                not _is_finite_number(observation.get(field)) or observation[field] < 0
                for field in CONTAINER_SAMPLE_NUMBER_FIELDS
            ):
                return False
    return True


def _resource_container_state_failures(samples: list[dict[str, Any]]) -> list[str]:
    failures: list[str] = []
    baseline = samples[0]["containers"]
    for sample in samples:
        for service in CORE_COMPOSE_SERVICES:
            expected = baseline[service]
            observed = sample["containers"][service]
            if expected["restartCount"] != 0:
                failures.append("CONTAINER_RESTARTED")
            if observed["containerId"] != expected["containerId"]:
                failures.append("CONTAINER_ID_CHANGED")
            if observed["imageId"] != expected["imageId"]:
                failures.append("CONTAINER_IMAGE_CHANGED")
            if observed["restartCount"] != expected["restartCount"]:
                failures.append("CONTAINER_RESTARTED")
            if observed["oomKilled"]:
                failures.append("CONTAINER_OOM_KILLED")
            if observed["running"] is not True or observed["status"] != "running":
                failures.append("CONTAINER_NOT_RUNNING")
    return list(dict.fromkeys(failures))


def _max_resource_sample_gap(resource_sample_seconds: float) -> float:
    return max(
        resource_sample_seconds * MAX_RESOURCE_SAMPLE_GAP_MULTIPLIER,
        resource_sample_seconds + MAX_RESOURCE_SAMPLE_GAP_SLACK_SECONDS,
    )


def _resource_sample_timeline_valid(
    samples: list[dict[str, Any]],
    timeline: dict[str, Any],
    *,
    resource_sample_seconds: float,
) -> bool:
    if not samples or samples[0].get("phase") != "baseline" or samples[-1].get("phase") != "cleanup":
        return False
    phase_ranks = {phase: rank for rank, phase in enumerate(CONTAINER_SAMPLE_PHASES)}
    observed_ranks = [phase_ranks[sample["phase"]] for sample in samples]
    if (
        sum(1 for sample in samples if sample["phase"] == "baseline") != 1
        or any(
            current < previous
            for previous, current in zip(observed_ranks, observed_ranks[1:], strict=False)
        )
    ):
        return False
    windows: dict[str, tuple[float | None, float]] = {
        "baseline": (None, float(timeline["steadyReadyAtSeconds"])),
        "steady-ramp": (None, float(timeline["steadyReadyAtSeconds"])),
        "steady": (
            float(timeline["workloadStartedAtSeconds"]),
            float(timeline["spikeRampStartedAtSeconds"]),
        ),
        "spike-ramp": (
            float(timeline["spikeRampStartedAtSeconds"]),
            float(timeline["spikePeakReadyAtSeconds"]),
        ),
        "spike-hold": (
            float(timeline["spikePeakReadyAtSeconds"]),
            float(timeline["spikePeakEndedAtSeconds"]),
        ),
        "post-spike": (
            float(timeline["spikePeakEndedAtSeconds"]),
            float(timeline["cleanupStartedAtSeconds"]),
        ),
        "cleanup": (
            float(timeline["cleanupStartedAtSeconds"]),
            float(timeline["cleanupEndedAtSeconds"]),
        ),
    }
    label_tolerance = max(TIMELINE_TOLERANCE_SECONDS, resource_sample_seconds)

    def is_witness(sample: dict[str, Any]) -> bool:
        started = float(sample["sampleStartedElapsedSeconds"])
        lower, upper = windows[sample["phase"]]
        return (
            (lower is None or started + TIMELINE_TOLERANCE_SECONDS >= lower)
            and started - TIMELINE_TOLERANCE_SECONDS <= upper
        )

    for sample in samples:
        started = float(sample["sampleStartedElapsedSeconds"])
        finished = float(sample["sampleFinishedElapsedSeconds"])
        lower, upper = windows[sample["phase"]]
        if lower is not None and finished + label_tolerance < lower:
            return False
        if started - label_tolerance > upper:
            return False

    witness_counts = Counter(
        sample["phase"]
        for sample in samples
        if is_witness(sample)
    )
    if (
        witness_counts["baseline"] != 1
        or witness_counts["steady"] + witness_counts["steady-ramp"] < 1
        or witness_counts["spike-hold"] < 2
        or witness_counts["post-spike"] < 1
        or witness_counts["cleanup"] < 2
    ):
        return False

    cleanup_samples = [sample for sample in samples if sample["phase"] == "cleanup"]
    steady_ramp_started = float(timeline["steadyRampStartedAtSeconds"])
    baseline_finished = float(samples[0]["sampleFinishedElapsedSeconds"])
    first_post_baseline_started = float(samples[1]["sampleStartedElapsedSeconds"])
    cleanup_started = float(timeline["cleanupStartedAtSeconds"])
    cleanup_ended = float(timeline["cleanupEndedAtSeconds"])
    first_cleanup_started = float(cleanup_samples[0]["sampleStartedElapsedSeconds"])
    final_finished = float(samples[-1]["sampleFinishedElapsedSeconds"])
    allowed_gap = _max_resource_sample_gap(resource_sample_seconds)
    return (
        abs(baseline_finished - steady_ramp_started)
        <= allowed_gap + TIMELINE_TOLERANCE_SECONDS
        and abs(first_post_baseline_started - steady_ramp_started)
        <= allowed_gap + TIMELINE_TOLERANCE_SECONDS
        and
        abs(first_cleanup_started - cleanup_started)
        <= allowed_gap + TIMELINE_TOLERANCE_SECONDS
        and abs(cleanup_ended - final_finished)
        <= allowed_gap + TIMELINE_TOLERANCE_SECONDS
    )


def _required_env(env: dict[str, str], name: str) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise SafetyError(f"{name} is required for the local capacity probe")
    return value


def _required_positive_int_env(env: dict[str, str], name: str) -> int:
    raw_value = _required_env(env, name)
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise SafetyError(f"{name} must be an integer") from exc
    _positive(value, name)
    return value


def _required_non_negative_int_env(env: dict[str, str], name: str) -> int:
    raw_value = _required_env(env, name)
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise SafetyError(f"{name} must be an integer") from exc
    _positive(value, name, allow_zero=True)
    return value


def _positive(value: int | float, name: str, *, allow_zero: bool = False) -> None:
    if not _is_finite_number(value):
        raise SafetyError(f"{name} must be a finite number")
    numeric_value = float(value)
    invalid = numeric_value < 0 if allow_zero else numeric_value <= 0
    if invalid:
        comparator = "non-negative" if allow_zero else "positive"
        raise SafetyError(f"{name} must be {comparator}")


def load_config(args: argparse.Namespace, env: dict[str, str]) -> ProbeConfig:
    public_api_key = _required_env(env, "PUBLIC_API_KEY")
    auth_bridge_secret = _required_env(env, "AUTH_BRIDGE_SECRET")
    namespace = _required_env(env, "CAPACITY_RUN_NAMESPACE")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,32}", namespace):
        raise SafetyError("CAPACITY_RUN_NAMESPACE must use 1-32 safe characters")
    compose_project = _required_env(env, "CAPACITY_COMPOSE_PROJECT")
    if COMPOSE_PROJECT_PATTERN.fullmatch(compose_project) is None:
        raise SafetyError("CAPACITY_COMPOSE_PROJECT must use safe Docker Compose project characters")
    expected_postgres_max_connections = _required_positive_int_env(
        env,
        "CAPACITY_EXPECTED_POSTGRES_MAX_CONNECTIONS",
    )
    expected_backend_workers = _required_positive_int_env(env, "BACKEND_WORKERS")
    expected_notify_publisher_pool_size = _required_positive_int_env(
        env,
        "NOTIFY_PUBLISHER_POOL_SIZE",
    )
    expected_database_pool_size = _required_positive_int_env(
        env,
        "DATABASE_POOL_SIZE",
    )
    expected_database_max_overflow = _required_non_negative_int_env(
        env,
        "DATABASE_MAX_OVERFLOW",
    )
    expected_better_auth_database_pool_size = _required_positive_int_env(
        env,
        "BETTER_AUTH_DATABASE_POOL_SIZE",
    )
    expected_postgres_connection_headroom = _required_positive_int_env(
        env,
        "POSTGRES_CONNECTION_HEADROOM",
    )
    backend_connections_per_process = (
        expected_database_pool_size
        + expected_database_max_overflow
        + expected_notify_publisher_pool_size
        + NOTIFY_LISTENER_CONNECTIONS_PER_BACKEND_WORKER
    )
    feishu_worker_reserve = (
        expected_database_pool_size + expected_database_max_overflow
    )
    required_postgres_connections = (
        backend_connections_per_process * expected_backend_workers
        + expected_better_auth_database_pool_size
        + feishu_worker_reserve
        + expected_postgres_connection_headroom
    )
    if required_postgres_connections > expected_postgres_max_connections:
        raise SafetyError(
            "PostgreSQL connection budget exceeds the expected capacity: "
            f"required={required_postgres_connections} "
            f"capacity={expected_postgres_max_connections}"
        )
    target = validate_safety(
        api_base=_required_env(env, "API_BASE"),
        database_url=_required_env(env, "CAPACITY_DATABASE_URL"),
        database_scope=_required_env(env, "CAPACITY_DATABASE_SCOPE"),
    )

    for value, name in (
        (args.steady_sse, "steady SSE count"),
        (args.spike_total_sse, "spike SSE count"),
        (args.active_users, "active user count"),
        (args.active_cycle_seconds, "active cycle"),
        (args.duration_seconds, "duration"),
        (args.spike_duration_seconds, "spike duration"),
        (args.cleanup_timeout_seconds, "cleanup timeout"),
        (args.connect_timeout_seconds, "connect timeout"),
        (args.request_timeout_seconds, "request timeout"),
        (args.resource_sample_seconds, "resource sample interval"),
        (args.fixture_concurrency, "fixture concurrency"),
        (args.sse_ready_p95_ms, "SSE ready p95 threshold"),
        (args.read_p95_ms, "read p95 threshold"),
        (args.write_p95_ms, "write p95 threshold"),
        (args.event_delivery_p95_ms, "event delivery p95 threshold"),
        (args.postgres_headroom, "PostgreSQL headroom"),
    ):
        _positive(value, name)
    for value, name in (
        (args.ramp_seconds, "ramp duration"),
        (args.spike_at_seconds, "spike start"),
        (args.spike_ramp_seconds, "spike ramp duration"),
    ):
        _positive(value, name, allow_zero=True)
    if args.steady_sse >= args.spike_total_sse:
        raise SafetyError("steady SSE count must be lower than the total spike count")
    if args.active_users > args.steady_sse:
        raise SafetyError("active users must not exceed steady SSE users")
    if args.duration_seconds < args.active_cycle_seconds:
        raise SafetyError("duration must include at least one active-user cycle")
    if args.spike_at_seconds + args.spike_ramp_seconds + args.spike_duration_seconds > args.duration_seconds:
        raise SafetyError("spike ramp and hold must fit inside the steady duration")
    if args.profile_id == FORMAL_PROFILE_ID:
        formal_profile_valid = (
            args.steady_sse >= FORMAL_MIN_STEADY_SSE
            and args.spike_total_sse >= FORMAL_MIN_PEAK_SSE
            and args.active_users >= FORMAL_MIN_ACTIVE_USERS
            and args.active_cycle_seconds <= FORMAL_MAX_ACTIVE_CYCLE_SECONDS
            and args.duration_seconds >= FORMAL_MIN_DURATION_SECONDS
            and args.ramp_seconds <= FORMAL_MAX_RAMP_SECONDS
            and args.spike_at_seconds >= FORMAL_MIN_SPIKE_AT_SECONDS
            and args.spike_ramp_seconds <= FORMAL_MAX_SPIKE_RAMP_SECONDS
            and args.spike_duration_seconds >= FORMAL_MIN_SPIKE_DURATION_SECONDS
            and args.cleanup_timeout_seconds >= FORMAL_MIN_CLEANUP_SECONDS
            and args.resource_sample_seconds <= FORMAL_MAX_RESOURCE_SAMPLE_SECONDS
            and expected_postgres_max_connections
            == FORMAL_POSTGRES_MAX_CONNECTIONS
            and expected_backend_workers == FORMAL_BACKEND_WORKERS
            and expected_notify_publisher_pool_size
            == FORMAL_NOTIFY_PUBLISHER_POOL_SIZE
            and expected_database_pool_size == FORMAL_DATABASE_POOL_SIZE
            and expected_database_max_overflow == FORMAL_DATABASE_MAX_OVERFLOW
            and expected_better_auth_database_pool_size
            == FORMAL_BETTER_AUTH_DATABASE_POOL_SIZE
            and expected_postgres_connection_headroom
            == FORMAL_POSTGRES_CONNECTION_HEADROOM
            and required_postgres_connections
            == FORMAL_REQUIRED_POSTGRES_CONNECTIONS
            and args.sse_ready_p95_ms
            <= FORMAL_THRESHOLD_LIMITS["sseReadyP95Ms"]
            and args.read_p95_ms <= FORMAL_THRESHOLD_LIMITS["readP95Ms"]
            and args.write_p95_ms <= FORMAL_THRESHOLD_LIMITS["writeP95Ms"]
            and args.event_delivery_p95_ms
            <= FORMAL_THRESHOLD_LIMITS["eventDeliveryP95Ms"]
            and args.postgres_headroom
            >= FORMAL_THRESHOLD_LIMITS["postgresHeadroom"]
        )
        if not formal_profile_valid:
            raise SafetyError(
                "formal-300-500-30-v1 capacity settings cannot be weakened; "
                "use --profile smoke for a diagnostic run"
            )

    backend_pid = args.backend_pid
    if backend_pid is None and env.get("BACKEND_PID", "").strip():
        try:
            backend_pid = int(env["BACKEND_PID"])
        except ValueError as exc:
            raise SafetyError("BACKEND_PID must be an integer") from exc
    if backend_pid is not None and backend_pid <= 0:
        raise SafetyError("BACKEND_PID must be positive")

    return ProbeConfig(
        target=target,
        profile_id=args.profile_id,
        namespace=namespace,
        public_api_key=public_api_key,
        auth_bridge_secret=auth_bridge_secret,
        compose_project=compose_project,
        expected_postgres_max_connections=expected_postgres_max_connections,
        expected_backend_workers=expected_backend_workers,
        expected_notify_publisher_pool_size=expected_notify_publisher_pool_size,
        expected_database_pool_size=expected_database_pool_size,
        expected_database_max_overflow=expected_database_max_overflow,
        expected_better_auth_database_pool_size=(
            expected_better_auth_database_pool_size
        ),
        expected_postgres_connection_headroom=(
            expected_postgres_connection_headroom
        ),
        steady_sse=args.steady_sse,
        spike_total_sse=args.spike_total_sse,
        active_users=args.active_users,
        active_cycle_seconds=args.active_cycle_seconds,
        duration_seconds=args.duration_seconds,
        ramp_seconds=args.ramp_seconds,
        spike_at_seconds=args.spike_at_seconds,
        spike_ramp_seconds=args.spike_ramp_seconds,
        spike_duration_seconds=args.spike_duration_seconds,
        cleanup_timeout_seconds=args.cleanup_timeout_seconds,
        connect_timeout_seconds=args.connect_timeout_seconds,
        request_timeout_seconds=args.request_timeout_seconds,
        resource_sample_seconds=args.resource_sample_seconds,
        fixture_concurrency=args.fixture_concurrency,
        backend_pid=backend_pid,
        output=Path(args.output),
        thresholds=Thresholds(
            sse_ready_p95_ms=args.sse_ready_p95_ms,
            read_p95_ms=args.read_p95_ms,
            write_p95_ms=args.write_p95_ms,
            event_delivery_p95_ms=args.event_delivery_p95_ms,
            postgres_headroom=args.postgres_headroom,
        ),
    )


def _http_timeouts(
    httpx_module: Any,
    request_timeout_seconds: float,
    connect_timeout_seconds: float | None = None,
) -> tuple[Any, Any]:
    connection_timeout = (
        request_timeout_seconds if connect_timeout_seconds is None else connect_timeout_seconds
    )
    request_timeout = httpx_module.Timeout(
        connect=connection_timeout,
        read=request_timeout_seconds,
        write=connection_timeout,
        pool=connection_timeout,
    )
    stream_timeout = httpx_module.Timeout(
        connect=connection_timeout,
        read=None,
        write=connection_timeout,
        pool=connection_timeout,
    )
    return request_timeout, stream_timeout


DockerRunner = Callable[[list[str], str], str]


def _run_docker_command(command: list[str], purpose: str) -> str:
    try:
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise ProbeError(f"{purpose} could not run ({type(exc).__name__})") from exc
    if result.returncode != 0:
        raise ProbeError(f"{purpose} failed")
    return result.stdout


def discover_compose_containers(
    compose_project: str,
    *,
    runner: DockerRunner = _run_docker_command,
) -> dict[str, str]:
    if COMPOSE_PROJECT_PATTERN.fullmatch(compose_project) is None:
        raise SafetyError("Compose project contains unsafe characters")
    containers: dict[str, str] = {}
    for service in CORE_COMPOSE_SERVICES:
        output = runner(
            [
                "docker",
                "ps",
                "-aq",
                "--filter",
                f"label=com.docker.compose.project={compose_project}",
                "--filter",
                f"label=com.docker.compose.service={service}",
            ],
            "compose service discovery",
        )
        matches = [line.strip() for line in output.splitlines() if line.strip()]
        if len(matches) != 1:
            raise ProbeError(f"compose service discovery did not find exactly one {service} container")
        containers[service] = matches[0]
    return containers


def inspect_optional_capacity_services(
    compose_project: str,
    *,
    runner: DockerRunner = _run_docker_command,
) -> dict[str, int]:
    if COMPOSE_PROJECT_PATTERN.fullmatch(compose_project) is None:
        raise SafetyError("Compose project contains unsafe characters")
    output = runner(
        [
            "docker",
            "ps",
            "-aq",
            "--filter",
            f"label=com.docker.compose.project={compose_project}",
            "--filter",
            "label=com.docker.compose.service=feishu-worker",
        ],
        "optional capacity service discovery",
    )
    matches = [line.strip() for line in output.splitlines() if line.strip()]
    if matches:
        raise ProbeError(
            "formal capacity profile requires zero Feishu worker containers"
        )
    return {"feishuWorkerContainers": 0}


def inspect_backend_runtime_config(
    container_id: str,
    *,
    runner: DockerRunner = _run_docker_command,
) -> dict[str, int]:
    output = runner(
        [
            "docker",
            "exec",
            container_id,
            "sh",
            "-c",
            (
                'printf "%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n" '
                '"$BACKEND_WORKERS" "$DATABASE_POOL_SIZE" '
                '"$DATABASE_MAX_OVERFLOW" "$NOTIFY_PUBLISHER_POOL_SIZE" '
                '"$BETTER_AUTH_DATABASE_POOL_SIZE" '
                '"$POSTGRES_MAX_CONNECTIONS" '
                '"$POSTGRES_CONNECTION_HEADROOM"'
            ),
        ],
        "backend runtime capacity config inspection",
    )
    values = output.splitlines()
    if len(values) != 7:
        raise ProbeError("backend runtime capacity config inspection returned invalid evidence")
    try:
        (
            workers,
            database_pool_size,
            database_max_overflow,
            publisher_pool_size,
            better_auth_database_pool_size,
            postgres_max_connections,
            postgres_connection_headroom,
        ) = (int(value) for value in values)
    except ValueError as exc:
        raise ProbeError(
            "backend runtime capacity config inspection returned non-integer evidence"
        ) from exc
    if (
        workers <= 0
        or database_pool_size <= 0
        or database_max_overflow < 0
        or publisher_pool_size <= 0
        or better_auth_database_pool_size <= 0
        or postgres_max_connections <= 0
        or postgres_connection_headroom <= 0
    ):
        raise ProbeError("backend runtime capacity config inspection returned invalid values")
    return {
        "workers": workers,
        "databasePoolSize": database_pool_size,
        "databaseMaxOverflow": database_max_overflow,
        "notifyPublisherPoolSize": publisher_pool_size,
        "betterAuthDatabasePoolSize": better_auth_database_pool_size,
        "postgresMaxConnections": postgres_max_connections,
        "postgresConnectionHeadroom": postgres_connection_headroom,
    }


def inspect_frontend_runtime_config(
    container_id: str,
    *,
    runner: DockerRunner = _run_docker_command,
) -> dict[str, int]:
    output = runner(
        [
            "docker",
            "exec",
            container_id,
            "sh",
            "-c",
            'printf "%s\\n" "$BETTER_AUTH_DATABASE_POOL_SIZE"',
        ],
        "frontend runtime capacity config inspection",
    )
    values = output.splitlines()
    if len(values) != 1:
        raise ProbeError("frontend runtime capacity config inspection returned invalid evidence")
    try:
        better_auth_database_pool_size = int(values[0])
    except ValueError as exc:
        raise ProbeError(
            "frontend runtime capacity config inspection returned non-integer evidence"
        ) from exc
    if better_auth_database_pool_size <= 0:
        raise ProbeError("frontend runtime capacity config inspection returned invalid values")
    return {"betterAuthDatabasePoolSize": better_auth_database_pool_size}


def _service_for_container(container_id: str, container_ids: dict[str, str]) -> str | None:
    matches = [
        service
        for service, expected in container_ids.items()
        if container_id == expected or container_id.startswith(expected) or expected.startswith(container_id)
    ]
    return matches[0] if len(matches) == 1 else None


def inspect_candidate_image_revisions(
    container_ids: dict[str, str],
    *,
    runner: DockerRunner = _run_docker_command,
) -> dict[str, str]:
    candidate_container_ids = {
        service: container_ids[service]
        for service in CANDIDATE_IMAGE_SERVICES
    }
    output = runner(
        [
            "docker",
            "inspect",
            "--format",
            DOCKER_REVISION_FORMAT,
            *candidate_container_ids.values(),
        ],
        "candidate image revision inspection",
    )
    revisions: dict[str, str] = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ProbeError("candidate image revision inspection returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise ProbeError("candidate image revision inspection returned an invalid payload")
        container_id = payload.get("containerId")
        revision = payload.get("sourceRevision")
        if not isinstance(container_id, str) or not isinstance(revision, str):
            raise ProbeError("candidate image revision inspection omitted required evidence")
        service = _service_for_container(container_id, candidate_container_ids)
        if service is None or service in revisions:
            raise ProbeError("candidate image revision inspection returned an unknown container")
        if re.fullmatch(r"[0-9a-f]{40}", revision, flags=re.IGNORECASE) is None:
            raise ProbeError("candidate image revision inspection returned an invalid revision")
        revisions[service] = revision.lower()
    if set(revisions) != set(CANDIDATE_IMAGE_SERVICES):
        raise ProbeError("candidate image revision inspection did not cover candidate services")
    return revisions


def inspect_container_states(
    container_ids: dict[str, str],
    *,
    runner: DockerRunner = _run_docker_command,
) -> dict[str, dict[str, Any]]:
    output = runner(
        ["docker", "inspect", "--format", DOCKER_STATE_FORMAT, *container_ids.values()],
        "container state inspection",
    )
    states: dict[str, dict[str, Any]] = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ProbeError("container state inspection returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise ProbeError("container state inspection returned an invalid payload")
        container_id = payload.get("containerId")
        if not isinstance(container_id, str):
            raise ProbeError("container state inspection omitted a container ID")
        service = _service_for_container(container_id, container_ids)
        if service is None or service in states:
            raise ProbeError("container state inspection returned an unknown or duplicate container")
        required_types = {
            "imageId": str,
            "status": str,
            "running": bool,
            "restartCount": int,
            "oomKilled": bool,
        }
        if any(not isinstance(payload.get(key), expected) for key, expected in required_types.items()):
            raise ProbeError("container state inspection omitted a required field")
        states[service] = {
            "containerId": container_id,
            "imageId": payload["imageId"],
            "status": payload["status"],
            "running": payload["running"],
            "restartCount": payload["restartCount"],
            "oomKilled": payload["oomKilled"],
        }
    if set(states) != set(CORE_COMPOSE_SERVICES):
        raise ProbeError("container state inspection did not cover all core services")
    return states


_DOCKER_SIZE_PATTERN = re.compile(r"^([0-9]+(?:\.[0-9]+)?)\s*([KMGT]?i?B)$", re.IGNORECASE)
_DOCKER_SIZE_MULTIPLIERS = {
    "b": 1,
    "kb": 1_000,
    "mb": 1_000_000,
    "gb": 1_000_000_000,
    "tb": 1_000_000_000_000,
    "kib": 1_024,
    "mib": 1_024**2,
    "gib": 1_024**3,
    "tib": 1_024**4,
}


def _docker_size_bytes(value: str) -> int:
    match = _DOCKER_SIZE_PATTERN.fullmatch(value.strip())
    if match is None:
        raise ProbeError("container resource sampling returned an invalid size")
    number, unit = match.groups()
    return round(float(number) * _DOCKER_SIZE_MULTIPLIERS[unit.lower()])


def _docker_io_pair(value: str) -> tuple[int, int]:
    fields = [field.strip() for field in value.split("/")]
    if len(fields) != 2:
        raise ProbeError("container resource sampling returned an invalid I/O pair")
    return _docker_size_bytes(fields[0]), _docker_size_bytes(fields[1])


def _docker_percent(value: Any) -> float:
    if not isinstance(value, str) or not value.endswith("%"):
        raise ProbeError("container resource sampling returned an invalid percentage")
    try:
        return float(value[:-1])
    except ValueError as exc:
        raise ProbeError("container resource sampling returned an invalid percentage") from exc


def sample_docker_stats(
    container_ids: dict[str, str],
    *,
    runner: DockerRunner = _run_docker_command,
) -> dict[str, dict[str, Any]]:
    output = runner(
        [
            "docker",
            "stats",
            "--no-stream",
            "--format",
            DOCKER_STATS_FORMAT,
            *container_ids.values(),
        ],
        "container resource sampling",
    )
    samples: dict[str, dict[str, Any]] = {}
    for line in output.splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ProbeError("container resource sampling returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise ProbeError("container resource sampling returned an invalid payload")
        observed_id = payload.get("ID") or payload.get("Container")
        if not isinstance(observed_id, str):
            raise ProbeError("container resource sampling omitted a container ID")
        service = _service_for_container(observed_id, container_ids)
        if service is None or service in samples:
            raise ProbeError("container resource sampling returned an unknown or duplicate container")
        memory_usage = payload.get("MemUsage")
        network_io = payload.get("NetIO")
        block_io = payload.get("BlockIO")
        if not all(isinstance(value, str) for value in (memory_usage, network_io, block_io)):
            raise ProbeError("container resource sampling omitted a required I/O field")
        memory_used, memory_limit = _docker_io_pair(memory_usage)
        network_rx, network_tx = _docker_io_pair(network_io)
        block_read, block_write = _docker_io_pair(block_io)
        try:
            pids = int(payload.get("PIDs", ""))
        except (TypeError, ValueError) as exc:
            raise ProbeError("container resource sampling returned an invalid PID count") from exc
        samples[service] = {
            "cpuPercent": _docker_percent(payload.get("CPUPerc")),
            "memoryUsage": memory_usage,
            "memoryUsageBytes": memory_used,
            "memoryLimitBytes": memory_limit,
            "memoryPercent": _docker_percent(payload.get("MemPerc")),
            "networkIO": network_io,
            "networkRxBytes": network_rx,
            "networkTxBytes": network_tx,
            "blockIO": block_io,
            "blockReadBytes": block_read,
            "blockWriteBytes": block_write,
            "pids": pids,
        }
    if set(samples) != set(CORE_COMPOSE_SERVICES):
        raise ProbeError("container resource sampling did not cover all core services")
    return samples


def _container_summary(
    samples: list[dict[str, Any]],
    *,
    monitoring_errors: int,
    sampling_overruns: int,
) -> dict[str, Any]:
    container_samples = [sample for sample in samples if isinstance(sample.get("containers"), dict)]
    baseline_sample = next(
        (sample for sample in container_samples if sample.get("phase") == "baseline"),
        {},
    )
    final_sample = next(
        (sample for sample in reversed(container_samples) if sample.get("phase") == "cleanup"),
        {},
    )
    coverage = {
        service: sum(1 for sample in container_samples if service in sample.get("containers", {}))
        for service in CORE_COMPOSE_SERVICES
    }
    phase_coverage = {
        phase: sum(1 for sample in container_samples if sample.get("phase") == phase)
        for phase in CONTAINER_SAMPLE_PHASES
    }
    timing_complete = all(
        _is_finite_number(sample.get("sampleStartedElapsedSeconds"))
        and _is_finite_number(sample.get("sampleFinishedElapsedSeconds"))
        and _is_finite_number(sample.get("sampleDurationSeconds"))
        and float(sample["sampleStartedElapsedSeconds"]) >= 0
        and float(sample["sampleFinishedElapsedSeconds"])
        >= float(sample["sampleStartedElapsedSeconds"])
        and float(sample["sampleDurationSeconds"]) >= 0
        and abs(
            float(sample["sampleFinishedElapsedSeconds"])
            - float(sample["sampleStartedElapsedSeconds"])
            - float(sample["sampleDurationSeconds"])
        )
        <= DURATION_EVIDENCE_TOLERANCE_SECONDS
        for sample in container_samples
    )
    complete = bool(container_samples) and all(
        set(sample.get("containers", {})) == set(CORE_COMPOSE_SERVICES) for sample in container_samples
    ) and all(sample.get("phase") in CONTAINER_SAMPLE_PHASES for sample in container_samples) and timing_complete
    sample_starts = [float(sample["sampleStartedElapsedSeconds"]) for sample in container_samples if timing_complete]
    sample_gaps = [
        max(0.0, current - previous)
        for previous, current in zip(sample_starts, sample_starts[1:], strict=False)
    ]
    peaks: dict[str, dict[str, Any]] = {}
    for service in CORE_COMPOSE_SERVICES:
        service_samples = [
            sample["containers"][service]
            for sample in container_samples
            if service in sample.get("containers", {})
        ]
        peaks[service] = {
            "cpuPercent": max((float(sample["cpuPercent"]) for sample in service_samples), default=None),
            "memoryUsageBytes": max(
                (int(sample["memoryUsageBytes"]) for sample in service_samples),
                default=None,
            ),
            "memoryPercent": max(
                (float(sample["memoryPercent"]) for sample in service_samples),
                default=None,
            ),
            "networkRxBytes": max(
                (int(sample["networkRxBytes"]) for sample in service_samples),
                default=None,
            ),
            "networkTxBytes": max(
                (int(sample["networkTxBytes"]) for sample in service_samples),
                default=None,
            ),
            "blockReadBytes": max(
                (int(sample["blockReadBytes"]) for sample in service_samples),
                default=None,
            ),
            "blockWriteBytes": max(
                (int(sample["blockWriteBytes"]) for sample in service_samples),
                default=None,
            ),
            "pids": max((int(sample["pids"]) for sample in service_samples), default=None),
        }
    return {
        "requiredServices": list(CORE_COMPOSE_SERVICES),
        "requiredPhases": list(REQUIRED_CONTAINER_PHASES),
        "complete": complete,
        "monitoringErrors": monitoring_errors,
        "sampleCount": len(container_samples),
        "sampleCoverage": coverage,
        "phaseCoverage": phase_coverage,
        "maxSampleGapSeconds": round(max(sample_gaps), 3) if sample_gaps else 0.0,
        "samplingOverruns": sampling_overruns,
        "baseline": baseline_sample.get("containers", {}),
        "final": final_sample.get("containers", {}),
        "peak": peaks,
    }


def process_snapshot(pid: int | None) -> dict[str, Any]:
    if pid is None:
        return {}
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "rss=,pcpu="],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return {"pid": pid, "available": False}
    fields = result.stdout.split()
    snapshot: dict[str, Any] = {
        "pid": pid,
        "available": True,
        "rssMiB": round(float(fields[0]) / 1_024, 3),
        "cpuPercent": float(fields[1]),
    }
    proc_fd = Path(f"/proc/{pid}/fd")
    if proc_fd.is_dir():
        try:
            snapshot["fileDescriptors"] = sum(1 for _ in proc_fd.iterdir())
        except OSError:
            snapshot["fileDescriptors"] = None
    else:
        lsof = subprocess.run(
            ["lsof", "-n", "-P", "-p", str(pid)],
            check=False,
            capture_output=True,
            text=True,
        )
        snapshot["fileDescriptors"] = max(0, len(lsof.stdout.splitlines()) - 1) if lsof.returncode == 0 else None
    return snapshot


def _candidate_metadata(root: Path) -> dict[str, Any]:
    def git_output(*args: str) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=root,
            check=False,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip() if result.returncode == 0 else "unknown"

    diff = subprocess.run(
        ["git", "diff", "--binary"],
        cwd=root,
        check=False,
        capture_output=True,
    ).stdout
    status = git_output("status", "--porcelain")
    return {
        "head": git_output("rev-parse", "HEAD"),
        "tree": git_output("rev-parse", "HEAD^{tree}"),
        "branch": git_output("branch", "--show-current"),
        "dirty": bool(status),
        "workingDiffSha256": hashlib.sha256(diff).hexdigest(),
    }


def _fixture_headers(config: ProbeConfig, fixture: Fixture) -> dict[str, str]:
    return {
        "X-Public-Key": config.public_api_key,
        "X-Account-Token": fixture.session_token,
        "X-Server-Id": fixture.server_id,
    }


def _json_payload(response: Any, action: str) -> dict[str, Any]:
    try:
        payload = response.json()
    except Exception as exc:
        raise ProbeError(f"{action} returned invalid JSON") from exc
    if not isinstance(payload, dict):
        raise ProbeError(f"{action} returned an invalid payload shape")
    return payload


async def bootstrap_fixtures(client: Any, config: ProbeConfig) -> list[Fixture]:
    semaphore = asyncio.Semaphore(config.fixture_concurrency)

    async def bootstrap(user_index: int) -> Fixture:
        async with semaphore:
            response = await client.post(
                f"{config.target.api_base}/api/v1/auth/better-auth/bridge",
                headers={
                    "X-Public-Key": config.public_api_key,
                    "X-Auth-Bridge-Secret": config.auth_bridge_secret,
                },
                json={
                    "userId": f"capacity:{config.namespace}:{user_index}",
                    "email": f"capacity+{config.namespace}-{user_index}@example.test",
                    "name": f"Capacity {config.namespace} {user_index}",
                },
            )
            if not 200 <= response.status_code < 300:
                raise ProbeError(f"fixture bootstrap failed with HTTP {response.status_code}")
            payload = _json_payload(response, "fixture bootstrap")
            token = payload.get("sessionToken")
            server = payload.get("server")
            server_id = server.get("id") if isinstance(server, dict) else None
            if not isinstance(token, str) or not token or not isinstance(server_id, str) or not server_id:
                raise ProbeError("fixture bootstrap omitted session or Server identity")
            return Fixture(user_index=user_index, session_token=token, server_id=server_id)

    tasks = [asyncio.create_task(bootstrap(index)) for index in range(config.fixture_users)]
    fixtures: list[Fixture] = []
    try:
        for completed, task in enumerate(asyncio.as_completed(tasks), start=1):
            fixtures.append(await task)
            if completed % 50 == 0 or completed == config.fixture_users:
                print(f"CAPACITY phase=fixture users={completed}/{config.fixture_users}", flush=True)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return sorted(fixtures, key=lambda fixture: fixture.user_index)


async def create_active_channels(client: Any, config: ProbeConfig, fixtures: list[Fixture]) -> list[Fixture]:
    semaphore = asyncio.Semaphore(config.fixture_concurrency)
    safe_namespace = config.namespace.lower().replace("_", "-")[:18]

    async def create_channel(fixture: Fixture) -> Fixture:
        async with semaphore:
            response = await client.post(
                f"{config.target.api_base}/api/v1/channels",
                headers=_fixture_headers(config, fixture),
                json={
                    "name": f"capacity-{safe_namespace}-{fixture.user_index}",
                    "description": "local disposable capacity probe",
                },
            )
            if not 200 <= response.status_code < 300:
                raise ProbeError(f"active channel fixture failed with HTTP {response.status_code}")
            payload = _json_payload(response, "active channel fixture")
            channel = payload.get("channel")
            channel_name = channel.get("name") if isinstance(channel, dict) else None
            if not isinstance(channel_name, str) or not channel_name:
                raise ProbeError("active channel fixture omitted its canonical name")
            return replace(fixture, channel_name=channel_name)

    active_tasks = [asyncio.create_task(create_channel(fixture)) for fixture in fixtures[: config.active_users]]
    active_fixtures = await asyncio.gather(*active_tasks)
    return [*active_fixtures, *fixtures[config.active_users :]]


async def warm_fixtures(client: Any, config: ProbeConfig, fixtures: list[Fixture]) -> None:
    semaphore = asyncio.Semaphore(config.fixture_concurrency)

    async def warm(fixture: Fixture) -> None:
        if fixture.channel_name is None:
            return
        async with semaphore:
            path = quote(fixture.channel_name, safe="")
            response = await client.get(
                f"{config.target.api_base}/api/v1/channels/{path}/messages?limit=1",
                headers=_fixture_headers(config, fixture),
            )
            if response.status_code != 200:
                raise ProbeError(f"fixture warm-up failed with HTTP {response.status_code}")

    await asyncio.gather(*(warm(fixture) for fixture in fixtures[: config.active_users]))


async def _consume_sse(
    *,
    client: Any,
    config: ProbeConfig,
    fixture: Fixture,
    stats: StreamStats,
    ledger: EventLedger,
    stop_event: asyncio.Event,
    ready_future: asyncio.Future[bool],
) -> None:
    started_at = time.monotonic()
    became_ready = False
    stats.request_started()
    try:
        async with client.stream(
            "GET",
            f"{config.target.api_base}/api/v1/events/stream?heartbeatSeconds=2",
            headers={**_fixture_headers(config, fixture), "Accept": "text/event-stream"},
        ) as response:
            stats.setup_statuses[response.status_code] += 1
            if response.status_code != 200:
                stats.setup_errors[f"HTTP_{response.status_code}"] += 1
                return
            parser = SseFrameParser()
            async for line in response.aiter_lines():
                if line.startswith(":"):
                    stats.heartbeats += 1
                for frame in parser.feed_line(line):
                    if frame.event == "ready" and not became_ready:
                        became_ready = True
                        stats.stream_ready(latency_ms=(time.monotonic() - started_at) * 1_000)
                        if not ready_future.done():
                            ready_future.set_result(True)
                        continue
                    stats.event_frames += 1
                    if not isinstance(frame.data, dict):
                        stats.invalid_json_frames += 1
                        continue
                    payload = frame.data.get("payload")
                    trace_id = payload.get("traceId") if isinstance(payload, dict) else None
                    if isinstance(trace_id, str) and trace_id.startswith(f"capacity:{config.namespace}:"):
                        ledger.receive(trace_id, user_index=fixture.user_index, received_at=time.monotonic())
                if stop_event.is_set():
                    return
            if became_ready and not stop_event.is_set():
                stats.unexpected_closes += 1
    except asyncio.CancelledError:
        if became_ready and not stop_event.is_set():
            stats.unexpected_closes += 1
        raise
    except Exception as exc:
        stats.setup_errors[type(exc).__name__] += 1
        if became_ready and not stop_event.is_set():
            stats.unexpected_closes += 1
    finally:
        if became_ready:
            stats.stream_closed()
        if not ready_future.done():
            ready_future.set_result(False)


async def start_streams(
    *,
    client: Any,
    config: ProbeConfig,
    fixtures: list[Fixture],
    ramp_seconds: float,
    stats: StreamStats,
    ledger: EventLedger,
    stop_event: asyncio.Event,
) -> list[StreamHandle]:
    loop = asyncio.get_running_loop()
    handles: list[StreamHandle] = []
    divisor = max(1, len(fixtures) - 1)

    for position, fixture in enumerate(fixtures):
        ready = loop.create_future()
        delay = ramp_seconds * position / divisor

        async def delayed_consumer(
            *,
            delayed_fixture: Fixture = fixture,
            delayed_ready: asyncio.Future[bool] = ready,
            delayed_start: float = delay,
        ) -> None:
            if delayed_start:
                await asyncio.sleep(delayed_start)
            await _consume_sse(
                client=client,
                config=config,
                fixture=delayed_fixture,
                stats=stats,
                ledger=ledger,
                stop_event=stop_event,
                ready_future=delayed_ready,
            )

        handles.append(StreamHandle(task=asyncio.create_task(delayed_consumer()), ready=ready))

    _, pending = await asyncio.wait(
        [handle.ready for handle in handles],
        timeout=ramp_seconds + config.connect_timeout_seconds + TIMELINE_TOLERANCE_SECONDS,
    )
    if pending:
        stats.setup_errors["ReadyTimeout"] += len(pending)
        for handle in handles:
            if handle.ready in pending:
                handle.task.cancel()
        await asyncio.gather(*(handle.task for handle in handles if handle.ready in pending), return_exceptions=True)
    return handles


async def close_streams(handles: list[StreamHandle], stop_event: asyncio.Event) -> None:
    stop_event.set()
    for handle in handles:
        if not handle.task.done():
            handle.task.cancel()
    await asyncio.gather(*(handle.task for handle in handles), return_exceptions=True)


async def _wait_or_stop(stop_event: asyncio.Event, seconds: float) -> bool:
    if seconds <= 0:
        return stop_event.is_set()
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
        return True
    except TimeoutError:
        return False


async def active_user_loop(
    *,
    client: Any,
    config: ProbeConfig,
    fixture: Fixture,
    position: int,
    stop_event: asyncio.Event,
    reads: MetricRecorder,
    writes: MetricRecorder,
    ledger: EventLedger,
) -> int:
    if fixture.channel_name is None:
        writes.record_error("MissingChannelFixture")
        return 0
    initial_delay = config.active_cycle_seconds * position / max(1, config.active_users)
    if await _wait_or_stop(stop_event, initial_delay):
        return 0
    channel_path = quote(fixture.channel_name, safe="")
    sequence = 0
    while not stop_event.is_set():
        cycle_started = time.monotonic()
        read_started = time.monotonic()
        try:
            response = await client.get(
                f"{config.target.api_base}/api/v1/channels/{channel_path}/messages?limit=50",
                headers=_fixture_headers(config, fixture),
            )
            reads.record(status=response.status_code, latency_ms=(time.monotonic() - read_started) * 1_000)
        except Exception as exc:
            reads.record_error(type(exc).__name__)

        trace_id = f"capacity:{config.namespace}:{fixture.user_index}:{sequence}"
        write_started = time.monotonic()
        ledger.expect(trace_id, user_index=fixture.user_index, started_at=write_started)
        try:
            response = await client.post(
                f"{config.target.api_base}/api/v1/channels/{channel_path}/messages",
                headers={
                    **_fixture_headers(config, fixture),
                    "X-SmallKhoj-Trace-Id": trace_id,
                },
                json={"content": trace_id},
            )
            elapsed_ms = (time.monotonic() - write_started) * 1_000
            if 200 <= response.status_code < 300:
                payload = _json_payload(response, "active message write")
                if payload.get("traceId") != trace_id:
                    writes.record_error("TraceIdMismatch")
                else:
                    writes.record(status=response.status_code, latency_ms=elapsed_ms)
            else:
                ledger.discard(trace_id)
                writes.record(status=response.status_code, latency_ms=elapsed_ms)
        except Exception as exc:
            writes.record_error(type(exc).__name__)
        sequence += 1
        remaining = config.active_cycle_seconds - (time.monotonic() - cycle_started)
        if await _wait_or_stop(stop_event, max(0.0, remaining)):
            return sequence
    return sequence


async def monitor_loop(
    monitor: ResourceMonitor,
    phase: dict[str, str],
    stop_event: asyncio.Event,
    *,
    monotonic: Callable[[], float] = time.monotonic,
    wait_or_stop: Callable[[asyncio.Event, float], Awaitable[bool]] = _wait_or_stop,
) -> None:
    next_deadline = monotonic()
    interval = monitor.config.resource_sample_seconds
    while not stop_event.is_set():
        sample_started = monotonic()
        await monitor.sample(phase["name"])
        sample_finished = monotonic()
        if sample_finished - sample_started > interval:
            monitor.sampling_overruns += 1
        if stop_event.is_set():
            return
        next_deadline += interval
        delay = next_deadline - sample_finished
        if delay < 0:
            continue
        if await wait_or_stop(stop_event, delay):
            return


def _p95_exceeded(summary: Any, limit: float) -> bool:
    if not isinstance(summary, dict):
        return False
    value = summary.get("p95")
    return _is_finite_number(value) and float(value) > limit


def _formal_threshold_evidence_valid(
    evidence: Any,
    thresholds: Thresholds,
) -> bool:
    if not isinstance(evidence, dict) or set(evidence) != set(
        FORMAL_THRESHOLD_LIMITS
    ):
        return False
    p95_fields = (
        "sseReadyP95Ms",
        "readP95Ms",
        "writeP95Ms",
        "eventDeliveryP95Ms",
    )
    if any(
        not _is_finite_number(evidence.get(field))
        or float(evidence[field]) <= 0
        or float(evidence[field]) > float(FORMAL_THRESHOLD_LIMITS[field])
        for field in p95_fields
    ):
        return False
    headroom = evidence.get("postgresHeadroom")
    cleanup_delta = evidence.get("postgresCleanupDelta")
    if (
        not _is_strict_int(headroom)
        or headroom < FORMAL_THRESHOLD_LIMITS["postgresHeadroom"]
        or not _is_strict_int(cleanup_delta)
        or cleanup_delta < 0
        or cleanup_delta > FORMAL_THRESHOLD_LIMITS["postgresCleanupDelta"]
    ):
        return False
    evaluator_evidence = {
        "sseReadyP95Ms": thresholds.sse_ready_p95_ms,
        "readP95Ms": thresholds.read_p95_ms,
        "writeP95Ms": thresholds.write_p95_ms,
        "eventDeliveryP95Ms": thresholds.event_delivery_p95_ms,
        "postgresHeadroom": thresholds.postgres_headroom,
        "postgresCleanupDelta": thresholds.postgres_cleanup_delta,
    }
    return evidence == evaluator_evidence


def _target_resource_envelope_valid(envelope: Any) -> bool:
    if not isinstance(envelope, dict) or set(envelope) != set(
        FORMAL_TARGET_RESOURCE_ENVELOPE
    ):
        return False
    return (
        _is_strict_int(envelope.get("vcpus"))
        and envelope["vcpus"] == FORMAL_TARGET_RESOURCE_ENVELOPE["vcpus"]
        and _is_strict_int(envelope.get("guestMemoryBytes"))
        and envelope["guestMemoryBytes"]
        == FORMAL_TARGET_RESOURCE_ENVELOPE["guestMemoryBytes"]
        and _is_finite_number(envelope.get("maxAggregateCpuPercent"))
        and float(envelope["maxAggregateCpuPercent"])
        == FORMAL_TARGET_RESOURCE_ENVELOPE["maxAggregateCpuPercent"]
        and _is_strict_int(envelope.get("maxContainerMemoryBytes"))
        and envelope["maxContainerMemoryBytes"]
        == FORMAL_TARGET_RESOURCE_ENVELOPE["maxContainerMemoryBytes"]
    )


def _postgres_connection_budget_evidence_valid(config: dict[str, Any]) -> bool:
    budget = config.get("postgresConnectionBudget")
    if (
        not isinstance(budget, dict)
        or set(budget) != set(FORMAL_POSTGRES_CONNECTION_BUDGET)
        or any(not _is_strict_int(value) for value in budget.values())
    ):
        return False
    database_pool_size = budget["databasePoolSize"]
    database_max_overflow = budget["databaseMaxOverflow"]
    notify_publisher_pool_size = budget["notifyPublisherPoolSize"]
    notify_listener_per_backend_worker = budget[
        "notifyListenerPerBackendWorker"
    ]
    backend_workers = budget["backendWorkers"]
    backend_per_process = budget["backendPerProcess"]
    backend_total = budget["backendTotal"]
    better_auth_database_pool_size = budget["betterAuthDatabasePoolSize"]
    feishu_worker_reserve = budget["feishuWorkerReserve"]
    headroom = budget["headroom"]
    required = budget["required"]
    expected_backend_workers = config.get("expectedBackendWorkers")
    expected_notify_publisher_pool_size = config.get(
        "expectedNotifyPublisherPoolSize"
    )
    expected_postgres_max_connections = config.get(
        "expectedPostgresMaxConnections"
    )
    return (
        database_pool_size > 0
        and database_max_overflow >= 0
        and notify_publisher_pool_size > 0
        and notify_listener_per_backend_worker
        == NOTIFY_LISTENER_CONNECTIONS_PER_BACKEND_WORKER
        and backend_workers > 0
        and better_auth_database_pool_size > 0
        and headroom > 0
        and _is_strict_int(expected_backend_workers)
        and expected_backend_workers == backend_workers
        and _is_strict_int(expected_notify_publisher_pool_size)
        and expected_notify_publisher_pool_size == notify_publisher_pool_size
        and _is_strict_int(expected_postgres_max_connections)
        and expected_postgres_max_connections > 0
        and backend_per_process
        == database_pool_size
        + database_max_overflow
        + notify_publisher_pool_size
        + notify_listener_per_backend_worker
        and backend_total == backend_per_process * backend_workers
        and feishu_worker_reserve
        == database_pool_size + database_max_overflow
        and required
        == backend_total
        + better_auth_database_pool_size
        + feishu_worker_reserve
        + headroom
        and required <= expected_postgres_max_connections
    )


def _formal_profile_evidence_valid(
    config: dict[str, Any],
    thresholds: Thresholds,
) -> bool:
    integer_minimums = (
        (config.get("steadySse"), FORMAL_MIN_STEADY_SSE),
        (config.get("spikeTotalSse"), FORMAL_MIN_PEAK_SSE),
        (config.get("activeUsers"), FORMAL_MIN_ACTIVE_USERS),
    )
    if any(
        not _is_strict_int(value) or value < minimum
        for value, minimum in integer_minimums
    ):
        return False
    if not (
        config["steadySse"] < config["spikeTotalSse"]
        and config["activeUsers"] <= config["steadySse"]
    ):
        return False
    bounded_numbers = (
        (
            config.get("activeCycleSeconds"),
            0.0,
            FORMAL_MAX_ACTIVE_CYCLE_SECONDS,
        ),
        (config.get("rampSeconds"), 0.0, FORMAL_MAX_RAMP_SECONDS),
        (
            config.get("spikeRampSeconds"),
            0.0,
            FORMAL_MAX_SPIKE_RAMP_SECONDS,
        ),
        (
            config.get("resourceSampleSeconds"),
            0.0,
            FORMAL_MAX_RESOURCE_SAMPLE_SECONDS,
        ),
    )
    if any(
        not _is_finite_number(value)
        or float(value) <= lower
        or float(value) > upper
        for value, lower, upper in bounded_numbers
    ):
        return False
    minimum_numbers = (
        (config.get("durationSeconds"), FORMAL_MIN_DURATION_SECONDS),
        (config.get("spikeAtSeconds"), FORMAL_MIN_SPIKE_AT_SECONDS),
        (config.get("spikeDurationSeconds"), FORMAL_MIN_SPIKE_DURATION_SECONDS),
        (config.get("cleanupTimeoutSeconds"), FORMAL_MIN_CLEANUP_SECONDS),
    )
    if any(
        not _is_finite_number(value) or float(value) < minimum
        for value, minimum in minimum_numbers
    ):
        return False
    return (
        config.get("profileId") == FORMAL_PROFILE_ID
        and _is_strict_int(config.get("expectedPostgresMaxConnections"))
        and config["expectedPostgresMaxConnections"]
        == FORMAL_POSTGRES_MAX_CONNECTIONS
        and _is_strict_int(config.get("expectedBackendWorkers"))
        and config["expectedBackendWorkers"] == FORMAL_BACKEND_WORKERS
        and _is_strict_int(config.get("expectedNotifyPublisherPoolSize"))
        and config["expectedNotifyPublisherPoolSize"]
        == FORMAL_NOTIFY_PUBLISHER_POOL_SIZE
        and _postgres_connection_budget_evidence_valid(config)
        and config["postgresConnectionBudget"]
        == FORMAL_POSTGRES_CONNECTION_BUDGET
        and _formal_threshold_evidence_valid(config.get("thresholds"), thresholds)
        and _target_resource_envelope_valid(config.get("targetResourceEnvelope"))
    )


def _local_evidence_boundary_valid(
    report: dict[str, Any],
    metadata: dict[str, Any],
    config: dict[str, Any],
) -> bool:
    namespace = metadata.get("namespace")
    api_base = config.get("apiBase")
    database_name = config.get("databaseName")
    steady_sse = config.get("steadySse")
    active_users = config.get("activeUsers")
    duration_seconds = config.get("durationSeconds")
    if not (
        metadata.get("mode") == "local-only"
        and isinstance(namespace, str)
        and re.fullmatch(r"[A-Za-z0-9_-]{1,32}", namespace) is not None
        and isinstance(api_base, str)
        and _is_loopback(urlparse(api_base).hostname)
        and config.get("databaseScope") == "disposable"
        and isinstance(database_name, str)
        and any(
            token in database_name.lower()
            for token in DISPOSABLE_DATABASE_TOKENS
        )
        and isinstance(config.get("composeProject"), str)
        and COMPOSE_PROJECT_PATTERN.fullmatch(config["composeProject"]) is not None
        and config.get("requiredContainerServices")
        == list(CORE_COMPOSE_SERVICES)
        and _is_strict_int(steady_sse)
        and _is_strict_int(active_users)
        and _is_finite_number(duration_seconds)
    ):
        return False
    return report.get("limitations") == _capacity_limitations(
        steady_sse=steady_sse,
        active_users=active_users,
        duration_seconds=float(duration_seconds),
    )


def _target_resource_envelope_exceeded(
    samples: list[dict[str, Any]],
    envelope: dict[str, Any],
) -> bool:
    memory_limit = int(envelope["maxContainerMemoryBytes"])
    cpu_limit = float(envelope["maxAggregateCpuPercent"])
    for sample in samples:
        containers = sample["containers"]
        aggregate_memory = sum(
            int(containers[service]["memoryUsageBytes"])
            for service in CORE_COMPOSE_SERVICES
        )
        aggregate_cpu = sum(
            float(containers[service]["cpuPercent"])
            for service in CORE_COMPOSE_SERVICES
        )
        if aggregate_memory > memory_limit or aggregate_cpu > cpu_limit:
            return True
    return False


def capacity_failures(report: Any, thresholds: Thresholds) -> list[str]:
    if not isinstance(report, dict):
        return ["REPORT_EVIDENCE_INVALID"]
    failures: list[str] = []
    if (
        not _is_strict_int(report.get("schemaVersion"))
        or report["schemaVersion"] != REPORT_SCHEMA_VERSION
    ):
        failures.append("REPORT_SCHEMA_UNSUPPORTED")

    metadata = report.get("metadata")
    metadata = metadata if isinstance(metadata, dict) else {}
    candidate = metadata.get("candidate")
    candidate_finished = metadata.get("candidateFinished")
    candidate_evidence_valid = (
        isinstance(candidate, dict)
        and isinstance(candidate_finished, dict)
        and _candidate_provenance_valid(candidate)
        and _candidate_provenance_valid(candidate_finished)
    )
    if not isinstance(candidate, dict) or not isinstance(candidate_finished, dict):
        failures.append("CANDIDATE_PROVENANCE_MISSING")
    elif not candidate_evidence_valid:
        failures.append("CANDIDATE_PROVENANCE_INVALID")
    else:
        if candidate != candidate_finished:
            failures.append("CANDIDATE_CHANGED_DURING_RUN")
        if candidate["dirty"] is True or candidate_finished["dirty"] is True:
            failures.append("CANDIDATE_DIRTY")

    container_image_revisions = report.get("containerImageRevisions")
    if candidate_evidence_valid and (
        not isinstance(container_image_revisions, dict)
        or set(container_image_revisions) != set(CANDIDATE_IMAGE_SERVICES)
        or any(
            not isinstance(container_image_revisions.get(service), str)
            or container_image_revisions[service].lower() != candidate["head"].lower()
            for service in CANDIDATE_IMAGE_SERVICES
        )
    ):
        failures.append("CONTAINER_IMAGE_REVISION_MISMATCH")

    config = report.get("config")
    config = config if isinstance(config, dict) else {}
    profile_id = config.get("profileId")
    if profile_id == SMOKE_PROFILE_ID:
        failures.append("NON_FORMAL_CAPACITY_PROFILE")
    elif not _formal_profile_evidence_valid(config, thresholds):
        failures.append("FORMAL_CAPACITY_PROFILE_INVALID")
    if not _local_evidence_boundary_valid(report, metadata, config):
        failures.append("LOCAL_EVIDENCE_BOUNDARY_INVALID")
    request_timeout_seconds = config.get("requestTimeoutSeconds")
    if not _is_finite_number(request_timeout_seconds) or request_timeout_seconds <= 0:
        failures.append("REQUEST_TIMEOUT_EVIDENCE_MISSING")
    resource_sample_seconds = config.get("resourceSampleSeconds")
    resource_sample_config_valid = (
        _is_finite_number(resource_sample_seconds) and resource_sample_seconds > 0
    )
    if not resource_sample_config_valid:
        failures.append("RESOURCE_SAMPLE_CONFIG_INVALID")

    expected_backend_workers = config.get("expectedBackendWorkers")
    expected_notify_publisher_pool_size = config.get(
        "expectedNotifyPublisherPoolSize"
    )
    backend_runtime_value = report.get("backendRuntime")
    backend_runtime = (
        backend_runtime_value if isinstance(backend_runtime_value, dict) else {}
    )
    observed_backend_workers = backend_runtime.get("workers")
    observed_notify_publisher_pool_size = backend_runtime.get(
        "notifyPublisherPoolSize"
    )
    backend_runtime_evidence_valid = (
        _is_strict_int(expected_backend_workers)
        and expected_backend_workers > 0
        and _is_strict_int(expected_notify_publisher_pool_size)
        and expected_notify_publisher_pool_size > 0
        and _is_strict_int(observed_backend_workers)
        and observed_backend_workers == expected_backend_workers
        and _is_strict_int(observed_notify_publisher_pool_size)
        and observed_notify_publisher_pool_size
        == expected_notify_publisher_pool_size
    )
    if not backend_runtime_evidence_valid:
        failures.append("BACKEND_RUNTIME_EVIDENCE_INVALID")

    postgres_connection_budget_valid = (
        _postgres_connection_budget_evidence_valid(config)
    )
    postgres_connection_budget = config.get("postgresConnectionBudget")
    postgres_connection_budget = (
        postgres_connection_budget
        if isinstance(postgres_connection_budget, dict)
        else {}
    )
    expected_backend_runtime = {
        "workers": postgres_connection_budget.get("backendWorkers"),
        "databasePoolSize": postgres_connection_budget.get("databasePoolSize"),
        "databaseMaxOverflow": postgres_connection_budget.get(
            "databaseMaxOverflow"
        ),
        "notifyPublisherPoolSize": postgres_connection_budget.get(
            "notifyPublisherPoolSize"
        ),
        "betterAuthDatabasePoolSize": postgres_connection_budget.get(
            "betterAuthDatabasePoolSize"
        ),
        "postgresMaxConnections": config.get("expectedPostgresMaxConnections"),
        "postgresConnectionHeadroom": postgres_connection_budget.get("headroom"),
    }
    frontend_runtime_value = report.get("frontendRuntime")
    frontend_runtime = (
        frontend_runtime_value if isinstance(frontend_runtime_value, dict) else {}
    )
    expected_frontend_runtime = {
        "betterAuthDatabasePoolSize": postgres_connection_budget.get(
            "betterAuthDatabasePoolSize"
        )
    }
    if not (
        postgres_connection_budget_valid
        and backend_runtime == expected_backend_runtime
        and frontend_runtime == expected_frontend_runtime
    ):
        failures.append("POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID")

    optional_service_runtime = report.get("optionalServiceRuntime")
    deployment_shape_evidence_valid = (
        isinstance(optional_service_runtime, dict)
        and set(optional_service_runtime) == {"feishuWorkerContainers"}
        and _is_strict_int(optional_service_runtime.get("feishuWorkerContainers"))
        and optional_service_runtime["feishuWorkerContainers"] == 0
    )
    if not deployment_shape_evidence_valid:
        failures.append("DEPLOYMENT_SHAPE_EVIDENCE_INVALID")

    expected_steady = config.get("steadySse")
    expected_peak = config.get("spikeTotalSse")
    expected_active_users = config.get("activeUsers")
    peak_profile_valid = _is_strict_int(expected_peak) and expected_peak > 0
    active_profile_valid = _is_strict_int(expected_active_users) and expected_active_users > 0
    steady_profile_valid = (
        _is_strict_int(expected_steady)
        and expected_steady > 0
        and peak_profile_valid
        and expected_steady < expected_peak
        and active_profile_valid
        and expected_active_users <= expected_steady
    )
    steady_ramp_seconds = config.get("rampSeconds")
    steady_ramp_config_valid = (
        _is_finite_number(steady_ramp_seconds) and steady_ramp_seconds >= 0
    )
    fixture = report.get("fixture")
    if (
        not isinstance(fixture, dict)
        or not peak_profile_valid
        or not active_profile_valid
        or not _is_strict_int(fixture.get("users"))
        or fixture["users"] != expected_peak
        or not _is_strict_int(fixture.get("activeChannels"))
        or fixture["activeChannels"] != expected_active_users
    ):
        failures.append("FIXTURE_EVIDENCE_INVALID")

    streams = report.get("streams")
    streams = streams if isinstance(streams, dict) else {}
    requested_streams = streams.get("requested")
    ready_streams = streams.get("ready")
    steady_ready_streams = streams.get("steadyReady")
    if (
        not steady_profile_valid
        or not steady_ramp_config_valid
        or not _is_strict_int(steady_ready_streams)
        or steady_ready_streams != expected_steady
    ):
        failures.append("STEADY_PROFILE_EVIDENCE_INVALID")
    if (
        not peak_profile_valid
        or not _is_strict_int(requested_streams)
        or requested_streams != expected_peak
    ):
        failures.append("SSE_REQUEST_COUNT_MISMATCH")
    if (
        not _is_strict_int(ready_streams)
        or not _is_strict_int(requested_streams)
        or ready_streams != requested_streams
    ):
        failures.append("SSE_NOT_ALL_READY")
    if (
        not peak_profile_valid
        or not _is_strict_int(streams.get("peakConcurrentReady"))
        or streams.get("peakConcurrentReady") != expected_peak
    ):
        failures.append("SSE_PEAK_NOT_REACHED")
    if not _is_zero_count(streams.get("setupErrors")):
        failures.append("SSE_SETUP_ERROR")
    if not _is_zero_count(streams.get("unexpectedCloses")):
        failures.append("SSE_UNEXPECTED_CLOSE")
    if not _is_zero_count(streams.get("invalidJsonFrames")):
        failures.append("SSE_INVALID_FRAME")
    if _p95_exceeded(streams.get("readyLatencyMs", {}), thresholds.sse_ready_p95_ms):
        failures.append("SSE_READY_P95_EXCEEDED")

    http = report.get("http")
    http = http if isinstance(http, dict) else {}
    http_metrics: dict[str, dict[str, Any]] = {}
    for operation, limit in (("read", thresholds.read_p95_ms), ("write", thresholds.write_p95_ms)):
        metric = http.get(operation)
        metric = metric if isinstance(metric, dict) else {}
        http_metrics[operation] = metric
        prefix = f"HTTP_{operation.upper()}"
        if not _is_zero_count(metric.get("errors")):
            failures.append(f"{prefix}_ERROR")
        if not _is_zero_count(metric.get("non2xx")):
            failures.append(f"{prefix}_NON_2XX")
        if _p95_exceeded(metric.get("latencyMs", {}), limit):
            failures.append(f"{prefix}_P95_EXCEEDED")

    events = report.get("events")
    events = events if isinstance(events, dict) else {}
    if not _is_zero_count(events.get("missing")):
        failures.append("EVENT_MISSING")
    if not _is_zero_count(events.get("duplicates")):
        failures.append("EVENT_DUPLICATE")
    if not _is_zero_count(events.get("wrongScope")):
        failures.append("EVENT_WRONG_SCOPE")
    if not _is_zero_count(events.get("unexpected")):
        failures.append("EVENT_UNEXPECTED")
    if _p95_exceeded(events.get("deliveryLatencyMs", {}), thresholds.event_delivery_p95_ms):
        failures.append("EVENT_DELIVERY_P95_EXCEEDED")

    read_latency_count = _http_latency_expected_count(http_metrics["read"])
    write_latency_count = _http_latency_expected_count(http_metrics["write"])
    if not all(
        (
            _latency_evidence_valid(
                streams.get("readyLatencyMs"),
                expected_count=ready_streams,
            ),
            _latency_evidence_valid(
                http_metrics["read"].get("latencyMs"),
                expected_count=read_latency_count,
            ),
            _latency_evidence_valid(
                http_metrics["write"].get("latencyMs"),
                expected_count=write_latency_count,
            ),
            _latency_evidence_valid(
                events.get("deliveryLatencyMs"),
                expected_count=events.get("received"),
            ),
        )
    ):
        failures.append("LATENCY_EVIDENCE_INCOMPLETE")

    workload = report.get("workload")
    if not isinstance(workload, dict):
        failures.append("ACTIVE_LOAD_EVIDENCE_MISSING")
    else:
        active_users = config.get("activeUsers")
        duration_seconds = config.get("durationSeconds")
        active_cycle_seconds = config.get("activeCycleSeconds")
        formula_valid = (
            _is_strict_int(active_users)
            and active_users > 0
            and _is_finite_number(duration_seconds)
            and float(duration_seconds) > 0
            and _is_finite_number(active_cycle_seconds)
            and float(active_cycle_seconds) > 0
        )
        expected_target = (
            math.floor(float(duration_seconds) / float(active_cycle_seconds))
            if formula_valid
            else None
        )
        expected_minimum = max(1, expected_target - 1) if expected_target is not None else None
        per_user_valid = formula_valid and workload.get("users") == active_users
        per_user_cycles = workload.get("perUserCycles")
        cycle_counts: list[int] = []
        user_indices: list[int] = []
        if not isinstance(per_user_cycles, list) or not formula_valid or len(per_user_cycles) != active_users:
            per_user_valid = False
        else:
            for entry in per_user_cycles:
                if not isinstance(entry, dict):
                    per_user_valid = False
                    continue
                user_index = entry.get("userIndex")
                cycles = entry.get("cycles")
                if not _is_strict_int(user_index) or not _is_strict_int(cycles) or cycles < 0:
                    per_user_valid = False
                    continue
                user_indices.append(user_index)
                cycle_counts.append(cycles)
            if user_indices != list(range(active_users)):
                per_user_valid = False

        minimum_cycles = workload.get("minimumCyclesPerUser")
        completed_minimum = workload.get("minCompletedCyclesPerUser")
        if (
            not _is_strict_int(minimum_cycles)
            or not _is_strict_int(completed_minimum)
            or completed_minimum < minimum_cycles
        ):
            failures.append("ACTIVE_LOAD_INSUFFICIENT")
        if expected_minimum is not None and cycle_counts and min(cycle_counts) < expected_minimum:
            failures.append("ACTIVE_LOAD_INSUFFICIENT")

        if (
            expected_target is None
            or expected_minimum is None
            or workload.get("targetCyclesPerUser") != expected_target
            or minimum_cycles != expected_minimum
        ):
            per_user_valid = False
        if cycle_counts:
            if (
                min(cycle_counts) != workload.get("minCompletedCyclesPerUser")
                or max(cycle_counts) != workload.get("maxCompletedCyclesPerUser")
                or sum(cycle_counts) != workload.get("totalCycles")
                or any(cycles < expected_minimum for cycles in cycle_counts)
            ):
                per_user_valid = False
        else:
            per_user_valid = False
        if not per_user_valid:
            failures.append("ACTIVE_USER_CYCLE_EVIDENCE_INVALID")

        if not _is_zero_count(workload.get("activeTaskErrors")):
            failures.append("ACTIVE_TASK_ERROR")
        total_cycles = workload.get("totalCycles")
        total_reads = workload.get("totalReads")
        total_writes = workload.get("totalWrites")
        read_metric = http.get("read")
        read_metric = read_metric if isinstance(read_metric, dict) else {}
        write_metric = http.get("write")
        write_metric = write_metric if isinstance(write_metric, dict) else {}
        http_reads = read_metric.get("requests")
        http_writes = write_metric.get("requests")
        if not (
            _is_strict_int(total_cycles)
            and total_cycles > 0
            and _is_strict_int(total_reads)
            and _is_strict_int(total_writes)
            and _is_strict_int(http_reads)
            and _is_strict_int(http_writes)
            and total_reads == total_cycles
            and total_writes == total_cycles
            and http_reads == total_cycles
            and http_writes == total_cycles
        ):
            failures.append("ACTIVE_LOAD_COUNT_MISMATCH")
        if events.get("expected") != total_writes or events.get("received") != total_writes:
            failures.append("ACTIVE_EVENT_COUNT_MISMATCH")

    postgres = report.get("postgres")
    postgres = postgres if isinstance(postgres, dict) else {}
    expected_postgres = config.get("expectedPostgresMaxConnections")
    if not _is_strict_int(expected_postgres):
        failures.append("POSTGRES_EXPECTATION_MISSING")
    elif postgres.get("maxConnections") != expected_postgres:
        failures.append("POSTGRES_MAX_CONNECTIONS_UNEXPECTED")
    max_connections = postgres.get("maxConnections")
    peak_connections = postgres.get("peakConnections")
    if (
        _is_strict_int(max_connections)
        and _is_strict_int(peak_connections)
        and peak_connections > max_connections - thresholds.postgres_headroom
    ):
        failures.append("POSTGRES_HEADROOM_EXHAUSTED")
    baseline_connections = postgres.get("baselineConnections")
    cleanup_connections = postgres.get("cleanupConnections")
    if (
        _is_strict_int(baseline_connections)
        and _is_strict_int(cleanup_connections)
        and cleanup_connections > baseline_connections + thresholds.postgres_cleanup_delta
    ):
        failures.append("POSTGRES_CLEANUP_NOT_RECOVERED")
    if backend_runtime_evidence_valid:
        peak_notify_listeners = postgres.get("peakNotifyListeners")
        peak_notify_publishers = postgres.get("peakNotifyPublishers")
        if (
            not _is_strict_int(peak_notify_listeners)
            or peak_notify_listeners != expected_backend_workers
        ):
            failures.append("POSTGRES_NOTIFY_LISTENER_OWNERS_UNEXPECTED")
        if (
            not _is_strict_int(peak_notify_publishers)
            or peak_notify_publishers
            > expected_backend_workers * expected_notify_publisher_pool_size
        ):
            failures.append("POSTGRES_NOTIFY_PUBLISHER_BUDGET_EXCEEDED")
    database_deltas = report.get("databaseCounterDeltas")
    if not isinstance(database_deltas, dict):
        failures.append("DATABASE_COUNTER_EVIDENCE_MISSING")
    elif any(
        key not in database_deltas
        or not _is_strict_int(database_deltas[key])
        or database_deltas[key] < 0
        for key in DATABASE_COUNTER_FIELDS
    ):
        failures.append("DATABASE_COUNTER_EVIDENCE_INCOMPLETE")
    elif database_deltas["deadlocks"] > 0:
        failures.append("DATABASE_DEADLOCK")

    timeline = report.get("timeline")
    timeline = timeline if isinstance(timeline, dict) else {}
    cleanup = report.get("cleanup")
    cleanup = cleanup if isinstance(cleanup, dict) else {}
    if not _is_zero_count(cleanup.get("clientTasks")):
        failures.append("CLIENT_TASK_CLEANUP_FAILED")
    if not _is_zero_count(cleanup.get("currentReadyStreams")):
        failures.append("CLIENT_STREAM_CLEANUP_FAILED")
    cleanup_required = config.get("cleanupTimeoutSeconds")
    cleanup_observed = cleanup.get("observedSeconds")
    if (
        not _is_finite_number(cleanup_required)
        or not _is_finite_number(cleanup_observed)
        or cleanup_observed + 0.05 < cleanup_required
    ):
        failures.append("CLEANUP_OBSERVATION_INSUFFICIENT")
    recovered_at = cleanup.get("recoveredAtSeconds")
    final_connections = cleanup.get("finalConnections")
    timeline_cleanup_observed = timeline.get("cleanupObservedSeconds")
    if (
        not _is_finite_number(recovered_at)
        or recovered_at < 0
        or not _is_finite_number(cleanup_observed)
        or recovered_at > cleanup_observed + DURATION_EVIDENCE_TOLERANCE_SECONDS
        or not _is_finite_number(timeline_cleanup_observed)
        or recovered_at > timeline_cleanup_observed + DURATION_EVIDENCE_TOLERANCE_SECONDS
        or not _is_strict_int(final_connections)
        or not _is_strict_int(cleanup_connections)
        or final_connections != cleanup_connections
    ):
        failures.append("CLEANUP_NOT_RECOVERED")

    workload_required = config.get("durationSeconds")
    workload_observed = timeline.get("workloadObservedSeconds")
    if (
        not _is_finite_number(workload_required)
        or not _is_finite_number(workload_observed)
        or workload_observed + 0.05 < workload_required
    ):
        failures.append("WORKLOAD_DURATION_INSUFFICIENT")
    spike_required = config.get("spikeDurationSeconds")
    spike_observed = timeline.get("spikePeakHoldSeconds")
    if (
        not _is_finite_number(spike_required)
        or not _is_finite_number(spike_observed)
        or spike_observed + 0.05 < spike_required
    ):
        failures.append("SPIKE_HOLD_INSUFFICIENT")

    anchor_values: list[float] = []
    anchors_valid = True
    for field in TIMELINE_ANCHOR_FIELDS:
        value = timeline.get(field)
        if not _is_finite_number(value) or value < 0:
            anchors_valid = False
            break
        anchor_values.append(float(value))
    if not anchors_valid:
        failures.append("TIMELINE_EVIDENCE_INCOMPLETE")
    else:
        if any(current < previous for previous, current in zip(anchor_values, anchor_values[1:], strict=False)):
            failures.append("TIMELINE_ORDER_INVALID")
        connect_timeout = config.get("connectTimeoutSeconds")
        if (
            steady_profile_valid
            and steady_ramp_config_valid
            and _is_finite_number(connect_timeout)
            and connect_timeout >= 0
        ):
            steady_ramp_started = float(timeline["steadyRampStartedAtSeconds"])
            steady_ready_at = float(timeline["steadyReadyAtSeconds"])
            steady_ramp_observed = steady_ready_at - steady_ramp_started
            minimum_start_spread = (
                float(steady_ramp_seconds)
                * (int(expected_steady) - 1)
                / int(expected_steady)
            )
            if (
                steady_ramp_observed + TIMELINE_TOLERANCE_SECONDS < minimum_start_spread
                or steady_ramp_observed
                > float(steady_ramp_seconds)
                + float(connect_timeout)
                + TIMELINE_TOLERANCE_SECONDS
            ):
                failures.append("STEADY_RAMP_TIMELINE_INVALID")
        spike_at = config.get("spikeAtSeconds")
        spike_ramp = config.get("spikeRampSeconds")
        if not all(_is_finite_number(value) and value >= 0 for value in (spike_at, spike_ramp, connect_timeout)):
            failures.append("TIMELINE_EVIDENCE_INCOMPLETE")
        else:
            workload_started = float(timeline["workloadStartedAtSeconds"])
            spike_ramp_started = float(timeline["spikeRampStartedAtSeconds"])
            spike_peak_ready = float(timeline["spikePeakReadyAtSeconds"])
            spike_offset = spike_ramp_started - workload_started
            ramp_elapsed = spike_peak_ready - spike_ramp_started
            if (
                abs(spike_offset - float(spike_at)) > TIMELINE_TOLERANCE_SECONDS
                or ramp_elapsed + DURATION_EVIDENCE_TOLERANCE_SECONDS < float(spike_ramp)
                or ramp_elapsed
                > float(spike_ramp) + float(connect_timeout) + TIMELINE_TOLERANCE_SECONDS
            ):
                failures.append("SPIKE_TIMELINE_INVALID")

        derived_intervals = (
            (
                workload_observed,
                float(timeline["workloadEndedAtSeconds"])
                - float(timeline["workloadStartedAtSeconds"]),
            ),
            (
                spike_observed,
                float(timeline["spikePeakEndedAtSeconds"])
                - float(timeline["spikePeakReadyAtSeconds"]),
            ),
            (
                timeline.get("cleanupObservedSeconds"),
                float(timeline["cleanupEndedAtSeconds"])
                - float(timeline["cleanupStartedAtSeconds"]),
            ),
        )
        if any(
            not _is_finite_number(observed)
            or abs(float(observed) - expected) > DURATION_EVIDENCE_TOLERANCE_SECONDS
            for observed, expected in derived_intervals
        ):
            failures.append("TIMELINE_EVIDENCE_INCOMPLETE")
        if (
            not _is_finite_number(cleanup_observed)
            or not _is_finite_number(timeline_cleanup_observed)
            or abs(float(cleanup_observed) - float(timeline_cleanup_observed))
            > DURATION_EVIDENCE_TOLERANCE_SECONDS
        ):
            failures.append("TIMELINE_EVIDENCE_INCOMPLETE")

    missing_resource_samples = object()
    raw_resource_samples = report.get("resourceSamples", missing_resource_samples)
    resource_samples_valid = False
    if raw_resource_samples is missing_resource_samples or raw_resource_samples == []:
        failures.append("RESOURCE_SAMPLE_EVIDENCE_MISSING")
    elif not isinstance(raw_resource_samples, list) or not _resource_sample_evidence_valid(
        raw_resource_samples
    ):
        failures.append("RESOURCE_SAMPLE_EVIDENCE_INVALID")
    else:
        resource_samples_valid = True
        failures.extend(_resource_container_state_failures(raw_resource_samples))
        if backend_runtime_evidence_valid and any(
            sample["postgres"]["notify_listeners"]
            != expected_backend_workers
            for sample in raw_resource_samples
        ):
            failures.append("POSTGRES_NOTIFY_LISTENER_OWNERS_UNEXPECTED")
        target_envelope = config.get("targetResourceEnvelope")
        if _target_resource_envelope_valid(
            target_envelope
        ) and _target_resource_envelope_exceeded(
            raw_resource_samples,
            target_envelope,
        ):
            failures.append("TARGET_RESOURCE_ENVELOPE_EXCEEDED")
        if raw_resource_samples[0]["database"]["deadlocks"] > 0:
            failures.append("DATABASE_DEADLOCK")
        if (
            anchors_valid
            and resource_sample_config_valid
            and not _resource_sample_timeline_valid(
                raw_resource_samples,
                timeline,
                resource_sample_seconds=float(resource_sample_seconds),
            )
        ):
            failures.append("RESOURCE_SAMPLE_TIMELINE_INVALID")

    containers_value = report.get("containers")
    containers = containers_value if isinstance(containers_value, dict) else {}
    if resource_samples_valid:
        try:
            postgres_max = postgres.get("maxConnections")
            container_monitoring_errors = containers.get("monitoringErrors")
            container_sampling_overruns = containers.get("samplingOverruns")
            if not _is_strict_int(postgres_max) or postgres_max <= 0:
                raise ValueError("invalid PostgreSQL maxConnections evidence")
            if (
                not _is_strict_int(container_monitoring_errors)
                or container_monitoring_errors < 0
                or not _is_strict_int(container_sampling_overruns)
                or container_sampling_overruns < 0
            ):
                raise ValueError("invalid container monitoring counters")
            expected_database_deltas = _database_counter_deltas(raw_resource_samples)
            expected_postgres_summary = _postgres_summary(
                raw_resource_samples,
                max_connections=postgres_max,
            )
            expected_container_summary = _container_summary(
                raw_resource_samples,
                monitoring_errors=container_monitoring_errors,
                sampling_overruns=container_sampling_overruns,
            )
        except Exception:
            failures.append("RESOURCE_SAMPLE_EVIDENCE_INVALID")
        else:
            if database_deltas != expected_database_deltas:
                failures.append("DATABASE_COUNTER_SUMMARY_MISMATCH")
            if postgres != expected_postgres_summary:
                failures.append("POSTGRES_SUMMARY_MISMATCH")
            if containers != expected_container_summary:
                failures.append("CONTAINER_SUMMARY_MISMATCH")

    if not isinstance(containers_value, dict):
        failures.append("CONTAINER_EVIDENCE_MISSING")
    else:
        if containers.get("requiredServices") != list(CORE_COMPOSE_SERVICES) or not containers.get("complete"):
            failures.append("CONTAINER_MONITORING_INCOMPLETE")
        if not _is_zero_count(containers.get("monitoringErrors")):
            failures.append("CONTAINER_MONITORING_FAILED")
        sample_count = containers.get("sampleCount")
        coverage = containers.get("sampleCoverage")
        coverage = coverage if isinstance(coverage, dict) else {}
        if (
            not _is_strict_int(sample_count)
            or sample_count <= 0
            or any(
                not _is_strict_int(coverage.get(service)) or coverage.get(service) != sample_count
                for service in CORE_COMPOSE_SERVICES
            )
            or not _is_finite_number(containers.get("maxSampleGapSeconds"))
            or containers.get("maxSampleGapSeconds") < 0
            or not _is_strict_int(containers.get("samplingOverruns"))
            or containers.get("samplingOverruns") < 0
        ):
            failures.append("CONTAINER_MONITORING_INCOMPLETE")
        max_sample_gap = containers.get("maxSampleGapSeconds")
        if (
            resource_sample_config_valid
            and _is_finite_number(max_sample_gap)
            and max_sample_gap
            > _max_resource_sample_gap(float(resource_sample_seconds))
        ):
            failures.append("CONTAINER_SAMPLING_GAP_EXCEEDED")

        phase_coverage = containers.get("phaseCoverage")
        phase_coverage = phase_coverage if isinstance(phase_coverage, dict) else {}
        phase_counts_valid = all(
            _is_strict_int(phase_coverage.get(phase)) and phase_coverage[phase] >= 0
            for phase in CONTAINER_SAMPLE_PHASES
        )
        if (
            containers.get("requiredPhases") != list(REQUIRED_CONTAINER_PHASES)
            or not phase_counts_valid
            or not _is_strict_int(sample_count)
            or sum(phase_coverage.get(phase, 0) for phase in CONTAINER_SAMPLE_PHASES) != sample_count
            or phase_coverage.get("baseline", 0) < 1
            or phase_coverage.get("steady", 0) + phase_coverage.get("steady-ramp", 0) < 1
            or phase_coverage.get("spike-hold", 0) < 2
            or phase_coverage.get("post-spike", 0) < 1
            or phase_coverage.get("cleanup", 0) < 2
        ):
            failures.append("CONTAINER_PHASE_COVERAGE_INCOMPLETE")

        baseline_states = containers.get("baseline")
        baseline_states = baseline_states if isinstance(baseline_states, dict) else {}
        final_states = containers.get("final")
        final_states = final_states if isinstance(final_states, dict) else {}
        for service in CORE_COMPOSE_SERVICES:
            baseline_state = baseline_states.get(service)
            final_state = final_states.get(service)
            if not isinstance(baseline_state, dict) or not isinstance(final_state, dict):
                failures.append("CONTAINER_MONITORING_INCOMPLETE")
                continue
            states_valid = all(
                isinstance(state.get("containerId"), str)
                and bool(state.get("containerId"))
                and isinstance(state.get("imageId"), str)
                and bool(state.get("imageId"))
                and _is_strict_int(state.get("restartCount"))
                and state.get("restartCount") >= 0
                and type(state.get("oomKilled")) is bool
                and type(state.get("running")) is bool
                for state in (baseline_state, final_state)
            )
            if not states_valid:
                failures.append("CONTAINER_MONITORING_INCOMPLETE")
                continue
            if baseline_state.get("containerId") != final_state.get("containerId"):
                failures.append("CONTAINER_ID_CHANGED")
            if not baseline_state.get("imageId") or baseline_state.get("imageId") != final_state.get("imageId"):
                failures.append("CONTAINER_IMAGE_CHANGED")
            if final_state["restartCount"] > baseline_state["restartCount"]:
                failures.append("CONTAINER_RESTARTED")
            if baseline_state.get("oomKilled") or final_state.get("oomKilled"):
                failures.append("CONTAINER_OOM_KILLED")
            if final_state.get("running") is not True:
                failures.append("CONTAINER_NOT_RUNNING")

    if not _is_zero_count(report.get("monitoringErrors")):
        failures.append("RESOURCE_MONITORING_FAILED")
    return list(dict.fromkeys(failures))


def _stored_report_thresholds(report: Any) -> Thresholds:
    if not isinstance(report, dict):
        return Thresholds()
    config = report.get("config")
    config = config if isinstance(config, dict) else {}
    evidence = config.get("thresholds")
    if not isinstance(evidence, dict):
        return Thresholds()
    numeric_fields = (
        "sseReadyP95Ms",
        "readP95Ms",
        "writeP95Ms",
        "eventDeliveryP95Ms",
    )
    if any(
        not _is_finite_number(evidence.get(field))
        or float(evidence[field]) <= 0
        for field in numeric_fields
    ):
        return Thresholds()
    postgres_headroom = evidence.get("postgresHeadroom")
    postgres_cleanup_delta = evidence.get("postgresCleanupDelta")
    if (
        not _is_strict_int(postgres_headroom)
        or postgres_headroom <= 0
        or not _is_strict_int(postgres_cleanup_delta)
        or postgres_cleanup_delta < 0
    ):
        return Thresholds()
    return Thresholds(
        sse_ready_p95_ms=float(evidence["sseReadyP95Ms"]),
        read_p95_ms=float(evidence["readP95Ms"]),
        write_p95_ms=float(evidence["writeP95Ms"]),
        event_delivery_p95_ms=float(evidence["eventDeliveryP95Ms"]),
        postgres_headroom=postgres_headroom,
        postgres_cleanup_delta=postgres_cleanup_delta,
    )


def stored_capacity_report_failures(report: Any) -> list[str]:
    recomputed = capacity_failures(report, _stored_report_thresholds(report))
    acceptance = report.get("acceptance") if isinstance(report, dict) else None
    acceptance_matches = (
        isinstance(acceptance, dict)
        and set(acceptance) == {"passed", "failures"}
        and acceptance.get("passed") is (not recomputed)
        and acceptance.get("failures") == recomputed
    )
    if acceptance_matches:
        return recomputed
    return [*recomputed, "ACCEPTANCE_SUMMARY_MISMATCH"]


def evidence_metadata(*, namespace: str, public_api_key: str, auth_bridge_secret: str) -> dict[str, Any]:
    return {
        "mode": "local-only",
        "namespace": namespace,
        "secrets": {
            "publicApiKeyPresent": bool(public_api_key),
            "authBridgeSecretPresent": bool(auth_bridge_secret),
        },
    }


def _capacity_limitations(
    *,
    steady_sse: int,
    active_users: int,
    duration_seconds: float,
) -> list[str]:
    duration_minutes = float(duration_seconds) / 60.0
    return [
        "Local-only loopback evidence does not prove WAN, TLS, x86_64, or cloud-prod health.",
        (
            f"The profile models {steady_sse} connected users with {active_users} "
            f"active read/write users, not {steady_sse} simultaneous writers."
        ),
        (
            f"A {duration_minutes:g}-minute run detects obvious leaks and degradation; "
            "it is not a multi-day soak."
        ),
        (
            "Fixture cleanup is external and remains pending until the scoped Compose "
            "project is torn down with volumes after evidence preservation."
        ),
    ]


def _config_evidence(config: ProbeConfig) -> dict[str, Any]:
    return {
        "profileId": config.profile_id,
        "apiBase": config.target.api_base,
        "databaseName": config.target.database_name,
        "databaseScope": "disposable",
        "composeProject": config.compose_project,
        "requiredContainerServices": list(CORE_COMPOSE_SERVICES),
        "expectedPostgresMaxConnections": config.expected_postgres_max_connections,
        "expectedBackendWorkers": config.expected_backend_workers,
        "expectedNotifyPublisherPoolSize": config.expected_notify_publisher_pool_size,
        "postgresConnectionBudget": config.postgres_connection_budget,
        "steadySse": config.steady_sse,
        "spikeTotalSse": config.spike_total_sse,
        "activeUsers": config.active_users,
        "activeCycleSeconds": config.active_cycle_seconds,
        "durationSeconds": config.duration_seconds,
        "rampSeconds": config.ramp_seconds,
        "spikeAtSeconds": config.spike_at_seconds,
        "spikeRampSeconds": config.spike_ramp_seconds,
        "spikeDurationSeconds": config.spike_duration_seconds,
        "cleanupTimeoutSeconds": config.cleanup_timeout_seconds,
        "connectTimeoutSeconds": config.connect_timeout_seconds,
        "requestTimeoutSeconds": config.request_timeout_seconds,
        "resourceSampleSeconds": config.resource_sample_seconds,
        "fixtureConcurrency": config.fixture_concurrency,
        "backendPid": config.backend_pid,
        "thresholds": {
            "sseReadyP95Ms": config.thresholds.sse_ready_p95_ms,
            "readP95Ms": config.thresholds.read_p95_ms,
            "writeP95Ms": config.thresholds.write_p95_ms,
            "eventDeliveryP95Ms": config.thresholds.event_delivery_p95_ms,
            "postgresHeadroom": config.thresholds.postgres_headroom,
            "postgresCleanupDelta": config.thresholds.postgres_cleanup_delta,
        },
        "targetResourceEnvelope": dict(FORMAL_TARGET_RESOURCE_ENVELOPE),
    }


def _database_counter_deltas(samples: list[dict[str, Any]]) -> dict[str, int]:
    counters = [sample["database"] for sample in samples if sample.get("database")]
    if len(counters) < 2:
        return {}
    first, last = counters[0], counters[-1]
    if any(
        key not in first
        or key not in last
        or not _is_strict_int(first[key])
        or not _is_strict_int(last[key])
        for key in DATABASE_COUNTER_FIELDS
    ):
        return {}
    return {
        key: last[key] - first[key]
        for key in DATABASE_COUNTER_FIELDS
    }


async def _observe_cleanup(
    monitor: ResourceMonitor,
    *,
    baseline_connections: int,
    baseline_file_descriptors: int | None,
    monotonic: Callable[[], float] = time.monotonic,
    sleeper: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> dict[str, Any]:
    started_at = monotonic()
    next_deadline = started_at
    duration = monitor.config.cleanup_timeout_seconds
    interval = monitor.config.resource_sample_seconds
    cleanup_delta = getattr(
        getattr(monitor.config, "thresholds", None),
        "postgres_cleanup_delta",
        2,
    )
    recovered_at: float | None = None
    final_connections: int | None = None
    while True:
        sample_started = monotonic()
        sample = await monitor.sample("cleanup")
        sample_finished = monotonic()
        if sample_finished - sample_started > interval:
            monitor.sampling_overruns += 1
        elapsed = max(0.0, sample_finished - started_at)
        if sample is not None:
            final_connections = int(sample["postgres"].get("total", 0))
            postgres_ok = final_connections <= baseline_connections + cleanup_delta
            current_fds = sample["process"].get("fileDescriptors") if sample.get("process") else None
            file_descriptors_ok = (
                baseline_file_descriptors is None
                or current_fds is None
                or int(current_fds) <= baseline_file_descriptors + 10
            )
            if recovered_at is None and postgres_ok and file_descriptors_ok:
                recovered_at = elapsed
        if elapsed >= duration:
            break
        next_deadline += interval
        delay = min(next_deadline, started_at + duration) - sample_finished
        if delay < 0:
            continue
        await sleeper(delay)
    return {
        "recoveredAtSeconds": round(recovered_at, 3) if recovered_at is not None else None,
        "observedSeconds": round(max(0.0, monotonic() - started_at), 3),
        "finalConnections": final_connections,
    }


async def run_capacity_probe(config: ProbeConfig) -> dict[str, Any]:
    import httpx

    root = Path(__file__).resolve().parents[1]
    started_wall = datetime.now(timezone.utc)
    started_monotonic = time.monotonic()
    candidate_started = _candidate_metadata(root)
    streams = StreamStats()
    reads = MetricRecorder()
    writes = MetricRecorder()
    ledger = EventLedger()
    monitor = ResourceMonitor(config, started_at=started_monotonic)
    phase = {"name": "fixture"}
    monitor_stop = asyncio.Event()
    base_stop = asyncio.Event()
    spike_stop = asyncio.Event()
    active_stop = asyncio.Event()
    monitor_task: asyncio.Task[None] | None = None
    active_tasks: list[asyncio.Task[int]] = []
    active_results: list[int | BaseException] = []
    base_handles: list[StreamHandle] = []
    spike_handles: list[StreamHandle] = []
    baseline_connections = 0
    baseline_file_descriptors: int | None = None
    steady_ready_streams = 0
    timeline: dict[str, float] = {}

    request_timeout, stream_timeout = _http_timeouts(
        httpx,
        request_timeout_seconds=config.request_timeout_seconds,
        connect_timeout_seconds=config.connect_timeout_seconds,
    )
    request_limits = httpx.Limits(
        max_connections=max(config.fixture_concurrency, config.active_users) + 20,
        max_keepalive_connections=max(50, config.active_users * 2),
        keepalive_expiry=10,
    )
    stream_limits = httpx.Limits(
        max_connections=config.spike_total_sse + 10,
        max_keepalive_connections=0,
        keepalive_expiry=10,
    )
    request_client = httpx.AsyncClient(
        timeout=request_timeout,
        limits=request_limits,
        follow_redirects=False,
        trust_env=False,
    )
    stream_client = httpx.AsyncClient(
        timeout=stream_timeout,
        limits=stream_limits,
        follow_redirects=False,
        trust_env=False,
    )

    try:
        await monitor.start()
        print(f"CAPACITY mode=local-only namespace={config.namespace}", flush=True)
        fixtures = await bootstrap_fixtures(request_client, config)
        print(f"CAPACITY phase=fixture activeChannels={config.active_users}", flush=True)
        fixtures = await create_active_channels(request_client, config, fixtures)
        await warm_fixtures(request_client, config, fixtures)

        phase["name"] = "baseline"
        baseline = await monitor.sample("baseline")
        if baseline is None:
            raise ProbeError("resource baseline could not be collected")
        baseline_connections = int(baseline["postgres"].get("total", 0))
        process = baseline.get("process") or {}
        baseline_file_descriptors = process.get("fileDescriptors")
        monitor_task = asyncio.create_task(monitor_loop(monitor, phase, monitor_stop))

        phase["name"] = "steady-ramp"
        timeline["steadyRampStartedAtSeconds"] = round(
            time.monotonic() - started_monotonic,
            3,
        )
        print(
            f"CAPACITY phase=steady-ramp requested={config.steady_sse} rampSeconds={config.ramp_seconds}",
            flush=True,
        )
        base_handles = await start_streams(
            client=stream_client,
            config=config,
            fixtures=fixtures[: config.steady_sse],
            ramp_seconds=config.ramp_seconds,
            stats=streams,
            ledger=ledger,
            stop_event=base_stop,
        )
        steady_ready_streams = streams.current_ready
        print(
            f"CAPACITY phase=steady ready={streams.current_ready}/{config.steady_sse}",
            flush=True,
        )
        timeline["steadyReadyAtSeconds"] = round(time.monotonic() - started_monotonic, 3)

        phase["name"] = "steady"
        active_tasks = [
            asyncio.create_task(
                active_user_loop(
                    client=request_client,
                    config=config,
                    fixture=fixture,
                    position=position,
                    stop_event=active_stop,
                    reads=reads,
                    writes=writes,
                    ledger=ledger,
                )
            )
            for position, fixture in enumerate(fixtures[: config.active_users])
        ]
        steady_started = time.monotonic()
        timeline["workloadStartedAtSeconds"] = round(steady_started - started_monotonic, 3)
        await asyncio.sleep(config.spike_at_seconds)

        extra_fixtures = fixtures[config.steady_sse : config.spike_total_sse]
        phase["name"] = "spike-ramp"
        timeline["spikeRampStartedAtSeconds"] = round(time.monotonic() - started_monotonic, 3)
        print(
            f"CAPACITY phase=spike-ramp add={len(extra_fixtures)} target={config.spike_total_sse}",
            flush=True,
        )
        spike_handles = await start_streams(
            client=stream_client,
            config=config,
            fixtures=extra_fixtures,
            ramp_seconds=config.spike_ramp_seconds,
            stats=streams,
            ledger=ledger,
            stop_event=spike_stop,
        )
        phase["name"] = "spike-hold"
        print(
            f"CAPACITY phase=spike-hold ready={streams.current_ready}/{config.spike_total_sse}",
            flush=True,
        )
        spike_peak_started = time.monotonic()
        timeline["spikePeakReadyAtSeconds"] = round(spike_peak_started - started_monotonic, 3)
        await asyncio.sleep(config.spike_duration_seconds)
        spike_peak_ended = time.monotonic()
        timeline["spikePeakEndedAtSeconds"] = round(spike_peak_ended - started_monotonic, 3)
        await close_streams(spike_handles, spike_stop)
        phase["name"] = "post-spike"
        print(f"CAPACITY phase=post-spike ready={streams.current_ready}/{config.steady_sse}", flush=True)

        remaining = config.duration_seconds - (time.monotonic() - steady_started)
        if remaining > 0:
            await asyncio.sleep(remaining)
        active_stop.set()
        active_results = list(await asyncio.gather(*active_tasks, return_exceptions=True))
        workload_ended = time.monotonic()
        timeline["workloadEndedAtSeconds"] = round(workload_ended - started_monotonic, 3)
        await asyncio.sleep(min(2.0, config.cleanup_timeout_seconds))
        await close_streams(base_handles, base_stop)

        monitor_stop.set()
        if monitor_task is not None:
            await monitor_task
        await request_client.aclose()
        await stream_client.aclose()
        timeline["cleanupStartedAtSeconds"] = round(time.monotonic() - started_monotonic, 3)
        cleanup_observation = await _observe_cleanup(
            monitor,
            baseline_connections=baseline_connections,
            baseline_file_descriptors=baseline_file_descriptors,
        )
        timeline["cleanupEndedAtSeconds"] = round(time.monotonic() - started_monotonic, 3)
        timeline["workloadObservedSeconds"] = round(workload_ended - steady_started, 3)
        timeline["spikePeakHoldSeconds"] = round(spike_peak_ended - spike_peak_started, 3)
        timeline["cleanupObservedSeconds"] = float(cleanup_observation["observedSeconds"])

        stream_summary = streams.summary()
        stream_summary["steadyReady"] = steady_ready_streams
        postgres_summary = monitor.postgres_summary()
        read_summary = reads.summary()
        write_summary = writes.summary()
        event_summary = ledger.summary()
        active_error_types: Counter[str] = Counter()
        per_user_cycles: list[dict[str, int]] = []
        for fixture, result in zip(fixtures[: config.active_users], active_results, strict=True):
            if isinstance(result, BaseException):
                active_error_types[type(result).__name__] += 1
                cycles = 0
            else:
                cycles = int(result)
            per_user_cycles.append({"userIndex": fixture.user_index, "cycles": cycles})
        cycle_counts = [entry["cycles"] for entry in per_user_cycles]
        target_cycles = math.floor(config.duration_seconds / config.active_cycle_seconds)
        minimum_cycles = max(1, target_cycles - 1)
        workload_summary = {
            "users": config.active_users,
            "targetCyclesPerUser": target_cycles,
            "minimumCyclesPerUser": minimum_cycles,
            "minCompletedCyclesPerUser": min(cycle_counts, default=0),
            "maxCompletedCyclesPerUser": max(cycle_counts, default=0),
            "totalCycles": sum(cycle_counts),
            "totalReads": int(read_summary["requests"]),
            "totalWrites": int(write_summary["requests"]),
            "activeTaskErrors": sum(active_error_types.values()),
            "activeTaskErrorTypes": dict(sorted(active_error_types.items())),
            "perUserCycles": per_user_cycles,
        }
        report: dict[str, Any] = {
            "schemaVersion": REPORT_SCHEMA_VERSION,
            "metadata": {
                **evidence_metadata(
                    namespace=config.namespace,
                    public_api_key=config.public_api_key,
                    auth_bridge_secret=config.auth_bridge_secret,
                ),
                "startedAt": started_wall.isoformat(),
                "finishedAt": datetime.now(timezone.utc).isoformat(),
                "elapsedSeconds": round(time.monotonic() - started_monotonic, 3),
                "host": {
                    "platform": platform.platform(),
                    "machine": platform.machine(),
                    "python": platform.python_version(),
                },
                "candidate": candidate_started,
                "candidateFinished": _candidate_metadata(root),
            },
            "config": _config_evidence(config),
            "fixture": {"users": len(fixtures), "activeChannels": config.active_users},
            "streams": stream_summary,
            "http": {"read": read_summary, "write": write_summary},
            "events": event_summary,
            "workload": workload_summary,
            "postgres": postgres_summary,
            "backendRuntime": monitor.backend_runtime,
            "frontendRuntime": monitor.frontend_runtime,
            "optionalServiceRuntime": monitor.optional_service_runtime,
            "containerImageRevisions": monitor.candidate_image_revisions,
            "databaseCounterDeltas": _database_counter_deltas(monitor.samples),
            "process": monitor.process_summary(),
            "containers": monitor.container_summary(),
            "timeline": timeline,
            "cleanup": {
                **cleanup_observation,
                "clientTasks": sum(
                    1 for handle in [*base_handles, *spike_handles] if not handle.task.done()
                )
                + sum(1 for task in active_tasks if not task.done()),
                "currentReadyStreams": streams.current_ready,
            },
            "monitoringErrors": sum(monitor.error_types.values()),
            "monitoringErrorTypes": dict(sorted(monitor.error_types.items())),
            "resourceSamples": monitor.samples,
            "limitations": _capacity_limitations(
                steady_sse=config.steady_sse,
                active_users=config.active_users,
                duration_seconds=config.duration_seconds,
            ),
        }
        failures = capacity_failures(report, config.thresholds)
        report["acceptance"] = {"passed": not failures, "failures": failures}
        return report
    finally:
        active_stop.set()
        if active_tasks:
            for task in active_tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*active_tasks, return_exceptions=True)
        await close_streams(spike_handles, spike_stop)
        await close_streams(base_handles, base_stop)
        monitor_stop.set()
        if monitor_task is not None and not monitor_task.done():
            await monitor_task
        if not request_client.is_closed:
            await request_client.aclose()
        if not stream_client.is_closed:
            await stream_client.aclose()
        await monitor.close()


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def main(argv: list[str] | None = None) -> int:
    try:
        config = load_config(parse_args(argv), dict(os.environ))
    except SafetyError as exc:
        print(f"capacity safety gate failed: {exc}", file=sys.stderr)
        return 2
    try:
        report = asyncio.run(run_capacity_probe(config))
    except Exception as exc:
        print(f"capacity probe failed safely: {type(exc).__name__}", file=sys.stderr)
        return 3
    write_report(config.output, report)
    failures = report["acceptance"]["failures"]
    print(
        f"CAPACITY completed passed={not failures} failures={','.join(failures) if failures else 'none'} "
        f"output={config.output}",
        flush=True,
    )
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
