import argparse
import asyncio
import copy
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from scripts import local_capacity_probe as capacity


def _container_state(
    service: str,
    *,
    restart_count: int = 0,
    oom_killed: bool = False,
    running: bool = True,
) -> dict[str, object]:
    return {
        "containerId": f"container-{service}",
        "imageId": f"sha256:image-{service}",
        "status": "running" if running else "exited",
        "running": running,
        "restartCount": restart_count,
        "oomKilled": oom_killed,
    }


def _container_observation(service: str) -> dict[str, object]:
    return {
        **_container_state(service),
        "cpuPercent": 1.0,
        "memoryUsageBytes": 10_000,
        "memoryPercent": 1.0,
        "networkRxBytes": 1_000,
        "networkTxBytes": 2_000,
        "blockReadBytes": 3_000,
        "blockWriteBytes": 4_000,
        "pids": 5,
    }


def _latency_evidence(count: int, value: float = 100.0) -> dict[str, int | float]:
    return {
        "count": count,
        "min": value,
        "p50": value,
        "p95": value,
        "p99": value,
        "max": value,
    }


def _passing_report() -> dict[str, object]:
    candidate = {
        "head": "0123456789abcdef0123456789abcdef01234567",
        "tree": "89abcdef0123456789abcdef0123456789abcdef",
        "branch": "feat/2026-07-audit-remediation",
        "dirty": False,
        "workingDiffSha256": (
            "e3b0c44298fc1c149afbf4c8996fb924"
            "27ae41e4649b934ca495991b7852b855"
        ),
    }
    timeline = {
        "steadyRampStartedAtSeconds": 2.0,
        "steadyReadyAtSeconds": 62.0,
        "workloadStartedAtSeconds": 62.0,
        "spikeRampStartedAtSeconds": 652.0,
        "spikePeakReadyAtSeconds": 662.0,
        "spikePeakEndedAtSeconds": 722.0,
        "workloadEndedAtSeconds": 1_862.0,
        "cleanupStartedAtSeconds": 1_864.0,
        "cleanupEndedAtSeconds": 1_926.0,
        "workloadObservedSeconds": 1_800.0,
        "spikePeakHoldSeconds": 60.0,
        "cleanupObservedSeconds": 62.0,
    }

    def phase_at(sample_started: float) -> str:
        if sample_started == 0:
            return "baseline"
        if sample_started < timeline["steadyReadyAtSeconds"]:
            return "steady-ramp"
        if sample_started < timeline["spikeRampStartedAtSeconds"]:
            return "steady"
        if sample_started < timeline["spikePeakReadyAtSeconds"]:
            return "spike-ramp"
        if sample_started < timeline["spikePeakEndedAtSeconds"]:
            return "spike-hold"
        if sample_started < timeline["cleanupStartedAtSeconds"]:
            return "post-spike"
        return "cleanup"

    sample_starts = [
        0.0,
        *(float(value) for value in range(2, 1_863, 5)),
        *(float(value) for value in range(1_864, 1_925, 5)),
    ]
    resource_samples: list[dict[str, object]] = []
    for index, sample_started in enumerate(sample_starts):
        phase = phase_at(sample_started)
        total_connections = 90 if phase == "spike-hold" else 8
        active_connections = 5 if phase == "spike-hold" else 1
        resource_samples.append(
            {
                "elapsedSeconds": sample_started + 2.0,
                "sampleStartedElapsedSeconds": sample_started,
                "sampleFinishedElapsedSeconds": sample_started + 2.0,
                "sampleDurationSeconds": 2.0,
                "phase": phase,
                "postgres": {
                    "total": total_connections,
                    "active": active_connections,
                    "idle": total_connections - active_connections,
                    "idle_in_transaction": 0,
                    "waiting": 0,
                    "notify_publishers": 1,
                    "notify_listeners": 1,
                    "observers": 1,
                },
                "database": {
                    "xact_commit": index * 1_000,
                    "xact_rollback": index,
                    "deadlocks": 0,
                    "temp_bytes": index * 10,
                },
                "process": {},
                "containers": {
                    service: {**_container_observation(service), "pids": 5 + index}
                    for service in capacity.CORE_COMPOSE_SERVICES
                },
            }
        )
    containers = capacity._container_summary(
        resource_samples,
        monitoring_errors=0,
        sampling_overruns=0,
    )
    return {
        "schemaVersion": capacity.REPORT_SCHEMA_VERSION,
        "metadata": {
            "mode": "local-only",
            "namespace": "audit-local",
            "candidate": {**candidate},
            "candidateFinished": {**candidate},
        },
        "config": {
            "profileId": "formal-300-500-30-v1",
            "apiBase": "http://127.0.0.1:19081",
            "databaseName": "audit_capacity",
            "databaseScope": "disposable",
            "composeProject": "smallkhoj-audit-capacity-final",
            "requiredContainerServices": list(capacity.CORE_COMPOSE_SERVICES),
            "expectedBackendWorkers": 1,
            "expectedNotifyPublisherPoolSize": 2,
            "postgresConnectionBudget": {
                "databasePoolSize": 5,
                "databaseMaxOverflow": 10,
                "notifyPublisherPoolSize": 2,
                "notifyListenerPerBackendWorker": 1,
                "backendWorkers": 1,
                "backendPerProcess": 18,
                "backendTotal": 18,
                "betterAuthDatabasePoolSize": 10,
                "feishuWorkerReserve": 15,
                "headroom": 5,
                "required": 48,
            },
            "steadySse": 300,
            "spikeTotalSse": 500,
            "activeUsers": 30,
            "activeCycleSeconds": 5.0,
            "durationSeconds": 1_800.0,
            "rampSeconds": 60.0,
            "spikeAtSeconds": 590.0,
            "spikeRampSeconds": 10.0,
            "spikeDurationSeconds": 60.0,
            "cleanupTimeoutSeconds": 60.0,
            "connectTimeoutSeconds": 20.0,
            "requestTimeoutSeconds": 20.0,
            "resourceSampleSeconds": 5.0,
            "expectedPostgresMaxConnections": 100,
            "thresholds": {
                "sseReadyP95Ms": 2_000.0,
                "readP95Ms": 500.0,
                "writeP95Ms": 1_000.0,
                "eventDeliveryP95Ms": 2_000.0,
                "postgresHeadroom": 5,
                "postgresCleanupDelta": 2,
            },
            "targetResourceEnvelope": {
                "vcpus": 4,
                "guestMemoryBytes": 3_564_584_960,
                "maxAggregateCpuPercent": 320.0,
                "maxContainerMemoryBytes": 2_673_438_720,
            },
        },
        "fixture": {"users": 500, "activeChannels": 30},
        "streams": {
            "requested": 500,
            "ready": 500,
            "steadyReady": 300,
            "peakConcurrentReady": 500,
            "setupErrors": 0,
            "unexpectedCloses": 0,
            "invalidJsonFrames": 0,
            "readyLatencyMs": _latency_evidence(500),
        },
        "http": {
            "read": {
                "requests": 10_800,
                "successes": 10_800,
                "errors": 0,
                "non2xx": 0,
                "latencyMs": _latency_evidence(10_800),
            },
            "write": {
                "requests": 10_800,
                "successes": 10_800,
                "errors": 0,
                "non2xx": 0,
                "latencyMs": _latency_evidence(10_800),
            },
        },
        "events": {
            "expected": 10_800,
            "received": 10_800,
            "missing": 0,
            "duplicates": 0,
            "wrongScope": 0,
            "unexpected": 0,
            "deliveryLatencyMs": _latency_evidence(10_800),
        },
        "workload": {
            "users": 30,
            "targetCyclesPerUser": 360,
            "minimumCyclesPerUser": 359,
            "minCompletedCyclesPerUser": 360,
            "maxCompletedCyclesPerUser": 360,
            "totalCycles": 10_800,
            "totalReads": 10_800,
            "totalWrites": 10_800,
            "activeTaskErrors": 0,
            "activeTaskErrorTypes": {},
            "perUserCycles": [
                {"userIndex": user_index, "cycles": 360} for user_index in range(30)
            ],
        },
        "postgres": capacity._postgres_summary(resource_samples, max_connections=100),
        "backendRuntime": {
            "workers": 1,
            "databasePoolSize": 5,
            "databaseMaxOverflow": 10,
            "notifyPublisherPoolSize": 2,
            "betterAuthDatabasePoolSize": 10,
            "postgresMaxConnections": 100,
            "postgresConnectionHeadroom": 5,
        },
        "frontendRuntime": {"betterAuthDatabasePoolSize": 10},
        "optionalServiceRuntime": {"feishuWorkerContainers": 0},
        "containerImageRevisions": {
            service: candidate["head"]
            for service in capacity.CANDIDATE_IMAGE_SERVICES
        },
        "databaseCounterDeltas": capacity._database_counter_deltas(resource_samples),
        "containers": containers,
        "timeline": timeline,
        "cleanup": {
            "clientTasks": 0,
            "currentReadyStreams": 0,
            "recoveredAtSeconds": 2.0,
            "observedSeconds": 62.0,
            "finalConnections": 8,
        },
        "monitoringErrors": 0,
        "resourceSamples": resource_samples,
        "limitations": [
            "Local-only loopback evidence does not prove WAN, TLS, x86_64, or cloud-prod health.",
            "The profile models 300 connected users with 30 active read/write users, not 300 simultaneous writers.",
            "A 30-minute run detects obvious leaks and degradation; it is not a multi-day soak.",
            "Fixture cleanup is external and remains pending until the scoped Compose project is torn down with volumes after evidence preservation.",
        ],
    }


