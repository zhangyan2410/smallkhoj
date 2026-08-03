from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).with_name("cleanup.py")
SPEC = importlib.util.spec_from_file_location("smallkhoj_cleanup", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot load {MODULE_PATH}")
cleanup = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cleanup
SPEC.loader.exec_module(cleanup)


UTC = timezone.utc
NOW = datetime(2026, 8, 3, 12, 0, tzinfo=UTC)
NOW_NS = int(NOW.timestamp() * 1_000_000_000)


def set_age(path: Path, *, hours: float) -> None:
    timestamp_ns = NOW_NS - int(hours * 3_600_000_000_000)
    os.utime(path, ns=(timestamp_ns, timestamp_ns), follow_symlinks=False)


def make_log(root: Path, name: str = "candidate.log", size: int = 1024) -> Path:
    log_dir = root / ".dev-logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / name
    with path.open("wb") as handle:
        handle.truncate(size)
    return path


def make_cache(root: Path) -> Path:
    cache = root / "frontend" / ".next" / "dev" / "cache" / "turbopack"
    cache.mkdir(parents=True)
    (cache / "chunks.bin").write_bytes(b"cache-data")
    return cache


def age_cache(cache: Path, *, hours: float) -> None:
    for path in sorted(cache.rglob("*"), reverse=True):
        set_age(path, hours=hours)
    set_age(cache, hours=hours)


def worktree_evidence(root: Path, **overrides):
    values = {
        "path": str(root.resolve()),
        "dirty": False,
        "active_frontend": False,
        "ownership_available": True,
    }
    values.update(overrides)
    return cleanup.WorktreeEvidence(**values)


def repository_identity(root: Path) -> dict:
    common = root / ".git-common"
    common.mkdir(exist_ok=True)
    return {
        "requestedRoot": str(root.resolve()),
        "commonDir": str(common.resolve()),
        "head": "a" * 40,
        "branch": "main",
    }


def closed_probe(_path: Path, _recursive: bool) -> object:
    return cleanup.OpenCheck("closed")


class LogPolicyTests(unittest.TestCase):
    def test_large_log_at_24_hour_boundary_is_eligible(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log = make_log(root, size=cleanup.LARGE_LOG_BYTES)
            set_age(log, hours=24)

            finding = cleanup.classify_log(
                log,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(finding["status"], "eligible")
            self.assertIn("large-log-stale", finding["reasonCodes"])
            self.assertTrue(log.exists(), "audit classification must not delete")

    def test_small_log_at_14_day_boundary_is_eligible(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log = make_log(root)
            set_age(log, hours=14 * 24)

            finding = cleanup.classify_log(
                log,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(finding["status"], "eligible")
            self.assertIn("old-log", finding["reasonCodes"])

    def test_recent_log_is_normal_and_dirty_worktree_does_not_change_file_policy(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log = make_log(root)
            set_age(log, hours=2)

            finding = cleanup.classify_log(
                log,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(finding["status"], "normal")
            self.assertTrue(log.exists())

            set_age(log, hours=14 * 24)
            eligible = cleanup.classify_log(
                log,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )
            self.assertEqual(eligible["status"], "eligible")

    def test_open_and_unverifiable_logs_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log = make_log(root, size=cleanup.LARGE_LOG_BYTES)
            set_age(log, hours=48)

            active = cleanup.classify_log(
                log,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("open", "pid-present"),
            )
            blocked = cleanup.classify_log(
                log,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("unavailable", "lsof-missing"),
            )

            self.assertEqual(active["status"], "active")
            self.assertEqual(blocked["status"], "blocked")

    def test_symlink_and_path_escape_are_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "worktree"
            outside = Path(tmp) / "outside.log"
            root.mkdir()
            outside.write_text("outside", encoding="utf-8")
            log_dir = root / ".dev-logs"
            log_dir.mkdir()
            link = log_dir / "linked.log"
            link.symlink_to(outside)

            linked = cleanup.classify_log(
                link,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )
            escaped = cleanup.classify_log(
                outside,
                root,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(linked["status"], "blocked")
            self.assertIn("symlink", linked["reasonCodes"])
            self.assertEqual(escaped["status"], "blocked")
            self.assertIn("path-not-allowlisted", escaped["reasonCodes"])


class CachePolicyTests(unittest.TestCase):
    def test_clean_inactive_exact_cache_is_eligible(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = make_cache(root)
            age_cache(cache, hours=24)

            finding = cleanup.classify_cache(
                cache,
                worktree_evidence(root),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(finding["status"], "eligible")
            self.assertIn("inactive-turbopack-cache", finding["reasonCodes"])

    def test_dirty_active_and_missing_ownership_states_are_protected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = make_cache(root)
            age_cache(cache, hours=48)

            dirty = cleanup.classify_cache(
                cache,
                worktree_evidence(root, dirty=True),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )
            active = cleanup.classify_cache(
                cache,
                worktree_evidence(root, active_frontend=True),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )
            unknown = cleanup.classify_cache(
                cache,
                worktree_evidence(root, ownership_available=False),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(dirty["status"], "report_only")
            self.assertEqual(active["status"], "active")
            self.assertEqual(unknown["status"], "blocked")

    def test_newest_descendant_mtime_controls_cache_age(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = make_cache(root)
            age_cache(cache, hours=48)
            child = cache / "chunks.bin"
            set_age(child, hours=1)

            finding = cleanup.classify_cache(
                cache,
                worktree_evidence(root),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(finding["status"], "normal")
            self.assertIn("cache-too-recent", finding["reasonCodes"])

    def test_nested_symlink_and_wrong_suffix_are_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = make_cache(root)
            (cache / "escape").symlink_to(Path(tmp) / "outside")
            set_age(cache, hours=48)

            linked = cleanup.classify_cache(
                cache,
                worktree_evidence(root),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )
            wrong = root / "frontend" / ".next" / "cache" / "turbopack"
            wrong.mkdir(parents=True)
            set_age(wrong, hours=48)
            wrong_suffix = cleanup.classify_cache(
                wrong,
                worktree_evidence(root),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )

            self.assertEqual(linked["status"], "blocked")
            self.assertIn("tree-symlink", linked["reasonCodes"])
            self.assertEqual(wrong_suffix["status"], "blocked")
            self.assertIn("path-not-allowlisted", wrong_suffix["reasonCodes"])

    def test_unavailable_open_check_blocks_otherwise_eligible_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            cache = make_cache(root)
            age_cache(cache, hours=48)

            finding = cleanup.classify_cache(
                cache,
                worktree_evidence(root),
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("unavailable", "lsof-missing"),
            )

            self.assertEqual(finding["status"], "blocked")
            self.assertIn("open-check-unavailable", finding["reasonCodes"])


class PlanAndApplyTests(unittest.TestCase):
    def eligible_log_finding(
        self, root: Path, name: str = "candidate.log"
    ) -> tuple[Path, dict]:
        log = make_log(root, name=name, size=cleanup.LARGE_LOG_BYTES)
        set_age(log, hours=48)
        finding = cleanup.classify_log(
            log,
            root,
            now_ns=NOW_NS,
            open_check=cleanup.OpenCheck("closed"),
        )
        self.assertEqual(finding["status"], "eligible")
        return log, finding

    def test_plan_id_detects_tampering_and_expiry(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _log, finding = self.eligible_log_finding(root)
            plan = cleanup.build_plan(
                repository_identity(root), [finding], created_at=NOW
            )

            cleanup.validate_plan_integrity(plan, now=NOW + timedelta(minutes=1))
            tampered = json.loads(json.dumps(plan))
            tampered["candidates"][0]["bytes"] += 1
            with self.assertRaises(cleanup.PlanError):
                cleanup.validate_plan_integrity(
                    tampered, now=NOW + timedelta(minutes=1)
                )
            with self.assertRaises(cleanup.PlanError):
                cleanup.validate_plan_integrity(plan, now=NOW + timedelta(hours=2))

    def test_confirmation_mismatch_never_deletes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log, finding = self.eligible_log_finding(root)
            identity = repository_identity(root)
            plan = cleanup.build_plan(identity, [finding], created_at=NOW)

            with self.assertRaises(cleanup.ConfirmationError):
                cleanup.apply_plan_data(
                    plan,
                    confirmation="wrong-plan-id",
                    repository=identity,
                    worktrees={str(root.resolve()): worktree_evidence(root)},
                    open_probe=closed_probe,
                    now=NOW + timedelta(minutes=1),
                )

            self.assertTrue(log.exists())

    def test_path_escape_is_rejected_even_with_recomputed_plan_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            root = base / "worktree"
            root.mkdir()
            outside = base / "outside.log"
            outside.write_text("keep", encoding="utf-8")
            set_age(outside, hours=48)
            identity = repository_identity(root)
            candidate = {
                "category": "inactive-log",
                "path": str(outside.resolve()),
                "worktree": str(root.resolve()),
                "bytes": outside.stat().st_size,
                "reasonCodes": ["old-log"],
                "fingerprint": cleanup.fingerprint_path(outside),
            }
            plan = cleanup.build_plan_from_candidates(
                identity, [candidate], created_at=NOW
            )

            with self.assertRaises(cleanup.SafetyError):
                cleanup.apply_plan_data(
                    plan,
                    confirmation=plan["planId"],
                    repository=identity,
                    worktrees={str(root.resolve()): worktree_evidence(root)},
                    open_probe=closed_probe,
                    now=NOW + timedelta(minutes=1),
                )
            self.assertTrue(outside.exists())

    def test_all_before_any_preflight_stops_on_late_drift(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first, first_finding = self.eligible_log_finding(root, "first.log")
            second, second_finding = self.eligible_log_finding(root, "second.log")
            identity = repository_identity(root)
            plan = cleanup.build_plan(
                identity, [first_finding, second_finding], created_at=NOW
            )
            second.write_bytes(b"changed after audit")

            with self.assertRaises(cleanup.SafetyError):
                cleanup.apply_plan_data(
                    plan,
                    confirmation=plan["planId"],
                    repository=identity,
                    worktrees={str(root.resolve()): worktree_evidence(root)},
                    open_probe=closed_probe,
                    now=NOW + timedelta(minutes=1),
                )

            self.assertTrue(
                first.exists(),
                "first candidate must survive failed all-before-any preflight",
            )
            self.assertTrue(second.exists())

    def test_successful_fixture_apply_deletes_only_planned_log_and_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log, log_finding = self.eligible_log_finding(root)
            cache = make_cache(root)
            age_cache(cache, hours=48)
            evidence = worktree_evidence(root)
            cache_finding = cleanup.classify_cache(
                cache,
                evidence,
                now_ns=NOW_NS,
                open_check=cleanup.OpenCheck("closed"),
            )
            keep = root / "source.txt"
            keep.write_text("keep", encoding="utf-8")
            identity = repository_identity(root)
            plan = cleanup.build_plan(
                identity, [log_finding, cache_finding], created_at=NOW
            )

            result = cleanup.apply_plan_data(
                plan,
                confirmation=plan["planId"],
                repository=identity,
                worktrees={str(root.resolve()): evidence},
                open_probe=closed_probe,
                now=NOW + timedelta(minutes=1),
            )

            self.assertFalse(log.exists())
            self.assertFalse(cache.exists())
            self.assertTrue(keep.exists())
            self.assertEqual(result["deletedCount"], 2)
            self.assertEqual(result["failedCount"], 0)
            self.assertGreater(result["reclaimedBytes"], 0)

    def test_duplicate_candidate_paths_are_rejected_before_any_delete(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log, finding = self.eligible_log_finding(root)
            identity = repository_identity(root)
            candidate = {
                key: finding[key]
                for key in (
                    "category",
                    "path",
                    "worktree",
                    "bytes",
                    "reasonCodes",
                    "fingerprint",
                )
            }
            plan = cleanup.build_plan_from_candidates(
                identity,
                [candidate, dict(candidate)],
                created_at=NOW,
            )

            with self.assertRaises(cleanup.PlanError):
                cleanup.apply_plan_data(
                    plan,
                    confirmation=plan["planId"],
                    repository=identity,
                    worktrees={str(root.resolve()): worktree_evidence(root)},
                    open_probe=closed_probe,
                    now=NOW + timedelta(minutes=1),
                )

            self.assertTrue(log.exists())

    def test_report_only_findings_never_enter_plan_candidates(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _log, eligible = self.eligible_log_finding(root)
            report_only = [
                {
                    "category": category,
                    "status": "report_only",
                    "path": f"{root}/{category}",
                    "bytes": 100,
                    "reasonCodes": [f"{category}-report-only"],
                }
                for category in (
                    "docker",
                    "worktree",
                    "process",
                    "dependency",
                    "database",
                )
            ]

            plan = cleanup.build_plan(
                repository_identity(root),
                [eligible, *report_only],
                created_at=NOW,
            )

            self.assertEqual(len(plan["candidates"]), 1)
            self.assertEqual(plan["candidates"][0]["category"], "inactive-log")
            self.assertEqual(
                {item["category"] for item in plan["nonEligible"]},
                {"docker", "worktree", "process", "dependency", "database"},
            )


class RepositoryIdentityTests(unittest.TestCase):
    def initialize_repo(self, root: Path, *, markers: bool = True) -> None:
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run(
            ["git", "-C", str(root), "config", "user.name", "Cleanup Test"], check=True
        )
        subprocess.run(
            ["git", "-C", str(root), "config", "user.email", "cleanup@example.invalid"],
            check=True,
        )
        if markers:
            for marker in (".trellis", "frontend", "backend"):
                (root / marker).mkdir()
                (root / marker / ".keep").write_text("marker", encoding="utf-8")
        else:
            (root / "README").write_text("not smallkhoj", encoding="utf-8")
        subprocess.run(["git", "-C", str(root), "add", "."], check=True)
        subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)

    def test_discovers_registered_smallkhoj_repo_from_nested_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            self.initialize_repo(root)

            context = cleanup.discover_repository(root / "frontend")

            self.assertEqual(context["identity"]["requestedRoot"], str(root.resolve()))
            self.assertIn(context["identity"]["branch"], {"main", "master"})
            self.assertEqual(len(context["worktrees"]), 1)

    def test_rejects_non_smallkhoj_git_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            self.initialize_repo(root, markers=False)

            with self.assertRaises(cleanup.SafetyError):
                cleanup.discover_repository(root)


class ReportingAndCliTests(unittest.TestCase):
    def test_vm_stat_parser_excludes_cumulative_event_counters(self) -> None:
        sample = """Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                  10.
Pages active:                                20.
Pages occupied by compressor:                 4.
\"Translation faults\":                       999.
Pageins:                                      888.
"""

        parsed = cleanup.parse_vm_stat(sample)

        self.assertEqual(parsed["Pages free"], 10 * 16384)
        self.assertEqual(parsed["Pages active"], 20 * 16384)
        self.assertEqual(parsed["Pages occupied by compressor"], 4 * 16384)
        self.assertNotIn('"Translation faults"', parsed)
        self.assertNotIn("Pageins", parsed)

    def test_process_sanitization_drops_command_lines_and_environment(self) -> None:
        raw = {
            "pid": 123,
            "ppid": 1,
            "rssKiB": 2048,
            "cpuPercent": 3.5,
            "elapsed": "01:00",
            "executable": "node",
            "cwd": "/tmp/worktree",
            "command": "node server.js --token super-secret",
            "environment": {"DATABASE_URL": "postgres://secret"},
        }

        safe = cleanup.sanitize_process(raw)
        encoded = json.dumps(safe)

        self.assertNotIn("command", safe)
        self.assertNotIn("environment", safe)
        self.assertNotIn("super-secret", encoded)
        self.assertNotIn("postgres://", encoded)
        self.assertEqual(safe["executable"], "node")

    def test_human_and_json_audit_reports_state_zero_mutation(self) -> None:
        report = {
            "schemaVersion": cleanup.SCHEMA_VERSION,
            "mode": "audit",
            "repo": {"requestedRoot": "/tmp/worktree"},
            "summary": {
                "eligible": {"count": 1, "bytes": 1024},
                "blocked": {"count": 1, "bytes": 0},
                "report_only": {"count": 1, "bytes": 2048},
                "active": {"count": 0, "bytes": 0},
                "normal": {"count": 0, "bytes": 0},
            },
            "findings": [
                {
                    "category": "inactive-log",
                    "status": "eligible",
                    "path": "/tmp/worktree/.dev-logs/old.log",
                    "bytes": 1024,
                    "reasonCodes": ["old-log"],
                }
            ],
            "limitations": [],
            "plan": {"planId": "abc123", "candidates": []},
        }

        human = cleanup.render_human(report)
        encoded = json.dumps(report)

        self.assertIn("AUDIT", human)
        self.assertIn("No cleanup targets were changed", human)
        self.assertIn("abc123", human)
        self.assertIn("eligible", encoded)

    def test_cli_defaults_to_audit(self) -> None:
        args = cleanup.parse_args(["--repo", "/tmp/worktree"])
        self.assertEqual(args.mode, "audit")

    def test_json_audit_cli_is_parseable_and_does_not_apply(self) -> None:
        report = {
            "schemaVersion": cleanup.SCHEMA_VERSION,
            "mode": "audit",
            "repo": {"requestedRoot": "/tmp/worktree"},
            "summary": cleanup.summarize_findings([]),
            "findings": [],
            "limitations": [],
            "plan": {
                "schemaVersion": cleanup.SCHEMA_VERSION,
                "planId": "a" * 64,
                "candidates": [],
            },
        }
        output = io.StringIO()
        with mock.patch.object(cleanup, "audit_repository", return_value=report):
            with redirect_stdout(output):
                exit_code = cleanup.main(["audit", "--repo", "/tmp/worktree", "--json"])

        self.assertEqual(exit_code, 0)
        self.assertEqual(json.loads(output.getvalue())["mode"], "audit")


if __name__ == "__main__":
    unittest.main()
