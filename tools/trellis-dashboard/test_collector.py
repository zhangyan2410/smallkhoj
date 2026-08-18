"""Trellis Dashboard collector 单元测试。

用临时目录构造最小 .trellis 夹具，验证任务扫描、工件检测、会话指针、
journal 解析与工件预览的安全边界。运行:

    python3 -m unittest discover -s tools/trellis-dashboard -p "test_*.py"
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import collector


def make_task(tasks_dir: Path, name: str, **fields) -> Path:
    task_dir = tasks_dir / name
    task_dir.mkdir(parents=True)
    data = {
        "id": name,
        "name": name,
        "title": fields.pop("title", name),
        "status": fields.pop("status", "planning"),
        "priority": fields.pop("priority", "P2"),
        "creator": "tester",
        "assignee": "tester",
        "createdAt": "2026-08-18",
        "completedAt": None,
        "branch": None,
        "base_branch": "main",
        "children": [],
        "parent": None,
    }
    data.update(fields)
    (task_dir / "task.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return task_dir


class FixtureBase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.trellis = self.root / ".trellis"
        self.tasks_dir = self.trellis / "tasks"
        self.tasks_dir.mkdir(parents=True)
        (self.trellis / ".developer").write_text("name=tester\n", encoding="utf-8")

    def tearDown(self) -> None:
        self._tmp.cleanup()


class TestActiveTasks(FixtureBase):
    def test_fields_artifacts_readiness(self) -> None:
        task_dir = make_task(self.tasks_dir, "08-18-alpha", description="描述", notes="备注")
        (task_dir / "prd.md").write_text("# Alpha\n## Goal\n- 目标", encoding="utf-8")
        (task_dir / "design.md").write_text("设计", encoding="utf-8")
        research = task_dir / "research"
        research.mkdir()
        (research / "r1.md").write_text("调研", encoding="utf-8")
        (task_dir / "verify-result.md").write_text("结果", encoding="utf-8")
        (task_dir / "implement.jsonl").write_text(
            '{"_example": "seed"}\n{"file": ".trellis/spec/backend/index.md", "reason": "约定"}\n',
            encoding="utf-8")
        (task_dir / "check.jsonl").write_text('{"_example": "seed"}\n', encoding="utf-8")

        items = collector._collect_active_tasks(self.root)
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(item["dir"], "08-18-alpha")
        self.assertEqual(item["status"], "planning")
        self.assertTrue(item["artifacts"]["prd"])
        self.assertTrue(item["artifacts"]["design"])
        self.assertFalse(item["artifacts"]["implement"])
        self.assertEqual(item["artifacts"]["researchFiles"], ["r1.md"])
        self.assertEqual(item["artifacts"]["extras"], ["verify-result.md"])
        self.assertEqual(item["artifacts"]["implementContext"]["curated"], 1)
        self.assertFalse(item["artifacts"]["implementContext"]["seedOnly"])
        self.assertTrue(item["artifacts"]["checkContext"]["seedOnly"])
        self.assertEqual(item["phase"], "plan")
        # prd 已存在但 jsonl 未策展 → 下一步指向 jsonl 策展
        self.assertIn("jsonl", item["nextStep"])
        self.assertIn("CONTEXT_NOT_CURATED", item["risks"])
        self.assertNotIn("MISSING_PRD", item["risks"])

    def test_done_status_treated_as_completed(self) -> None:
        make_task(self.tasks_dir, "08-18-beta", status="done")
        item = collector._collect_active_tasks(self.root)[0]
        self.assertEqual(item["phase"], "completed")
        self.assertTrue(item["nextStep"])

    def test_children_progress_counts_archived_child_as_done(self) -> None:
        make_task(self.tasks_dir, "08-18-parent", children=["08-18-live", "08-18-gone"])
        make_task(self.tasks_dir, "08-18-live", status="in_progress", parent="08-18-parent")
        item = collector._collect_active_tasks(self.root)[0]
        self.assertEqual(item["childrenProgress"], {"done": 1, "total": 2})
        live = next(c for c in item["children"] if c["dir"] == "08-18-live")
        gone = next(c for c in item["children"] if c["dir"] == "08-18-gone")
        self.assertFalse(live["done"])
        self.assertTrue(gone["archived"] and gone["done"])

    def test_in_progress_seed_only_jsonl_is_not_a_risk(self) -> None:
        task_dir = make_task(self.tasks_dir, "08-18-gamma", status="in_progress")
        (task_dir / "prd.md").write_text("x", encoding="utf-8")
        (task_dir / "implement.jsonl").write_text('{"_example": "s"}\n', encoding="utf-8")
        (task_dir / "check.jsonl").write_text('{"_example": "s"}\n', encoding="utf-8")
        item = collector._collect_active_tasks(self.root)[0]
        self.assertEqual(item["risks"], [])
        self.assertEqual(item["phase"], "execute_finish")

    def test_needs_decision_from_meta(self) -> None:
        make_task(self.tasks_dir, "08-18-delta", meta={"needsDecision": "归档还是保留？"})
        item = collector._collect_active_tasks(self.root)[0]
        self.assertEqual(item["needsDecision"], "归档还是保留？")
        make_task(self.tasks_dir, "08-19-epsilon", meta={})
        item2 = [t for t in collector._collect_active_tasks(self.root)
                 if t["dir"] == "08-19-epsilon"][0]
        self.assertIsNone(item2["needsDecision"])


class TestArchived(FixtureBase):
    def test_archived_recent_ref_and_sort(self) -> None:
        for month, name, completed in [
            ("2026-07", "07-20-old", "2026-07-20"),
            ("2026-08", "08-15-new", "2026-08-15"),
        ]:
            task_dir = self.tasks_dir / "archive" / month / name
            task_dir.mkdir(parents=True)
            (task_dir / "task.json").write_text(json.dumps({
                "id": name, "name": name, "title": name, "status": "completed",
                "priority": "P2", "assignee": "tester", "completedAt": completed,
                "createdAt": completed, "children": [],
                "meta": {"needsDecision": "示例决定"} if name.endswith("new") else {},
            }), encoding="utf-8")

        recent = collector._collect_archived_recent(self.root)
        self.assertEqual(len(recent), 2)
        self.assertEqual(recent[0]["dir"], "08-15-new")
        self.assertEqual(recent[0]["ref"], "archive/2026-08/08-15-new")
        self.assertEqual(recent[0]["needsDecision"], "示例决定")
        self.assertIn("artifacts", recent[0])
        self.assertEqual(collector._count_archived(self.root), 2)


class TestSessions(FixtureBase):
    def test_session_scan_and_stale_detection(self) -> None:
        make_task(self.tasks_dir, "08-18-alpha")
        sessions = self.trellis / ".runtime" / "sessions"
        sessions.mkdir(parents=True)
        (sessions / "codex_abc.json").write_text(json.dumps({
            "platform": "codex",
            "last_seen_at": "2026-08-18T01:00:00Z",
            "current_task": ".trellis/tasks/08-18-alpha",
        }), encoding="utf-8")
        (sessions / "claude_def.json").write_text(json.dumps({
            "platform": "claude",
            "last_seen_at": "2026-08-18T02:00:00Z",
            "current_task": ".trellis/tasks/08-18-vanished",
        }), encoding="utf-8")

        result = collector._collect_sessions(self.root)
        self.assertEqual(len(result), 2)
        by_platform = {s["platform"]: s for s in result}
        self.assertFalse(by_platform["codex"]["staleTask"])
        self.assertTrue(by_platform["claude"]["staleTask"])
        # 按最后活跃时间倒序
        self.assertEqual(result[0]["platform"], "claude")


class TestJournal(FixtureBase):
    def test_parse_index_blocks(self) -> None:
        workspace = self.trellis / "workspace" / "tester"
        workspace.mkdir(parents=True)
        (workspace / "index.md").write_text(
            "# Workspace Index - tester\n"
            "<!-- @@@auto:current-status -->\n"
            "- **Active File**: `journal-1.md`\n"
            "- **Total Sessions**: 2\n"
            "- **Last Active**: 2026-08-18\n"
            "<!-- @@@/auto:current-status -->\n"
            "<!-- @@@auto:active-documents -->\n"
            "| File | Lines | Status |\n"
            "|------|-------|--------|\n"
            "| `journal-1.md` | ~1800 | Active |\n"
            "<!-- @@@/auto:active-documents -->\n"
            "<!-- @@@auto:session-history -->\n"
            "| # | Date | Title | Commits | Branch |\n"
            "|---|------|-------|---------|--------|\n"
            "| 2 | 2026-08-18 | 第二次 | `aaa`, `bbb` | main |\n"
            "| 1 | 2026-08-17 | 第一次 | `ccc` | feat/x |\n"
            "<!-- @@@/auto:session-history -->\n",
            encoding="utf-8")

        journal = collector._collect_journal(self.root)
        self.assertEqual(journal["developer"], "tester")
        self.assertEqual(journal["developers"][0]["totalSessions"], 2)
        self.assertEqual(journal["journalFiles"][0]["lines"], 1800)
        self.assertTrue(journal["journalFiles"][0]["nearLimit"])
        self.assertEqual(journal["recent"][0]["n"], 2)
        self.assertEqual(journal["recent"][0]["commits"], ["aaa", "bbb"])
        self.assertEqual(journal["recent"][1]["branch"], "feat/x")


class TestArtifactPreview(FixtureBase):
    def setUp(self) -> None:
        super().setUp()
        self.task_dir = make_task(self.tasks_dir, "08-18-alpha")
        (self.task_dir / "prd.md").write_text("# hello", encoding="utf-8")

    def test_normal_read(self) -> None:
        result = collector.read_artifact_preview(self.root, "08-18-alpha", "prd.md")
        self.assertEqual(result["content"], "# hello")
        self.assertFalse(result["truncated"])

    def test_traversal_rejected(self) -> None:
        for task_ref, file_ref in [
            ("08-18-alpha", "../../.developer"),
            ("08-18-alpha", "prd.md/../../.developer"),
            ("../tasks/08-18-alpha", "prd.md"),
            ("08-18-alpha/..", "prd.md"),
            ("/abs", "prd.md"),
            ("08-18-alpha", "/etc/passwd"),
        ]:
            self.assertIsNone(
                collector.read_artifact_preview(self.root, task_ref, file_ref),
                f"应拒绝 {task_ref} / {file_ref}")

    def test_missing_task_rejected(self) -> None:
        self.assertIsNone(collector.read_artifact_preview(self.root, "nope", "prd.md"))

    def test_truncation_flag(self) -> None:
        big = self.task_dir / "big.md"
        big.write_bytes(b"x" * (collector.ARTIFACT_PREVIEW_LIMIT_BYTES + 10))
        result = collector.read_artifact_preview(self.root, "08-18-alpha", "big.md")
        self.assertTrue(result["truncated"])
        self.assertEqual(len(result["content"]), collector.ARTIFACT_PREVIEW_LIMIT_BYTES)


class TestSnapshotEndToEnd(FixtureBase):
    def test_snapshot_shape(self) -> None:
        make_task(self.tasks_dir, "08-18-alpha", status="in_progress", priority="P0")
        snapshot = collector.collect_snapshot(self.root)
        self.assertEqual(snapshot["schema"], collector.SNAPSHOT_SCHEMA)
        self.assertEqual(snapshot["developer"], "tester")
        self.assertEqual(snapshot["summary"]["activeTasks"], 1)
        self.assertEqual(snapshot["summary"]["priority"]["P0"], 1)
        self.assertEqual(snapshot["tasks"]["active"][0]["dir"], "08-18-alpha")
        self.assertFalse(snapshot["project"]["git"]["isRepo"])


if __name__ == "__main__":
    unittest.main()


class TestSpecCapture(FixtureBase):
    def _write_ledger(self, items: list) -> None:
        spec_dir = self.trellis / "spec"
        spec_dir.mkdir(parents=True, exist_ok=True)
        (spec_dir / "capture-ledger.json").write_text(json.dumps({
            "schema": "trellis.spec-capture.v1",
            "auditedAt": "2026-08-18",
            "items": items,
        }, ensure_ascii=False), encoding="utf-8")

    def test_reads_ledger_and_enriches_title(self) -> None:
        task_dir = self.tasks_dir / "archive" / "2026-08" / "08-01-x"
        task_dir.mkdir(parents=True)
        (task_dir / "task.json").write_text(json.dumps({"title": "示例任务"}), encoding="utf-8")
        self._write_ledger([
            {"kind": "task", "month": "2026-08", "id": "08-01-x", "status": "captured", "target": "backend/x.md", "note": "n"},
            {"kind": "skill", "id": "demo-skill", "status": "skipped"},
        ])
        cap = collector._collect_spec_capture(self.root)
        self.assertEqual(cap["auditedAt"], "2026-08-18")
        self.assertEqual(cap["counts"], {"captured": 1, "skipped": 1})
        task_item = next(i for i in cap["items"] if i["kind"] == "task")
        self.assertEqual(task_item["title"], "示例任务")
        # 倒序：skill 组在前
        self.assertEqual(cap["items"][0]["id"], "demo-skill")

    def test_missing_or_bad_ledger_returns_empty(self) -> None:
        cap = collector._collect_spec_capture(self.root)
        self.assertEqual(cap["items"], [])
        (self.trellis / "spec").mkdir(parents=True, exist_ok=True)
        (self.trellis / "spec" / "capture-ledger.json").write_text("{bad json", encoding="utf-8")
        self.assertEqual(collector._collect_spec_capture(self.root)["items"], [])


class TestSpecZh(FixtureBase):
    def _setup_spec(self, content: str) -> None:
        spec = self.trellis / "spec" / "backend"
        spec.mkdir(parents=True, exist_ok=True)
        (spec / "demo.md").write_text(content, encoding="utf-8")
        zh = self.trellis / "spec-zh" / "backend"
        zh.mkdir(parents=True, exist_ok=True)
        (zh / "demo.md").write_text("中文镜像", encoding="utf-8")

    def _write_manifest(self, sha: str) -> None:
        zh_root = self.trellis / "spec-zh"
        (zh_root / "manifest.json").write_text(json.dumps({
            "schema": "trellis.spec-zh.v1",
            "files": {"backend/demo.md": sha},
        }), encoding="utf-8")

    def test_zh_read_and_staleness(self) -> None:
        import hashlib
        self._setup_spec("english source")
        sha = hashlib.sha256(b"english source").hexdigest()
        self._write_manifest(sha)
        result = collector.read_spec_file(self.root, "backend/demo.md", "zh")
        self.assertEqual(result["lang"], "zh")
        self.assertEqual(result["content"], "中文镜像")
        self.assertFalse(result["stale"])
        files = collector._collect_spec_files(self.root)["files"]
        demo = next(f for f in files if f["path"] == "backend/demo.md")
        self.assertTrue(demo["zhAvailable"])
        self.assertFalse(demo["zhStale"])
        # 源更新后 → 过期
        (self.trellis / "spec" / "backend" / "demo.md").write_text("changed", encoding="utf-8")
        self.assertTrue(collector._spec_zh_stale(self.root, "backend/demo.md"))

    def test_zh_missing_falls_back(self) -> None:
        spec = self.trellis / "spec" / "backend"
        spec.mkdir(parents=True, exist_ok=True)
        (spec / "only-en.md").write_text("x", encoding="utf-8")
        result = collector.read_spec_file(self.root, "backend/only-en.md", "zh")
        self.assertIsNone(result)
        files = collector._collect_spec_files(self.root)["files"]
        demo = next(f for f in files if f["path"] == "backend/only-en.md")
        self.assertFalse(demo["zhAvailable"])