class LocalCapacityProbeTests(unittest.TestCase):
    def test_runtime_client_bypasses_environment_proxy_and_drains_fixture_tasks(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "local_capacity_probe.py").read_text()

        self.assertIn("trust_env=False", source)
        self.assertIn("await asyncio.gather(*tasks, return_exceptions=True)", source)

    def test_request_client_has_finite_reads_while_only_sse_streams_disable_read_timeout(self) -> None:
        class FakeTimeout:
            def __init__(
                self,
                *,
                connect: float,
                read: float | None,
                write: float,
                pool: float,
            ) -> None:
                self.connect = connect
                self.read = read
                self.write = write
                self.pool = pool

        request_timeout, stream_timeout = capacity._http_timeouts(
            SimpleNamespace(Timeout=FakeTimeout),
            request_timeout_seconds=10.0,
            connect_timeout_seconds=2.0,
        )
        source = (Path(__file__).resolve().parents[1] / "local_capacity_probe.py").read_text()

        self.assertEqual(request_timeout.connect, 2.0)
        self.assertEqual(request_timeout.read, 10.0)
        self.assertEqual(request_timeout.write, 2.0)
        self.assertEqual(request_timeout.pool, 2.0)
        self.assertEqual(stream_timeout.connect, 2.0)
        self.assertIsNone(stream_timeout.read)
        self.assertEqual(stream_timeout.write, 2.0)
        self.assertEqual(stream_timeout.pool, 2.0)
        self.assertIn("request_client = httpx.AsyncClient", source)
        self.assertIn("stream_client = httpx.AsyncClient", source)
        self.assertIn("fixtures = await bootstrap_fixtures(request_client", source)
        self.assertIn("fixtures = await create_active_channels(request_client", source)
        self.assertIn("await warm_fixtures(request_client", source)
        self.assertIn("client=request_client", source)
        self.assertEqual(source.count("client=stream_client"), 2)
        self.assertIn("await request_client.aclose()", source)
        self.assertIn("await stream_client.aclose()", source)

    def test_non_stream_response_times_out_while_sse_read_remains_open(self) -> None:
        try:
            import httpx
        except ModuleNotFoundError:
            self.skipTest("runtime HTTP timeout behavior requires the backend virtualenv")

        async def scenario() -> None:
            release = asyncio.Event()
            handlers: set[asyncio.Task[None]] = set()

            async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
                task = asyncio.current_task()
                if task is not None:
                    handlers.add(task)
                try:
                    request = await reader.readuntil(b"\r\n\r\n")
                    if request.startswith(b"GET /sse "):
                        writer.write(
                            b"HTTP/1.1 200 OK\r\n"
                            b"Content-Type: text/event-stream\r\n"
                            b"Transfer-Encoding: chunked\r\n"
                            b"Connection: close\r\n\r\n"
                        )
                    else:
                        writer.write(
                            b"HTTP/1.1 200 OK\r\n"
                            b"Content-Length: 1\r\n"
                            b"Connection: close\r\n\r\n"
                        )
                    await writer.drain()
                    await release.wait()
                finally:
                    writer.close()
                    await writer.wait_closed()
                    if task is not None:
                        handlers.discard(task)

            server = await asyncio.start_server(handler, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            request_timeout, stream_timeout = capacity._http_timeouts(
                httpx,
                request_timeout_seconds=0.05,
                connect_timeout_seconds=1.0,
            )
            try:
                async with (
                    httpx.AsyncClient(timeout=request_timeout, trust_env=False) as request_client,
                    httpx.AsyncClient(timeout=stream_timeout, trust_env=False) as stream_client,
                ):
                    with self.assertRaises(httpx.ReadTimeout):
                        await request_client.get(f"http://127.0.0.1:{port}/ordinary")

                    async with stream_client.stream("GET", f"http://127.0.0.1:{port}/sse") as response:
                        self.assertEqual(response.status_code, 200)
                        body = response.aiter_bytes()
                        with self.assertRaises(TimeoutError):
                            await asyncio.wait_for(body.__anext__(), timeout=0.1)
            finally:
                release.set()
                server.close()
                await server.wait_closed()
                if handlers:
                    await asyncio.gather(*tuple(handlers), return_exceptions=True)

        asyncio.run(scenario())

    def test_postgres_wait_metric_excludes_idle_client_read_connections(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "local_capacity_probe.py").read_text()

        self.assertIn(
            "count(*) FILTER (WHERE state = 'active' AND wait_event IS NOT NULL)::int AS waiting",
            source,
        )

    def test_postgres_monitor_commands_share_the_finite_request_timeout(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "local_capacity_probe.py").read_text()

        self.assertIn("command_timeout=self.config.request_timeout_seconds", source)

    def test_default_profile_matches_the_reviewed_300_500_model(self) -> None:
        args = capacity.parse_args(["--output", "/tmp/local-capacity.json"])

        self.assertEqual(args.profile_id, "formal-300-500-30-v1")
        self.assertEqual(args.steady_sse, 300)
        self.assertEqual(args.spike_total_sse, 500)
        self.assertEqual(args.active_users, 30)
        self.assertEqual(args.active_cycle_seconds, 5)
        self.assertEqual(args.duration_seconds, 1800)
        self.assertEqual(args.spike_at_seconds, 590)
        self.assertEqual(args.spike_ramp_seconds, 10)
        self.assertEqual(args.spike_duration_seconds, 60)
        self.assertEqual(args.request_timeout_seconds, 20)
        self.assertEqual(args.resource_sample_seconds, 5)

    def test_formal_cli_profile_cannot_be_downgraded_but_smoke_is_explicit(self) -> None:
        profile_args = [
            "--steady-sse",
            "1",
            "--spike-total-sse",
            "2",
            "--active-users",
            "1",
            "--duration-seconds",
            "30",
            "--ramp-seconds",
            "1",
            "--spike-at-seconds",
            "5",
            "--spike-ramp-seconds",
            "1",
            "--spike-duration-seconds",
            "5",
            "--cleanup-timeout-seconds",
            "10",
            "--resource-sample-seconds",
            "1",
            "--output",
            "/tmp/local-capacity.json",
        ]
        env = {
            "API_BASE": "http://127.0.0.1:18000",
            "CAPACITY_DATABASE_URL": (
                "postgresql://audit:ephemeral@localhost:55434/audit_ci"
            ),
            "CAPACITY_DATABASE_SCOPE": "disposable",
            "CAPACITY_RUN_NAMESPACE": "audit-local",
            "CAPACITY_COMPOSE_PROJECT": "smallkhoj-audit-capacity-final",
            "CAPACITY_EXPECTED_POSTGRES_MAX_CONNECTIONS": "100",
            "DATABASE_POOL_SIZE": "5",
            "DATABASE_MAX_OVERFLOW": "10",
            "BETTER_AUTH_DATABASE_POOL_SIZE": "10",
            "BACKEND_WORKERS": "1",
            "NOTIFY_PUBLISHER_POOL_SIZE": "2",
            "POSTGRES_CONNECTION_HEADROOM": "5",
            "PUBLIC_API_KEY": "capacity-public-secret",
            "AUTH_BRIDGE_SECRET": "capacity-bridge-secret",
        }

        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(capacity.parse_args(profile_args), env)

        smoke = capacity.load_config(
            capacity.parse_args(["--profile", "smoke", *profile_args]),
            env,
        )
        self.assertEqual(smoke.profile_id, "smoke")

        formal = capacity.load_config(
            capacity.parse_args(["--output", "/tmp/local-capacity.json"]),
            env,
        )
        self.assertEqual(formal.expected_database_pool_size, 5)
        self.assertEqual(formal.expected_database_max_overflow, 10)
        self.assertEqual(formal.expected_better_auth_database_pool_size, 10)
        self.assertEqual(formal.expected_postgres_connection_headroom, 5)
        self.assertEqual(formal.backend_connections_per_process, 18)
        self.assertEqual(formal.backend_deployment_connections, 18)
        self.assertEqual(formal.feishu_worker_reserve, 15)
        self.assertEqual(formal.required_postgres_connections, 48)
        self.assertEqual(
            formal.postgres_connection_budget["notifyListenerPerBackendWorker"],
            1,
        )

        for name, value in (
            ("DATABASE_POOL_SIZE", "6"),
            ("DATABASE_MAX_OVERFLOW", "9"),
            ("BETTER_AUTH_DATABASE_POOL_SIZE", "9"),
            ("POSTGRES_CONNECTION_HEADROOM", "4"),
        ):
            with self.subTest(name=name), self.assertRaises(capacity.SafetyError):
                capacity.load_config(
                    capacity.parse_args(["--output", "/tmp/local-capacity.json"]),
                    {**env, name: value},
                )

    def test_report_threshold_evidence_must_match_the_evaluator_thresholds(self) -> None:
        failures = capacity.capacity_failures(
            _passing_report(),
            capacity.Thresholds(read_p95_ms=50_000.0),
        )

        self.assertIn("FORMAL_CAPACITY_PROFILE_INVALID", failures)

    def test_compose_monitor_discovers_exact_core_services_with_safe_commands(self) -> None:
        calls: list[list[str]] = []

        def runner(command: list[str], purpose: str) -> str:
            calls.append(command)
            self.assertEqual(purpose, "compose service discovery")
            service_filter = next(value for value in command if "com.docker.compose.service=" in value)
            service = service_filter.rsplit("=", 1)[-1]
            return f"container-{service}\n"

        containers = capacity.discover_compose_containers("smallkhoj-audit-capacity-final", runner=runner)

        self.assertEqual(
            containers,
            {service: f"container-{service}" for service in capacity.CORE_COMPOSE_SERVICES},
        )
        self.assertEqual(len(calls), 4)
        self.assertTrue(all(command[:3] == ["docker", "ps", "-aq"] for command in calls))
        self.assertTrue(all(".Config.Env" not in " ".join(command) for command in calls))

    def test_compose_monitor_rejects_missing_or_duplicate_service(self) -> None:
        def missing_runner(command: list[str], purpose: str) -> str:
            del purpose
            return "" if command[-1].endswith("=caddy") else "one-id\n"

        with self.assertRaises(capacity.ProbeError):
            capacity.discover_compose_containers("smallkhoj-audit-capacity-final", runner=missing_runner)

        def duplicate_runner(command: list[str], purpose: str) -> str:
            del command, purpose
            return "one-id\ntwo-id\n"

        with self.assertRaises(capacity.ProbeError):
            capacity.discover_compose_containers("smallkhoj-audit-capacity-final", runner=duplicate_runner)

    def test_capacity_shape_requires_no_feishu_worker_container(self) -> None:
        calls: list[list[str]] = []

        def absent_runner(command: list[str], purpose: str) -> str:
            calls.append(command)
            self.assertEqual(purpose, "optional capacity service discovery")
            return ""

        self.assertEqual(
            capacity.inspect_optional_capacity_services(
                "smallkhoj-audit-capacity-final",
                runner=absent_runner,
            ),
            {"feishuWorkerContainers": 0},
        )
        self.assertIn(
            "label=com.docker.compose.service=feishu-worker",
            calls[0],
        )
        self.assertNotIn(".Config.Env", " ".join(calls[0]))

        def present_runner(command: list[str], purpose: str) -> str:
            del command, purpose
            return "worker-one\n"

        with self.assertRaises(capacity.ProbeError):
            capacity.inspect_optional_capacity_services(
                "smallkhoj-audit-capacity-final",
                runner=present_runner,
            )

    def test_resource_monitor_rejects_postgres_capacity_before_docker_discovery(
        self,
    ) -> None:
        class FakeConnection:
            async def fetchval(self, query: str) -> str:
                self.query = query
                return "99"

            async def close(self) -> None:
                return None

        connection = FakeConnection()

        async def connect(**kwargs: object) -> FakeConnection:
            self.assertEqual(kwargs["dsn"], "postgresql://unused")
            return connection

        monitor = capacity.ResourceMonitor(
            SimpleNamespace(
                target=SimpleNamespace(database_url="postgresql://unused"),
                request_timeout_seconds=20.0,
                expected_postgres_max_connections=100,
            )
        )
        with (
            patch.dict(sys.modules, {"asyncpg": SimpleNamespace(connect=connect)}),
            patch.object(capacity, "discover_compose_containers") as discover,
            self.assertRaises(capacity.ProbeError),
        ):
            asyncio.run(monitor.start())

        discover.assert_not_called()
        self.assertEqual(connection.query, "SHOW max_connections")
        asyncio.run(monitor.close())

    def test_resource_monitor_rejects_backend_or_frontend_budget_mismatch(
        self,
    ) -> None:
        class FakeConnection:
            async def fetchval(self, query: str) -> str:
                self.query = query
                return "100"

            async def close(self) -> None:
                return None

        async def connect(**kwargs: object) -> FakeConnection:
            del kwargs
            return FakeConnection()

        expected_backend = {
            "workers": 1,
            "databasePoolSize": 5,
            "databaseMaxOverflow": 10,
            "notifyPublisherPoolSize": 2,
            "betterAuthDatabasePoolSize": 10,
            "postgresMaxConnections": 100,
            "postgresConnectionHeadroom": 5,
        }
        expected_frontend = {"betterAuthDatabasePoolSize": 10}
        config = SimpleNamespace(
            target=SimpleNamespace(database_url="postgresql://unused"),
            request_timeout_seconds=20.0,
            compose_project="smallkhoj-audit-capacity-final",
            expected_postgres_max_connections=100,
            expected_backend_workers=1,
            expected_database_pool_size=5,
            expected_database_max_overflow=10,
            expected_notify_publisher_pool_size=2,
            expected_better_auth_database_pool_size=10,
            expected_postgres_connection_headroom=5,
        )
        cases = (
            (
                {**expected_backend, "postgresMaxConnections": 99},
                expected_frontend,
                "backend runtime capacity config",
            ),
            (
                expected_backend,
                {"betterAuthDatabasePoolSize": 9},
                "frontend runtime capacity config",
            ),
        )
        for backend_runtime, frontend_runtime, message in cases:
            with self.subTest(message=message):
                monitor = capacity.ResourceMonitor(config)
                with (
                    patch.dict(
                        sys.modules,
                        {"asyncpg": SimpleNamespace(connect=connect)},
                    ),
                    patch.object(
                        capacity,
                        "discover_compose_containers",
                        return_value={
                            service: f"container-{service}"
                            for service in capacity.CORE_COMPOSE_SERVICES
                        },
                    ),
                    patch.object(
                        capacity,
                        "inspect_optional_capacity_services",
                        return_value={"feishuWorkerContainers": 0},
                    ),
                    patch.object(
                        capacity,
                        "inspect_backend_runtime_config",
                        return_value=backend_runtime,
                    ),
                    patch.object(
                        capacity,
                        "inspect_frontend_runtime_config",
                        return_value=frontend_runtime,
                    ),
                    patch.object(
                        capacity,
                        "inspect_candidate_image_revisions",
                        return_value={
                            service: "0" * 40
                            for service in capacity.CANDIDATE_IMAGE_SERVICES
                        },
                    ),
                    self.assertRaisesRegex(capacity.ProbeError, message),
                ):
                    asyncio.run(monitor.start())
                asyncio.run(monitor.close())

    def test_targeted_container_state_and_stats_capture_required_fields_without_env(self) -> None:
        container_ids = {service: f"container-{service}" for service in capacity.CORE_COMPOSE_SERVICES}
        calls: list[list[str]] = []

        def state_runner(command: list[str], purpose: str) -> str:
            calls.append(command)
            self.assertEqual(purpose, "container state inspection")
            return "\n".join(
                json.dumps(_container_state(service)) for service in capacity.CORE_COMPOSE_SERVICES
            )

        states = capacity.inspect_container_states(container_ids, runner=state_runner)

        self.assertEqual(set(states), set(capacity.CORE_COMPOSE_SERVICES))
        self.assertEqual(states["backend"]["imageId"], "sha256:image-backend")
        self.assertIn("--format", calls[0])
        self.assertNotIn(".Config.Env", " ".join(calls[0]))
        self.assertGreater(len(calls[0]), 4, "targeted inspect must name the four container IDs")

        def stats_runner(command: list[str], purpose: str) -> str:
            calls.append(command)
            self.assertEqual(purpose, "container resource sampling")
            return "\n".join(
                json.dumps(
                    {
                        "ID": f"container-{service}"[:12],
                        "CPUPerc": "1.5%",
                        "MemUsage": "10MiB / 1GiB",
                        "MemPerc": "0.98%",
                        "NetIO": "3kB / 4kB",
                        "BlockIO": "5kB / 6kB",
                        "PIDs": "7",
                    }
                )
                for service in capacity.CORE_COMPOSE_SERVICES
            )

        stats = capacity.sample_docker_stats(container_ids, runner=stats_runner)

        self.assertEqual(stats["db"]["cpuPercent"], 1.5)
        self.assertEqual(stats["db"]["memoryUsageBytes"], 10 * 1024 * 1024)
        self.assertEqual(stats["db"]["networkRxBytes"], 3000)
        self.assertEqual(stats["db"]["blockWriteBytes"], 6000)
        self.assertEqual(stats["db"]["pids"], 7)
        self.assertIn("--no-stream", calls[-1])
        self.assertIn("--format", calls[-1])
        self.assertNotIn(".Config.Env", " ".join(calls[-1]))

    def test_runtime_capacity_config_reads_only_budget_values(self) -> None:
        calls: list[list[str]] = []

        def runner(command: list[str], purpose: str) -> str:
            calls.append(command)
            self.assertEqual(purpose, "backend runtime capacity config inspection")
            return "1\n5\n10\n2\n10\n100\n5\n"

        observed = capacity.inspect_backend_runtime_config(
            "container-backend",
            runner=runner,
        )

        self.assertEqual(
            observed,
            {
                "workers": 1,
                "databasePoolSize": 5,
                "databaseMaxOverflow": 10,
                "notifyPublisherPoolSize": 2,
                "betterAuthDatabasePoolSize": 10,
                "postgresMaxConnections": 100,
                "postgresConnectionHeadroom": 5,
            },
        )
        self.assertEqual(calls[0][:3], ["docker", "exec", "container-backend"])
        self.assertIn("BACKEND_WORKERS", calls[0][-1])
        self.assertIn("DATABASE_POOL_SIZE", calls[0][-1])
        self.assertIn("DATABASE_MAX_OVERFLOW", calls[0][-1])
        self.assertIn("NOTIFY_PUBLISHER_POOL_SIZE", calls[0][-1])
        self.assertIn("BETTER_AUTH_DATABASE_POOL_SIZE", calls[0][-1])
        self.assertIn("POSTGRES_MAX_CONNECTIONS", calls[0][-1])
        self.assertIn("POSTGRES_CONNECTION_HEADROOM", calls[0][-1])
        self.assertNotIn(".Config.Env", " ".join(calls[0]))

        def frontend_runner(command: list[str], purpose: str) -> str:
            calls.append(command)
            self.assertEqual(purpose, "frontend runtime capacity config inspection")
            return "10\n"

        self.assertEqual(
            capacity.inspect_frontend_runtime_config(
                "container-frontend",
                runner=frontend_runner,
            ),
            {"betterAuthDatabasePoolSize": 10},
        )
        self.assertIn("BETTER_AUTH_DATABASE_POOL_SIZE", calls[-1][-1])

        for output in (
            "1\n5\n10\n2\n10\n100\n",
            "1\n5\n10\n2\n10\n100\n5\n99\n",
            "one\n5\n10\n2\n10\n100\n5\n",
            "0\n5\n10\n2\n10\n100\n5\n",
            "1\n5\n-1\n2\n10\n100\n5\n",
        ):
            with self.subTest(backend_output=output), self.assertRaises(
                capacity.ProbeError
            ):
                capacity.inspect_backend_runtime_config(
                    "container-backend",
                    runner=lambda command, purpose, value=output: value,
                )
        for output in ("", "10\n11\n", "ten\n", "0\n", "-1\n"):
            with self.subTest(frontend_output=output), self.assertRaises(
                capacity.ProbeError
            ):
                capacity.inspect_frontend_runtime_config(
                    "container-frontend",
                    runner=lambda command, purpose, value=output: value,
                )

    def test_candidate_image_revision_inspection_reads_only_the_revision_label(self) -> None:
        revision = "0123456789abcdef0123456789abcdef01234567"
        container_ids = {
            service: f"container-{service}"
            for service in capacity.CORE_COMPOSE_SERVICES
        }
        calls: list[list[str]] = []

        def runner(command: list[str], purpose: str) -> str:
            calls.append(command)
            self.assertEqual(purpose, "candidate image revision inspection")
            return "\n".join(
                json.dumps(
                    {
                        "containerId": container_ids[service],
                        "sourceRevision": revision,
                    }
                )
                for service in capacity.CANDIDATE_IMAGE_SERVICES
            )

        observed = capacity.inspect_candidate_image_revisions(
            container_ids,
            runner=runner,
        )

        self.assertEqual(
            observed,
            {service: revision for service in capacity.CANDIDATE_IMAGE_SERVICES},
        )
        self.assertEqual(calls[0][:2], ["docker", "inspect"])
        self.assertIn(capacity.SOURCE_REVISION_LABEL, " ".join(calls[0]))
        self.assertNotIn(".Config.Env", " ".join(calls[0]))

    def test_container_summary_requires_real_phase_coverage_and_strict_endpoints(self) -> None:
        phases = [
            "baseline",
            "steady",
            "spike-hold",
            "spike-hold",
            "post-spike",
            "cleanup",
            "cleanup",
        ]
        samples: list[dict[str, object]] = []
        for index, phase in enumerate(phases):
            containers = {
                service: {**_container_observation(service), "pids": 5 + index}
                for service in capacity.CORE_COMPOSE_SERVICES
            }
            samples.append(
                {
                    "phase": phase,
                    "sampleStartedElapsedSeconds": float(index * 5),
                    "sampleFinishedElapsedSeconds": float(index * 5 + 2),
                    "sampleDurationSeconds": 2.0,
                    "containers": containers,
                }
            )

        summary = capacity._container_summary(
            samples,
            monitoring_errors=0,
            sampling_overruns=1,
        )

        self.assertTrue(summary["complete"])
        self.assertEqual(summary["sampleCount"], 7)
        self.assertEqual(summary["sampleCoverage"], {service: 7 for service in capacity.CORE_COMPOSE_SERVICES})
        self.assertEqual(summary["phaseCoverage"]["spike-hold"], 2)
        self.assertEqual(summary["phaseCoverage"]["cleanup"], 2)
        self.assertEqual(summary["baseline"]["backend"]["pids"], 5)
        self.assertEqual(summary["final"]["backend"]["pids"], 11)
        self.assertEqual(summary["maxSampleGapSeconds"], 5.0)
        self.assertEqual(summary["samplingOverruns"], 1)

        no_endpoints = capacity._container_summary(
            samples[1:5],
            monitoring_errors=0,
            sampling_overruns=0,
        )
        self.assertEqual(no_endpoints["baseline"], {})
        self.assertEqual(no_endpoints["final"], {})

    def test_safety_gate_accepts_only_loopback_and_disposable_database(self) -> None:
        target = capacity.validate_safety(
            api_base="http://127.0.0.1:18000/",
            database_url="postgresql+asyncpg://audit:ephemeral@localhost:55434/audit_ci",
            database_scope="disposable",
        )

        self.assertEqual(target.api_base, "http://127.0.0.1:18000")
        self.assertEqual(
            target.database_url,
            "postgresql://audit:ephemeral@localhost:55434/audit_ci",
        )
        self.assertEqual(target.database_name, "audit_ci")

        rejected = (
            {
                "api_base": "http://124.222.40.40",
                "database_url": "postgresql://audit:ephemeral@localhost:55434/audit_ci",
                "database_scope": "disposable",
            },
            {
                "api_base": "http://127.0.0.1:18000?token=secret",
                "database_url": "postgresql://audit:ephemeral@localhost:55434/audit_ci",
                "database_scope": "disposable",
            },
            {
                "api_base": "http://127.0.0.1:18000",
                "database_url": "postgresql://audit:ephemeral@db.example.com:5432/audit_ci",
                "database_scope": "disposable",
            },
            {
                "api_base": "http://127.0.0.1:18000",
                "database_url": "postgresql://audit:ephemeral@localhost:55434/production",
                "database_scope": "disposable",
            },
            {
                "api_base": "http://127.0.0.1:18000",
                "database_url": "postgresql://audit:ephemeral@localhost:55434/audit_ci",
                "database_scope": "shared",
            },
        )
        for case in rejected:
            with self.subTest(case=case), self.assertRaises(capacity.SafetyError):
                capacity.validate_safety(**case)

    def test_percentile_uses_nearest_rank_and_handles_empty_samples(self) -> None:
        self.assertIsNone(capacity.percentile([], 0.95))
        self.assertEqual(capacity.percentile([4.0, 1.0, 3.0, 2.0], 0.50), 2.0)
        self.assertEqual(capacity.percentile([4.0, 1.0, 3.0, 2.0], 0.95), 4.0)

    def test_sse_parser_emits_complete_json_frames_and_ignores_heartbeats(self) -> None:
        parser = capacity.SseFrameParser()

        self.assertEqual(parser.feed_line(": heartbeat"), [])
        self.assertEqual(parser.feed_line(""), [])
        self.assertEqual(parser.feed_line("event: message.created"), [])
        self.assertEqual(parser.feed_line("id: event-1"), [])
        self.assertEqual(parser.feed_line('data: {"payload":{"traceId":"capacity-1"}}'), [])
        frames = parser.feed_line("")

        self.assertEqual(
            frames,
            [
                capacity.SseFrame(
                    event="message.created",
                    event_id="event-1",
                    data={"payload": {"traceId": "capacity-1"}},
                )
            ],
        )

    def test_capacity_failures_are_machine_readable_and_cover_core_guards(self) -> None:
        report = {
            "streams": {
                "requested": 500,
                "ready": 499,
                "setupErrors": 1,
                "unexpectedCloses": 0,
                "readyLatencyMs": {"p95": 2100.0},
            },
            "http": {
                "read": {"errors": 0, "non2xx": 0, "latencyMs": {"p95": 300.0}},
                "write": {"errors": 0, "non2xx": 1, "latencyMs": {"p95": 700.0}},
            },
            "events": {
                "missing": 1,
                "duplicates": 0,
                "wrongScope": 0,
                "deliveryLatencyMs": {"p95": 500.0},
            },
            "postgres": {
                "maxConnections": 100,
                "peakConnections": 96,
                "baselineConnections": 9,
                "cleanupConnections": 12,
            },
            "cleanup": {"clientTasks": 0},
            "monitoringErrors": 0,
        }

        failures = capacity.capacity_failures(report, capacity.Thresholds())

        self.assertIn("SSE_NOT_ALL_READY", failures)
        self.assertIn("SSE_SETUP_ERROR", failures)
        self.assertIn("SSE_READY_P95_EXCEEDED", failures)
        self.assertIn("HTTP_WRITE_NON_2XX", failures)
        self.assertIn("EVENT_MISSING", failures)
        self.assertIn("POSTGRES_HEADROOM_EXHAUSTED", failures)
        self.assertIn("POSTGRES_CLEANUP_NOT_RECOVERED", failures)

    def test_complete_formal_report_passes_and_evidence_gaps_fail_closed(self) -> None:
        thresholds = capacity.Thresholds()
        report = _passing_report()

        def forge_workload_totals(item: dict[str, object]) -> None:
            item["workload"].update(totalCycles=1, totalReads=1, totalWrites=1)
            item["http"]["read"].update(requests=1, successes=1)
            item["http"]["write"].update(requests=1, successes=1)
            item["events"].update(expected=1, received=1)

        def forge_per_user_minimum(item: dict[str, object]) -> None:
            item["workload"]["perUserCycles"][0]["cycles"] = 0

        def duplicate_per_user_identity(item: dict[str, object]) -> None:
            item["workload"]["perUserCycles"][1]["userIndex"] = 0

        def remove_per_user_evidence(item: dict[str, object]) -> None:
            item["workload"].pop("perUserCycles")

        def remove_one_user_cycle(item: dict[str, object]) -> None:
            item["workload"]["perUserCycles"].pop()

        def use_out_of_range_user_index(item: dict[str, object]) -> None:
            item["workload"]["perUserCycles"][-1]["userIndex"] = 30

        def remove_database_counter(key: str):
            def mutate(item: dict[str, object]) -> None:
                item["databaseCounterDeltas"].pop(key)

            return mutate

        def remove_steady_phase(item: dict[str, object]) -> None:
            item["containers"]["phaseCoverage"].update(steady=0, **{"steady-ramp": 0})

        def remove_spike_phase(item: dict[str, object]) -> None:
            item["containers"]["phaseCoverage"]["spike-hold"] = 0

        def remove_timeline_anchor(item: dict[str, object]) -> None:
            item["timeline"].pop("spikePeakReadyAtSeconds")

        def remove_cleanup_recovery(item: dict[str, object]) -> None:
            item["cleanup"].pop("recoveredAtSeconds")

        def remove_resource_samples(item: dict[str, object]) -> None:
            item.pop("resourceSamples")

        def remove_fixture_evidence(item: dict[str, object]) -> None:
            item.pop("fixture")

        def remove_schema_version(item: dict[str, object]) -> None:
            item.pop("schemaVersion")

        def remove_request_timeout(item: dict[str, object]) -> None:
            item["config"].pop("requestTimeoutSeconds")

        def remove_candidate_head(item: dict[str, object]) -> None:
            item["metadata"]["candidate"].pop("head")

        def remove_stream_latency(item: dict[str, object]) -> None:
            item["streams"].pop("readyLatencyMs")

        def forge_large_sample_gap(item: dict[str, object]) -> None:
            final_sample = item["resourceSamples"][-1]
            final_sample.update(
                elapsedSeconds=10_002.0,
                sampleStartedElapsedSeconds=10_000.0,
                sampleFinishedElapsedSeconds=10_002.0,
            )
            item["containers"] = capacity._container_summary(
                item["resourceSamples"],
                monitoring_errors=0,
                sampling_overruns=0,
            )

        def forge_phase_timeline(item: dict[str, object]) -> None:
            samples = item["resourceSamples"]
            early_steady = next(
                sample for sample in samples if sample["sampleStartedElapsedSeconds"] == 67.0
            )
            real_spike = next(
                sample for sample in samples if sample["sampleStartedElapsedSeconds"] == 667.0
            )
            early_steady["phase"], real_spike["phase"] = real_spike["phase"], early_steady["phase"]
            item["containers"] = capacity._container_summary(
                samples,
                monitoring_errors=0,
                sampling_overruns=0,
            )

        def forge_postgres_relationship(item: dict[str, object], **changes: int) -> None:
            item["resourceSamples"][50]["postgres"].update(changes)
            item["postgres"] = capacity._postgres_summary(
                item["resourceSamples"],
                max_connections=100,
            )

        def drop_notify_listener_after_baseline(item: dict[str, object]) -> None:
            for sample in item["resourceSamples"]:
                if sample["phase"] != "baseline":
                    sample["postgres"]["notify_listeners"] = 0
            item["postgres"] = capacity._postgres_summary(
                item["resourceSamples"],
                max_connections=100,
            )

        def forge_downgraded_formal_profile(item: dict[str, object]) -> None:
            item["config"].update(steadySse=1, spikeTotalSse=2, activeUsers=1)
            item["fixture"].update(users=2, activeChannels=1)
            item["streams"].update(
                requested=2,
                ready=2,
                steadyReady=1,
                peakConcurrentReady=2,
                readyLatencyMs=_latency_evidence(2),
            )
            item["workload"].update(
                users=1,
                minCompletedCyclesPerUser=360,
                maxCompletedCyclesPerUser=360,
                totalCycles=360,
                totalReads=360,
                totalWrites=360,
                perUserCycles=[{"userIndex": 0, "cycles": 360}],
            )
            for operation in ("read", "write"):
                item["http"][operation].update(
                    requests=360,
                    successes=360,
                    latencyMs=_latency_evidence(360),
                )
            item["events"].update(
                expected=360,
                received=360,
                deliveryLatencyMs=_latency_evidence(360),
            )
            item["limitations"][1] = (
                "The profile models 1 connected users with 1 active read/write users, "
                "not 1 simultaneous writers."
            )

        def forge_postgres_target(item: dict[str, object]) -> None:
            item["config"]["expectedPostgresMaxConnections"] = 1_000
            item["postgres"] = capacity._postgres_summary(
                item["resourceSamples"],
                max_connections=1_000,
            )

        def forge_synchronized_pool_split(item: dict[str, object]) -> None:
            item["config"]["postgresConnectionBudget"].update(
                databasePoolSize=4,
                databaseMaxOverflow=11,
            )
            item["backendRuntime"].update(
                databasePoolSize=4,
                databaseMaxOverflow=11,
            )

        def forge_synchronized_frontend_headroom_split(
            item: dict[str, object],
        ) -> None:
            item["config"]["postgresConnectionBudget"].update(
                betterAuthDatabasePoolSize=9,
                headroom=6,
            )
            item["backendRuntime"].update(
                betterAuthDatabasePoolSize=9,
                postgresConnectionHeadroom=6,
            )
            item["frontendRuntime"].update(betterAuthDatabasePoolSize=9)

        def forge_synchronized_postgres_capacity(item: dict[str, object]) -> None:
            item["config"]["expectedPostgresMaxConnections"] = 101
            item["backendRuntime"]["postgresMaxConnections"] = 101
            item["postgres"] = capacity._postgres_summary(
                item["resourceSamples"],
                max_connections=101,
            )

        def exceed_target_resource_envelope(item: dict[str, object]) -> None:
            for sample in item["resourceSamples"]:
                sample["containers"]["backend"].update(
                    memoryUsageBytes=10 * 1024 * 1024 * 1024,
                    memoryPercent=99.0,
                    cpuPercent=400.0,
                )
            item["containers"] = capacity._container_summary(
                item["resourceSamples"],
                monitoring_errors=0,
                sampling_overruns=0,
            )

        def relabel_local_evidence_as_cloud(item: dict[str, object]) -> None:
            item["metadata"]["mode"] = "cloud-prod"
            item["config"].update(
                apiBase="http://124.222.40.40",
                databaseScope="production",
                databaseName="smallkhoj",
            )
            item["limitations"] = []

        def truncate_steady_ramp_head(item: dict[str, object]) -> None:
            samples = [
                sample
                for sample in item["resourceSamples"]
                if sample["sampleStartedElapsedSeconds"] >= 52.0
            ]
            samples[0]["phase"] = "baseline"
            item["resourceSamples"] = samples
            item["databaseCounterDeltas"] = capacity._database_counter_deltas(samples)
            item["postgres"] = capacity._postgres_summary(samples, max_connections=100)
            item["containers"] = capacity._container_summary(
                samples,
                monitoring_errors=0,
                sampling_overruns=0,
            )

        def forge_prebaseline_deadlock(item: dict[str, object]) -> None:
            for sample in item["resourceSamples"]:
                sample["database"]["deadlocks"] = 1
            item["databaseCounterDeltas"] = capacity._database_counter_deltas(
                item["resourceSamples"]
            )

        def forge_prebaseline_container_restart(item: dict[str, object]) -> None:
            for sample in item["resourceSamples"]:
                sample["containers"]["backend"]["restartCount"] = 1
            item["containers"] = capacity._container_summary(
                item["resourceSamples"],
                monitoring_errors=0,
                sampling_overruns=0,
            )

        self.assertEqual(capacity.capacity_failures(report, thresholds), [])

        cases = (
            ("dirty", lambda item: item["metadata"]["candidate"].update(dirty=True), "CANDIDATE_DIRTY"),
            (
                "candidate commit evidence missing",
                remove_candidate_head,
                "CANDIDATE_PROVENANCE_INVALID",
            ),
            (
                "candidate tree evidence missing",
                lambda item: item["metadata"]["candidate"].pop("tree"),
                "CANDIDATE_PROVENANCE_INVALID",
            ),
            (
                "candidate branch evidence is unknown",
                lambda item: item["metadata"]["candidate"].update(branch="unknown"),
                "CANDIDATE_PROVENANCE_INVALID",
            ),
            (
                "candidate dirty evidence is not boolean",
                lambda item: item["metadata"]["candidate"].update(dirty="false"),
                "CANDIDATE_PROVENANCE_INVALID",
            ),
            (
                "candidate diff hash is malformed",
                lambda item: item["metadata"]["candidate"].update(workingDiffSha256="0"),
                "CANDIDATE_PROVENANCE_INVALID",
            ),
            (
                "clean candidate diff hash is not the empty diff hash",
                lambda item: item["metadata"]["candidate"].update(
                    workingDiffSha256="f" * 64
                ),
                "CANDIDATE_PROVENANCE_INVALID",
            ),
            (
                "candidate changed while the capacity profile was running",
                lambda item: item["metadata"]["candidateFinished"].update(head="f" * 40),
                "CANDIDATE_CHANGED_DURING_RUN",
            ),
            (
                "candidate tree changed while the capacity profile was running",
                lambda item: item["metadata"]["candidateFinished"].update(tree="f" * 40),
                "CANDIDATE_CHANGED_DURING_RUN",
            ),
            (
                "formal profile is internally consistent but downgraded to 1/2/1",
                forge_downgraded_formal_profile,
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "diagnostic smoke cannot claim formal acceptance",
                lambda item: item["config"].update(profileId="smoke"),
                "NON_FORMAL_CAPACITY_PROFILE",
            ),
            (
                "formal profile identifier is missing",
                lambda item: item["config"].pop("profileId"),
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal threshold evidence is missing",
                lambda item: item["config"].pop("thresholds"),
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal read p95 threshold is relaxed",
                lambda item: item["config"]["thresholds"].update(readP95Ms=50_000.0),
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal PostgreSQL headroom is relaxed",
                lambda item: item["config"]["thresholds"].update(postgresHeadroom=1),
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal PostgreSQL target is changed",
                forge_postgres_target,
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal PostgreSQL connection budget evidence is missing",
                lambda item: item["config"].pop("postgresConnectionBudget"),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal PostgreSQL connection budget required total is forged",
                lambda item: item["config"]["postgresConnectionBudget"].update(required=47),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal PostgreSQL connection budget hides the listener owner",
                lambda item: item["config"]["postgresConnectionBudget"].update(
                    notifyListenerPerBackendWorker=0
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal budget cannot preserve totals while shifting pool into overflow",
                forge_synchronized_pool_split,
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal budget cannot preserve totals while shifting frontend pool into headroom",
                forge_synchronized_frontend_headroom_split,
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal PostgreSQL capacity cannot be synchronously relabeled",
                forge_synchronized_postgres_capacity,
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "formal backend-per-process derivation is forged",
                lambda item: item["config"]["postgresConnectionBudget"].update(
                    backendPerProcess=17
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal backend deployment total is forged",
                lambda item: item["config"]["postgresConnectionBudget"].update(
                    backendTotal=17
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal Feishu reserve is forged",
                lambda item: item["config"]["postgresConnectionBudget"].update(
                    feishuWorkerReserve=14
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal listener evidence cannot use a boolean count",
                lambda item: item["config"]["postgresConnectionBudget"].update(
                    notifyListenerPerBackendWorker=True
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal listener evidence cannot use a floating-point count",
                lambda item: item["config"]["postgresConnectionBudget"].update(
                    notifyListenerPerBackendWorker=1.0
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal listener evidence cannot be omitted",
                lambda item: item["config"]["postgresConnectionBudget"].pop(
                    "notifyListenerPerBackendWorker"
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal connection budget cannot contain unreviewed fields",
                lambda item: item["config"]["postgresConnectionBudget"].update(
                    unreviewedReplicaCount=1
                ),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal resource sample interval is too slow",
                lambda item: item["config"].update(resourceSampleSeconds=10.0),
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "target resource envelope evidence is missing",
                lambda item: item["config"].pop("targetResourceEnvelope"),
                "FORMAL_CAPACITY_PROFILE_INVALID",
            ),
            (
                "container usage exceeds the 4-vCPU 3.32-GiB target envelope",
                exceed_target_resource_envelope,
                "TARGET_RESOURCE_ENVELOPE_EXCEEDED",
            ),
            (
                "local-only evidence is relabeled as cloud production",
                relabel_local_evidence_as_cloud,
                "LOCAL_EVIDENCE_BOUNDARY_INVALID",
            ),
            (
                "candidate image revision evidence is missing",
                lambda item: item["containerImageRevisions"].pop("frontend"),
                "CONTAINER_IMAGE_REVISION_MISMATCH",
            ),
            (
                "candidate image revision does not match the tested commit",
                lambda item: item["containerImageRevisions"].update(frontend="f" * 40),
                "CONTAINER_IMAGE_REVISION_MISMATCH",
            ),
            (
                "peak",
                lambda item: item["streams"].update(peakConcurrentReady=499),
                "SSE_PEAK_NOT_REACHED",
            ),
            (
                "requested stream count does not match the profile",
                lambda item: item["streams"].update(requested=1, ready=1),
                "SSE_REQUEST_COUNT_MISMATCH",
            ),
            (
                "steady stream profile is missing",
                lambda item: item["config"].pop("steadySse"),
                "STEADY_PROFILE_EVIDENCE_INVALID",
            ),
            (
                "steady stream profile is not internally valid",
                lambda item: item["config"].update(steadySse=500),
                "STEADY_PROFILE_EVIDENCE_INVALID",
            ),
            (
                "steady ready count does not match the profile",
                lambda item: item["streams"].update(steadyReady=1),
                "STEADY_PROFILE_EVIDENCE_INVALID",
            ),
            (
                "steady ramp configuration is missing",
                lambda item: item["config"].pop("rampSeconds"),
                "STEADY_PROFILE_EVIDENCE_INVALID",
            ),
            (
                "steady ramp timeline anchor is missing",
                lambda item: item["timeline"].pop("steadyRampStartedAtSeconds"),
                "TIMELINE_EVIDENCE_INCOMPLETE",
            ),
            (
                "steady ramp completes too quickly for the configured spread",
                lambda item: item["config"].update(rampSeconds=100.0),
                "STEADY_RAMP_TIMELINE_INVALID",
            ),
            (
                "steady ramp takes too long for the configured spread",
                lambda item: item["config"].update(rampSeconds=1.0),
                "STEADY_RAMP_TIMELINE_INVALID",
            ),
            (
                "fixture evidence missing",
                remove_fixture_evidence,
                "FIXTURE_EVIDENCE_INVALID",
            ),
            (
                "fixture evidence count mismatch",
                lambda item: item["fixture"].update(users=1, activeChannels=1),
                "FIXTURE_EVIDENCE_INVALID",
            ),
            (
                "fixture evidence uses booleans as counts",
                lambda item: item["fixture"].update(users=True, activeChannels=True),
                "FIXTURE_EVIDENCE_INVALID",
            ),
            (
                "zero load",
                lambda item: item["workload"].update(minCompletedCyclesPerUser=0, totalCycles=0),
                "ACTIVE_LOAD_INSUFFICIENT",
            ),
            (
                "task error",
                lambda item: item["workload"].update(activeTaskErrors=1),
                "ACTIVE_TASK_ERROR",
            ),
            (
                "count mismatch",
                lambda item: item["workload"].update(totalReads=10_799),
                "ACTIVE_LOAD_COUNT_MISMATCH",
            ),
            (
                "forged per-user aggregate",
                forge_workload_totals,
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "forged per-user minimum",
                forge_per_user_minimum,
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "duplicate per-user identity",
                duplicate_per_user_identity,
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "missing per-user evidence",
                remove_per_user_evidence,
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "per-user evidence has too few users",
                remove_one_user_cycle,
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "per-user identity falls outside configured range",
                use_out_of_range_user_index,
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "per-user cycle uses bool instead of integer evidence",
                lambda item: item["workload"]["perUserCycles"][0].update(cycles=True),
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "workload user count mismatch",
                lambda item: item["workload"].update(users=29),
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "target cycle formula mismatch",
                lambda item: item["workload"].update(targetCyclesPerUser=359),
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "minimum cycle formula mismatch",
                lambda item: item["workload"].update(minimumCyclesPerUser=358),
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "per-user maximum aggregate mismatch",
                lambda item: item["workload"].update(maxCompletedCyclesPerUser=999),
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "per-user minimum aggregate mismatch",
                lambda item: item["workload"].update(minCompletedCyclesPerUser=359),
                "ACTIVE_USER_CYCLE_EVIDENCE_INVALID",
            ),
            (
                "event mismatch",
                lambda item: item["events"].update(expected=10_799, received=10_799),
                "ACTIVE_EVENT_COUNT_MISMATCH",
            ),
            (
                "postgres config",
                lambda item: item["postgres"].update(maxConnections=99),
                "POSTGRES_MAX_CONNECTIONS_UNEXPECTED",
            ),
            (
                "backend runtime worker evidence is missing",
                lambda item: item["backendRuntime"].pop("workers"),
                "BACKEND_RUNTIME_EVIDENCE_INVALID",
            ),
            (
                "backend runtime differs from the expected profile",
                lambda item: item["backendRuntime"].update(workers=2),
                "BACKEND_RUNTIME_EVIDENCE_INVALID",
            ),
            (
                "backend runtime database pool differs from the reported budget",
                lambda item: item["backendRuntime"].update(databasePoolSize=6),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "backend runtime PostgreSQL capacity differs from the observed database",
                lambda item: item["backendRuntime"].update(postgresMaxConnections=99),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "frontend runtime pool differs from the reported budget",
                lambda item: item["frontendRuntime"].update(betterAuthDatabasePoolSize=9),
                "POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID",
            ),
            (
                "formal deployment shape omits optional-service evidence",
                lambda item: item.pop("optionalServiceRuntime"),
                "DEPLOYMENT_SHAPE_EVIDENCE_INVALID",
            ),
            (
                "formal deployment shape starts an unmeasured Feishu worker",
                lambda item: item["optionalServiceRuntime"].update(
                    feishuWorkerContainers=1
                ),
                "DEPLOYMENT_SHAPE_EVIDENCE_INVALID",
            ),
            (
                "duplicate PostgreSQL notify listener owners",
                lambda item: forge_postgres_relationship(item, notify_listeners=2),
                "POSTGRES_NOTIFY_LISTENER_OWNERS_UNEXPECTED",
            ),
            (
                "PostgreSQL notify listener exists only in the baseline sample",
                drop_notify_listener_after_baseline,
                "POSTGRES_NOTIFY_LISTENER_OWNERS_UNEXPECTED",
            ),
            (
                "PostgreSQL notify publisher connections exceed the configured pool budget",
                lambda item: forge_postgres_relationship(item, notify_publishers=3),
                "POSTGRES_NOTIFY_PUBLISHER_BUDGET_EXCEEDED",
            ),
            (
                "deadlock",
                lambda item: item["databaseCounterDeltas"].update(deadlocks=1),
                "DATABASE_DEADLOCK",
            ),
            (
                "database deadlock happened before the first resource sample",
                forge_prebaseline_deadlock,
                "DATABASE_DEADLOCK",
            ),
            (
                "database counters missing",
                lambda item: item.update(databaseCounterDeltas={}),
                "DATABASE_COUNTER_EVIDENCE_INCOMPLETE",
            ),
            (
                "database counter invalid type",
                lambda item: item["databaseCounterDeltas"].update(deadlocks="0"),
                "DATABASE_COUNTER_EVIDENCE_INCOMPLETE",
            ),
            (
                "database counter summary does not match raw samples",
                lambda item: item["databaseCounterDeltas"].update(xact_commit=999),
                "DATABASE_COUNTER_SUMMARY_MISMATCH",
            ),
            *(
                (
                    f"database counter {key} missing",
                    remove_database_counter(key),
                    "DATABASE_COUNTER_EVIDENCE_INCOMPLETE",
                )
                for key in capacity.DATABASE_COUNTER_FIELDS
            ),
            (
                "container incomplete",
                lambda item: item["containers"].update(complete=False),
                "CONTAINER_MONITORING_INCOMPLETE",
            ),
            (
                "container monitoring error",
                lambda item: item["containers"].update(monitoringErrors=1),
                "CONTAINER_MONITORING_FAILED",
            ),
            (
                "container coverage mismatch",
                lambda item: item["containers"]["sampleCoverage"].update(backend=1),
                "CONTAINER_MONITORING_INCOMPLETE",
            ),
            (
                "resource samples missing",
                remove_resource_samples,
                "RESOURCE_SAMPLE_EVIDENCE_MISSING",
            ),
            (
                "resource samples empty",
                lambda item: item.update(resourceSamples=[]),
                "RESOURCE_SAMPLE_EVIDENCE_MISSING",
            ),
            (
                "resource sample entry is not an object",
                lambda item: item["resourceSamples"].__setitem__(1, "not-a-sample"),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample database evidence is missing",
                lambda item: item["resourceSamples"][1].pop("database"),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample postgres counters are not strict integers",
                lambda item: item["resourceSamples"][1]["postgres"].update(total="8"),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample has more waiting work than active work",
                lambda item: forge_postgres_relationship(item, waiting=2),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample PostgreSQL states exceed total connections",
                lambda item: forge_postgres_relationship(item, active=7),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample observer count exceeds total connections",
                lambda item: forge_postgres_relationship(item, observers=9),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample cumulative deadlocks decrease",
                lambda item: item["resourceSamples"][50]["database"].update(deadlocks=1),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample cumulative commits decrease",
                lambda item: item["resourceSamples"][50]["database"].update(xact_commit=0),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "resource sample duration contradicts its timestamps",
                lambda item: item["resourceSamples"][1].update(sampleDurationSeconds=99.0),
                "RESOURCE_SAMPLE_EVIDENCE_INVALID",
            ),
            (
                "steady ramp head evidence is truncated",
                truncate_steady_ramp_head,
                "RESOURCE_SAMPLE_TIMELINE_INVALID",
            ),
            (
                "resource sample phase contradicts the formal timeline",
                forge_phase_timeline,
                "RESOURCE_SAMPLE_TIMELINE_INVALID",
            ),
            (
                "resource sampling gap is unbounded",
                forge_large_sample_gap,
                "CONTAINER_SAMPLING_GAP_EXCEEDED",
            ),
            (
                "resource sampling interval evidence is missing",
                lambda item: item["config"].pop("resourceSampleSeconds"),
                "RESOURCE_SAMPLE_CONFIG_INVALID",
            ),
            (
                "resource sampling interval evidence is not positive",
                lambda item: item["config"].update(resourceSampleSeconds=0.0),
                "RESOURCE_SAMPLE_CONFIG_INVALID",
            ),
            (
                "postgres summary does not match raw samples",
                lambda item: item["postgres"].update(peakConnections=89),
                "POSTGRES_SUMMARY_MISMATCH",
            ),
            (
                "container summary does not match raw samples",
                lambda item: item["containers"]["peak"]["backend"].update(pids=999),
                "CONTAINER_SUMMARY_MISMATCH",
            ),
            (
                "spike phase missing",
                remove_spike_phase,
                "CONTAINER_PHASE_COVERAGE_INCOMPLETE",
            ),
            (
                "baseline phase missing",
                lambda item: item["containers"]["phaseCoverage"].update(baseline=0),
                "CONTAINER_PHASE_COVERAGE_INCOMPLETE",
            ),
            (
                "steady phase family missing",
                remove_steady_phase,
                "CONTAINER_PHASE_COVERAGE_INCOMPLETE",
            ),
            (
                "spike phase has only one sample",
                lambda item: item["containers"]["phaseCoverage"].update(**{"spike-hold": 1}),
                "CONTAINER_PHASE_COVERAGE_INCOMPLETE",
            ),
            (
                "post-spike phase missing",
                lambda item: item["containers"]["phaseCoverage"].update(**{"post-spike": 0}),
                "CONTAINER_PHASE_COVERAGE_INCOMPLETE",
            ),
            (
                "cleanup phase has only one sample",
                lambda item: item["containers"]["phaseCoverage"].update(cleanup=1),
                "CONTAINER_PHASE_COVERAGE_INCOMPLETE",
            ),
            (
                "container restart",
                lambda item: item["containers"]["final"]["backend"].update(restartCount=1),
                "CONTAINER_RESTARTED",
            ),
            (
                "container restarted before the first resource sample",
                forge_prebaseline_container_restart,
                "CONTAINER_RESTARTED",
            ),
            (
                "intermediate container restart",
                lambda item: item["resourceSamples"][50]["containers"]["backend"].update(
                    restartCount=1
                ),
                "CONTAINER_RESTARTED",
            ),
            (
                "container oom",
                lambda item: item["containers"]["final"]["backend"].update(oomKilled=True),
                "CONTAINER_OOM_KILLED",
            ),
            (
                "intermediate container oom",
                lambda item: item["resourceSamples"][50]["containers"]["backend"].update(
                    oomKilled=True
                ),
                "CONTAINER_OOM_KILLED",
            ),
            (
                "container stopped",
                lambda item: item["containers"]["final"]["backend"].update(running=False),
                "CONTAINER_NOT_RUNNING",
            ),
            (
                "intermediate container stopped",
                lambda item: item["resourceSamples"][50]["containers"]["backend"].update(
                    running=False
                ),
                "CONTAINER_NOT_RUNNING",
            ),
            (
                "intermediate container identity changed",
                lambda item: item["resourceSamples"][50]["containers"]["backend"].update(
                    containerId="replacement-backend"
                ),
                "CONTAINER_ID_CHANGED",
            ),
            (
                "intermediate container image changed",
                lambda item: item["resourceSamples"][50]["containers"]["backend"].update(
                    imageId="sha256:replacement-backend"
                ),
                "CONTAINER_IMAGE_CHANGED",
            ),
            (
                "stream cleanup",
                lambda item: item["cleanup"].update(currentReadyStreams=1),
                "CLIENT_STREAM_CLEANUP_FAILED",
            ),
            (
                "short workload",
                lambda item: item["timeline"].update(workloadObservedSeconds=1_799.0),
                "WORKLOAD_DURATION_INSUFFICIENT",
            ),
            (
                "short spike",
                lambda item: item["timeline"].update(spikePeakHoldSeconds=59.0),
                "SPIKE_HOLD_INSUFFICIENT",
            ),
            (
                "short cleanup",
                lambda item: item["cleanup"].update(observedSeconds=59.0),
                "CLEANUP_OBSERVATION_INSUFFICIENT",
            ),
            (
                "cleanup recovery marker missing",
                remove_cleanup_recovery,
                "CLEANUP_NOT_RECOVERED",
            ),
            (
                "cleanup final connection mismatch",
                lambda item: item["cleanup"].update(finalConnections=9),
                "CLEANUP_NOT_RECOVERED",
            ),
            (
                "cleanup recovery marker is negative",
                lambda item: item["cleanup"].update(recoveredAtSeconds=-1.0),
                "CLEANUP_NOT_RECOVERED",
            ),
            (
                "cleanup recovery marker is non-finite",
                lambda item: item["cleanup"].update(recoveredAtSeconds=float("nan")),
                "CLEANUP_NOT_RECOVERED",
            ),
            (
                "cleanup recovery marker falls outside observation",
                lambda item: item["cleanup"].update(recoveredAtSeconds=999.0),
                "CLEANUP_NOT_RECOVERED",
            ),
            (
                "timeline anchor missing",
                remove_timeline_anchor,
                "TIMELINE_EVIDENCE_INCOMPLETE",
            ),
            (
                "timeline order invalid",
                lambda item: item["timeline"].update(cleanupStartedAtSeconds=1_850.0),
                "TIMELINE_ORDER_INVALID",
            ),
            (
                "spike start offset invalid",
                lambda item: item["timeline"].update(spikeRampStartedAtSeconds=640.0),
                "SPIKE_TIMELINE_INVALID",
            ),
            (
                "spike ramp too long",
                lambda item: item["timeline"].update(spikePeakReadyAtSeconds=683.1),
                "SPIKE_TIMELINE_INVALID",
            ),
            (
                "spike ramp too short",
                lambda item: item["timeline"].update(spikePeakReadyAtSeconds=659.0),
                "SPIKE_TIMELINE_INVALID",
            ),
            (
                "timeline anchor is non-finite",
                lambda item: item["timeline"].update(workloadEndedAtSeconds=float("inf")),
                "TIMELINE_EVIDENCE_INCOMPLETE",
            ),
            (
                "steady ready occurs after workload start",
                lambda item: item["timeline"].update(steadyReadyAtSeconds=63.0),
                "TIMELINE_ORDER_INVALID",
            ),
            (
                "report schema version missing",
                remove_schema_version,
                "REPORT_SCHEMA_UNSUPPORTED",
            ),
            (
                "request timeout evidence missing",
                remove_request_timeout,
                "REQUEST_TIMEOUT_EVIDENCE_MISSING",
            ),
            (
                "request timeout evidence is not positive",
                lambda item: item["config"].update(requestTimeoutSeconds=0.0),
                "REQUEST_TIMEOUT_EVIDENCE_MISSING",
            ),
            (
                "stream latency evidence missing",
                remove_stream_latency,
                "LATENCY_EVIDENCE_INCOMPLETE",
            ),
            (
                "HTTP latency evidence missing",
                lambda item: item["http"]["read"].pop("latencyMs"),
                "LATENCY_EVIDENCE_INCOMPLETE",
            ),
            (
                "event latency evidence missing",
                lambda item: item["events"].pop("deliveryLatencyMs"),
                "LATENCY_EVIDENCE_INCOMPLETE",
            ),
            (
                "latency count does not match successful measurements",
                lambda item: item["http"]["write"]["latencyMs"].update(count=1),
                "LATENCY_EVIDENCE_INCOMPLETE",
            ),
            (
                "latency percentiles are not ordered",
                lambda item: item["events"]["deliveryLatencyMs"].update(p95=101.0, p99=99.0),
                "LATENCY_EVIDENCE_INCOMPLETE",
            ),
        )
        for name, mutate, expected in cases:
            with self.subTest(name=name):
                broken = copy.deepcopy(report)
                mutate(broken)
                self.assertIn(expected, capacity.capacity_failures(broken, thresholds))

    def test_capacity_failures_rejects_non_object_reports_without_raising(self) -> None:
        for report in (None, [], "report", 3, True):
            with self.subTest(report=report):
                self.assertEqual(
                    capacity.capacity_failures(report, capacity.Thresholds()),
                    ["REPORT_EVIDENCE_INVALID"],
                )

    def test_stored_report_recomputes_acceptance_instead_of_trusting_summary(
        self,
    ) -> None:
        report = _passing_report()
        report["acceptance"] = {"passed": True, "failures": []}

        self.assertEqual(capacity.stored_capacity_report_failures(report), [])

        report["config"]["postgresConnectionBudget"]["required"] = 47
        failures = capacity.stored_capacity_report_failures(report)

        self.assertIn("POSTGRES_CONNECTION_BUDGET_EVIDENCE_INVALID", failures)
        self.assertIn("ACCEPTANCE_SUMMARY_MISMATCH", failures)

        valid_evidence_with_forged_failure = _passing_report()
        valid_evidence_with_forged_failure["acceptance"] = {
            "passed": False,
            "failures": ["FORGED_FAILURE"],
        }
        self.assertEqual(
            capacity.stored_capacity_report_failures(
                valid_evidence_with_forged_failure
            ),
            ["ACCEPTANCE_SUMMARY_MISMATCH"],
        )

    def test_resource_sample_records_start_finish_and_duration(self) -> None:
        class FakeConnection:
            async def fetchrow(self, query: str) -> dict[str, int]:
                if "pg_stat_activity" in query:
                    return {
                        "total": 8,
                        "active": 1,
                        "idle": 7,
                        "idle_in_transaction": 0,
                        "waiting": 0,
                        "notify_publishers": 1,
                        "notify_listeners": 1,
                        "observers": 1,
                    }
                return {"xact_commit": 10, "xact_rollback": 2, "deadlocks": 0, "temp_bytes": 0}

        monitor = capacity.ResourceMonitor(
            SimpleNamespace(
                target=SimpleNamespace(database_url="unused"),
                backend_pid=None,
                resource_sample_seconds=5.0,
            )
        )
        monitor.connection = FakeConnection()
        monitor.container_ids = {
            service: f"container-{service}" for service in capacity.CORE_COMPOSE_SERVICES
        }
        states = {service: _container_state(service) for service in capacity.CORE_COMPOSE_SERVICES}
        stats = {
            service: {
                key: value
                for key, value in _container_observation(service).items()
                if key not in states[service]
            }
            for service in capacity.CORE_COMPOSE_SERVICES
        }

        with (
            patch.object(capacity, "inspect_container_states", return_value=states),
            patch.object(capacity, "sample_docker_stats", return_value=stats),
            patch.object(capacity, "process_snapshot", return_value={}),
        ):
            sample = asyncio.run(monitor.sample("baseline"))

        self.assertIsNotNone(sample)
        self.assertGreaterEqual(sample["sampleStartedElapsedSeconds"], 0.0)
        self.assertGreaterEqual(
            sample["sampleFinishedElapsedSeconds"],
            sample["sampleStartedElapsedSeconds"],
        )
        self.assertGreaterEqual(sample["sampleDurationSeconds"], 0.0)

    def test_resource_monitor_uses_fixed_start_to_start_deadlines(self) -> None:
        class FakeClock:
            now = 0.0

            def monotonic(self) -> float:
                return self.now

        clock = FakeClock()
        stop_event = asyncio.Event()
        waits: list[float] = []

        class FakeMonitor:
            config = SimpleNamespace(resource_sample_seconds=5.0)
            sampling_overruns = 0

            def __init__(self) -> None:
                self.sample_times: list[float] = []

            async def sample(self, phase: str) -> dict[str, object]:
                self.sample_times.append(clock.now)
                clock.now += 2.0
                if len(self.sample_times) == 3:
                    stop_event.set()
                return {"phase": phase}

        async def wait_or_stop(event: asyncio.Event, seconds: float) -> bool:
            waits.append(seconds)
            clock.now += seconds
            return event.is_set()

        monitor = FakeMonitor()
        asyncio.run(
            capacity.monitor_loop(
                monitor,
                {"name": "steady"},
                stop_event,
                monotonic=clock.monotonic,
                wait_or_stop=wait_or_stop,
            )
        )

        self.assertEqual(monitor.sample_times, [0.0, 5.0, 10.0])
        self.assertEqual(waits, [3.0, 3.0])
        self.assertEqual(monitor.sampling_overruns, 0)

    def test_resource_monitor_counts_overruns_without_extra_sleep(self) -> None:
        class FakeClock:
            now = 0.0

            def monotonic(self) -> float:
                return self.now

        clock = FakeClock()
        stop_event = asyncio.Event()
        waits: list[float] = []

        class FakeMonitor:
            config = SimpleNamespace(resource_sample_seconds=5.0)
            sampling_overruns = 0

            def __init__(self) -> None:
                self.sample_times: list[float] = []

            async def sample(self, phase: str) -> dict[str, object]:
                self.sample_times.append(clock.now)
                clock.now += 7.0
                if len(self.sample_times) == 3:
                    stop_event.set()
                return {"phase": phase}

        async def wait_or_stop(event: asyncio.Event, seconds: float) -> bool:
            waits.append(seconds)
            clock.now += seconds
            return event.is_set()

        monitor = FakeMonitor()
        asyncio.run(
            capacity.monitor_loop(
                monitor,
                {"name": "steady"},
                stop_event,
                monotonic=clock.monotonic,
                wait_or_stop=wait_or_stop,
            )
        )

        self.assertEqual(monitor.sample_times, [0.0, 7.0, 14.0])
        self.assertEqual(waits, [])
        self.assertEqual(monitor.sampling_overruns, 3)

    def test_cleanup_observes_the_full_window_after_early_recovery(self) -> None:
        class FakeClock:
            now = 0.0

            def monotonic(self) -> float:
                return self.now

            async def sleep(self, seconds: float) -> None:
                self.now += seconds

        clock = FakeClock()

        class FakeMonitor:
            config = SimpleNamespace(cleanup_timeout_seconds=60.0, resource_sample_seconds=5.0)
            sampling_overruns = 0

            def __init__(self) -> None:
                self.sample_times: list[float] = []

            async def sample(self, phase: str) -> dict[str, object]:
                self.sample_times.append(clock.now)
                clock.now += 2.0
                return {
                    "phase": phase,
                    "postgres": {"total": 8},
                    "process": {"fileDescriptors": 10},
                }

        monitor = FakeMonitor()
        result = asyncio.run(
            capacity._observe_cleanup(
                monitor,
                baseline_connections=8,
                baseline_file_descriptors=10,
                monotonic=clock.monotonic,
                sleeper=clock.sleep,
            )
        )

        self.assertEqual(result["recoveredAtSeconds"], 2.0)
        self.assertEqual(result["observedSeconds"], 62.0)
        self.assertEqual(result["finalConnections"], 8)
        self.assertEqual(monitor.sample_times, [float(value) for value in range(0, 61, 5)])
        self.assertEqual(monitor.sampling_overruns, 0)

    def test_cleanup_sampling_does_not_sleep_an_extra_interval_after_overrun(self) -> None:
        class FakeClock:
            now = 0.0

            def monotonic(self) -> float:
                return self.now

            async def sleep(self, seconds: float) -> None:
                self.now += seconds

        clock = FakeClock()

        class FakeMonitor:
            config = SimpleNamespace(
                cleanup_timeout_seconds=16.0,
                resource_sample_seconds=5.0,
                thresholds=capacity.Thresholds(),
            )
            sampling_overruns = 0

            def __init__(self) -> None:
                self.sample_times: list[float] = []

            async def sample(self, phase: str) -> dict[str, object]:
                self.sample_times.append(clock.now)
                clock.now += 6.0
                return {
                    "phase": phase,
                    "postgres": {"total": 8},
                    "process": {"fileDescriptors": 10},
                }

        monitor = FakeMonitor()
        result = asyncio.run(
            capacity._observe_cleanup(
                monitor,
                baseline_connections=8,
                baseline_file_descriptors=10,
                monotonic=clock.monotonic,
                sleeper=clock.sleep,
            )
        )

        self.assertEqual(monitor.sample_times, [0.0, 6.0, 12.0])
        self.assertEqual(result["observedSeconds"], 18.0)
        self.assertEqual(monitor.sampling_overruns, 3)

    def test_evidence_metadata_records_secret_presence_without_secret_values(self) -> None:
        metadata = capacity.evidence_metadata(
            namespace="audit-local",
            public_api_key="capacity-public-secret",
            auth_bridge_secret="capacity-bridge-secret",
        )
        encoded = json.dumps(metadata)

        self.assertTrue(metadata["secrets"]["publicApiKeyPresent"])
        self.assertTrue(metadata["secrets"]["authBridgeSecretPresent"])
        self.assertNotIn("capacity-public-secret", encoded)
        self.assertNotIn("capacity-bridge-secret", encoded)

    def test_report_configuration_and_container_evidence_never_serialize_secrets(self) -> None:
        args = capacity.parse_args(["--output", "/tmp/local-capacity.json"])
        config = capacity.load_config(
            args,
            {
                "API_BASE": "http://127.0.0.1:19081",
                "CAPACITY_DATABASE_URL": (
                    "postgresql://audit:database-password-secret@localhost:55436/audit_capacity"
                ),
                "CAPACITY_DATABASE_SCOPE": "disposable",
                "CAPACITY_RUN_NAMESPACE": "audit-local",
                "CAPACITY_COMPOSE_PROJECT": "smallkhoj-audit-capacity-final",
                "CAPACITY_EXPECTED_POSTGRES_MAX_CONNECTIONS": "100",
                "DATABASE_POOL_SIZE": "5",
                "DATABASE_MAX_OVERFLOW": "10",
                "BETTER_AUTH_DATABASE_POOL_SIZE": "10",
                "BACKEND_WORKERS": "1",
                "NOTIFY_PUBLISHER_POOL_SIZE": "2",
                "POSTGRES_CONNECTION_HEADROOM": "5",
                "PUBLIC_API_KEY": "capacity-public-secret",
                "AUTH_BRIDGE_SECRET": "capacity-bridge-secret",
            },
        )
        evidence = {
            "metadata": capacity.evidence_metadata(
                namespace=config.namespace,
                public_api_key=config.public_api_key,
                auth_bridge_secret=config.auth_bridge_secret,
            ),
            "config": capacity._config_evidence(config),
            "containers": _passing_report()["containers"],
        }
        encoded = json.dumps(evidence)

        self.assertNotIn("database-password-secret", encoded)
        self.assertNotIn("capacity-public-secret", encoded)
        self.assertNotIn("capacity-bridge-secret", encoded)
        self.assertNotIn("Config.Env", encoded)
        self.assertEqual(evidence["config"]["requestTimeoutSeconds"], 20.0)
        self.assertEqual(evidence["config"]["expectedBackendWorkers"], 1)
        self.assertEqual(evidence["config"]["expectedNotifyPublisherPoolSize"], 2)

    def test_report_does_not_claim_external_fixture_cleanup_before_down_v(self) -> None:
        source = (Path(__file__).resolve().parents[1] / "local_capacity_probe.py").read_text()

        self.assertIn(
            "Fixture cleanup is external and remains pending until the scoped Compose ",
            source,
        )
        self.assertNotIn("Fixture rows are removed by tearing down", source)

    def test_metric_recorder_separates_non_2xx_from_transport_errors(self) -> None:
        metric = capacity.MetricRecorder()
        metric.record(status=200, latency_ms=100.0)
        metric.record(status=503, latency_ms=250.0)
        metric.record_error("ReadTimeout")

        summary = metric.summary()

        self.assertEqual(summary["requests"], 3)
        self.assertEqual(summary["successes"], 1)
        self.assertEqual(summary["non2xx"], 1)
        self.assertEqual(summary["errors"], 1)
        self.assertEqual(summary["errorTypes"], {"ReadTimeout": 1})
        self.assertEqual(summary["latencyMs"]["p95"], 250.0)

    def test_event_ledger_detects_missing_duplicate_wrong_scope_and_unexpected(self) -> None:
        ledger = capacity.EventLedger()
        ledger.expect("trace-1", user_index=1, started_at=10.0)
        ledger.expect("trace-2", user_index=2, started_at=20.0)
        ledger.receive("trace-1", user_index=1, received_at=10.2)
        ledger.receive("trace-1", user_index=1, received_at=10.3)
        ledger.receive("trace-2", user_index=99, received_at=20.2)
        ledger.receive("trace-unexpected", user_index=1, received_at=30.0)

        summary = ledger.summary()

        self.assertEqual(summary["expected"], 2)
        self.assertEqual(summary["missing"], 1)
        self.assertEqual(summary["duplicates"], 1)
        self.assertEqual(summary["wrongScope"], 1)
        self.assertEqual(summary["unexpected"], 1)
        self.assertEqual(summary["deliveryLatencyMs"]["p95"], 200.0)

    def test_config_requires_secrets_and_a_valid_spike_window(self) -> None:
        args = capacity.parse_args(
            [
                "--profile",
                "smoke",
                "--duration-seconds",
                "120",
                "--spike-at-seconds",
                "60",
                "--spike-duration-seconds",
                "15",
                "--output",
                "/tmp/local-capacity.json",
            ]
        )
        env = {
            "API_BASE": "http://127.0.0.1:18000",
            "CAPACITY_DATABASE_URL": "postgresql://audit:ephemeral@localhost:55434/audit_ci",
            "CAPACITY_DATABASE_SCOPE": "disposable",
            "CAPACITY_RUN_NAMESPACE": "audit-local",
            "CAPACITY_COMPOSE_PROJECT": "smallkhoj-audit-capacity-final",
            "CAPACITY_EXPECTED_POSTGRES_MAX_CONNECTIONS": "100",
            "DATABASE_POOL_SIZE": "5",
            "DATABASE_MAX_OVERFLOW": "10",
            "BETTER_AUTH_DATABASE_POOL_SIZE": "10",
            "BACKEND_WORKERS": "1",
            "NOTIFY_PUBLISHER_POOL_SIZE": "2",
            "POSTGRES_CONNECTION_HEADROOM": "5",
            "PUBLIC_API_KEY": "capacity-public-secret",
            "AUTH_BRIDGE_SECRET": "capacity-bridge-secret",
        }

        config = capacity.load_config(args, env)

        self.assertEqual(config.fixture_users, 500)
        self.assertEqual(config.namespace, "audit-local")
        self.assertEqual(config.target.database_name, "audit_ci")
        self.assertEqual(config.compose_project, "smallkhoj-audit-capacity-final")
        self.assertEqual(config.expected_postgres_max_connections, 100)
        self.assertEqual(config.expected_backend_workers, 1)
        self.assertEqual(config.expected_notify_publisher_pool_size, 2)
        self.assertEqual(config.expected_database_pool_size, 5)
        self.assertEqual(config.expected_database_max_overflow, 10)
        self.assertEqual(config.expected_better_auth_database_pool_size, 10)
        self.assertEqual(config.expected_postgres_connection_headroom, 5)
        self.assertEqual(config.backend_connections_per_process, 18)
        self.assertEqual(config.backend_deployment_connections, 18)
        self.assertEqual(config.feishu_worker_reserve, 15)
        self.assertEqual(config.required_postgres_connections, 48)
        self.assertEqual(
            config.postgres_connection_budget["notifyListenerPerBackendWorker"],
            1,
        )
        self.assertEqual(config.request_timeout_seconds, 20.0)

        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(args, {**env, "AUTH_BRIDGE_SECRET": ""})
        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(args, {**env, "BACKEND_WORKERS": ""})
        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(args, {**env, "NOTIFY_PUBLISHER_POOL_SIZE": "0"})
        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(args, {**env, "DATABASE_MAX_OVERFLOW": "-1"})
        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(
                args,
                {
                    **env,
                    "DATABASE_POOL_SIZE": "80",
                    "DATABASE_MAX_OVERFLOW": "20",
                },
            )
        zero_overflow = capacity.load_config(
            args,
            {**env, "DATABASE_MAX_OVERFLOW": "0"},
        )
        self.assertEqual(zero_overflow.backend_connections_per_process, 8)
        self.assertEqual(zero_overflow.feishu_worker_reserve, 5)
        self.assertEqual(zero_overflow.required_postgres_connections, 28)

        three_workers = capacity.load_config(
            args,
            {**env, "BACKEND_WORKERS": "3"},
        )
        self.assertEqual(three_workers.backend_deployment_connections, 54)
        self.assertEqual(three_workers.required_postgres_connections, 84)
        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(
                args,
                {
                    **env,
                    "BACKEND_WORKERS": "3",
                    "CAPACITY_EXPECTED_POSTGRES_MAX_CONNECTIONS": "83",
                },
            )

        for name in (
            "DATABASE_POOL_SIZE",
            "DATABASE_MAX_OVERFLOW",
            "BETTER_AUTH_DATABASE_POOL_SIZE",
            "POSTGRES_CONNECTION_HEADROOM",
        ):
            with self.subTest(missing=name), self.assertRaises(capacity.SafetyError):
                capacity.load_config(args, {**env, name: ""})
            with self.subTest(non_integer=name), self.assertRaises(
                capacity.SafetyError
            ):
                capacity.load_config(args, {**env, name: "not-an-integer"})
        for name in (
            "DATABASE_POOL_SIZE",
            "BETTER_AUTH_DATABASE_POOL_SIZE",
            "POSTGRES_CONNECTION_HEADROOM",
        ):
            with self.subTest(non_positive=name), self.assertRaises(
                capacity.SafetyError
            ):
                capacity.load_config(args, {**env, name: "0"})
        invalid_args = argparse.Namespace(**{**vars(args), "spike_at_seconds": 119.0})
        with self.assertRaises(capacity.SafetyError):
            capacity.load_config(invalid_args, env)

        numeric_fields = (
            "steady_sse",
            "spike_total_sse",
            "active_users",
            "active_cycle_seconds",
            "duration_seconds",
            "ramp_seconds",
            "spike_at_seconds",
            "spike_ramp_seconds",
            "spike_duration_seconds",
            "cleanup_timeout_seconds",
            "connect_timeout_seconds",
            "request_timeout_seconds",
            "resource_sample_seconds",
            "fixture_concurrency",
            "sse_ready_p95_ms",
            "read_p95_ms",
            "write_p95_ms",
            "event_delivery_p95_ms",
            "postgres_headroom",
        )
        for field in numeric_fields:
            for invalid_value in (float("nan"), float("inf"), -float("inf"), True):
                with self.subTest(field=field, invalid_value=invalid_value), self.assertRaises(
                    capacity.SafetyError
                ):
                    capacity.load_config(
                        argparse.Namespace(**{**vars(args), field: invalid_value}),
                        env,
                    )


if __name__ == "__main__":
    unittest.main()
