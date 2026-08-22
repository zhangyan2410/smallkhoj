"""Trellis Dashboard collector 单元测试。

用临时目录构造最小 .trellis 夹具，验证任务扫描、工件检测、会话指针、
journal 解析与工件预览的安全边界。运行:

    python3 -m unittest discover -s tools/trellis-dashboard -p "test_*.py"
"""

from __future__ import annotations

import json
import tempfile
import time
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


class TestAgentRunner(FixtureBase):
    def test_workflow_registry_and_stub_run(self) -> None:
        import agent_runner

        # 注册表解析（真实仓库的工作流目录）
        workflows = agent_runner.list_workflows()
        self.assertTrue(any(w["id"] == "spec-staleness-audit" for w in workflows))
        wf = next(w for w in workflows if w["id"] == "spec-staleness-audit")
        self.assertEqual(wf["name"], "Spec 时效核验")
        self.assertGreater(wf["promptChars"], 500)
        prompt = agent_runner.read_workflow_prompt("spec-staleness-audit")
        self.assertIn("spec-audit.json", prompt)
        self.assertIsNone(agent_runner.read_workflow_prompt("no-such"))

        # 桩运行：DSH_BIN 换成 /bin/echo
        agent_runner.DSH_BIN = "/bin/echo"
        try:
            record = agent_runner.start_run(self.root, "spec-staleness-audit")
        finally:
            agent_runner.DSH_BIN = "dsh"
        self.assertEqual(record["status"], "running")
        # 等 reap 线程收尾
        for _ in range(50):
            if agent_runner.run_state.running is None:
                break
            time.sleep(0.1)
        runs = agent_runner.list_runs(self.root)
        self.assertEqual(len(runs), 1)
        run = runs[0]
        self.assertEqual(run["status"], "done")
        self.assertEqual(run["exitCode"], 0)
        self.assertIsNotNone(run["durationSeconds"])
        self.assertIn("Spec", run["outputTail"])

    def test_single_flight_lock(self) -> None:
        import agent_runner

        agent_runner.DSH_BIN = "/bin/sleep"
        try:
            agent_runner.run_state.running = {"runId": "x", "workflowId": "y", "status": "running"}
            with self.assertRaises(RuntimeError):
                agent_runner.start_run(self.root, "spec-staleness-audit")
        finally:
            agent_runner.run_state.running = None
            agent_runner.DSH_BIN = "dsh"


class TestAgentChat(FixtureBase):
    def test_chat_lifecycle_over_web_api(self) -> None:
        import agent_chat

        agent_chat.web_up = lambda timeout=0.3: True
        agent_chat.ensure_dsh_web = lambda root: None
        seq = {"n": 23}
        calls = []

        def fake_rpc(method, payload):
            calls.append(method)
            if method == "session.list":
                return {"items": []}
            if method == "session.create":
                return {"sessionId": payload["sessionId"], "agentPreset": "standard"}
            if method == "session.history":
                seq["n"] += 1
                if len([c for c in calls if c == "session.prompt"]) == 0:
                    return {"events": [{"event": {"type": "permission/preset", "seq": 1, "data": {}}}]}
                return {"events": [
                    {"event": {"type": "user/message", "seq": seq["n"] - 1, "data": {}}},
                    {"event": {"type": "assistant/message", "seq": seq["n"], "data": {
                        "content": [{"type": "text", "text": "好的，改完了。"}]}}},
                    {"event": {"type": "turn/end", "seq": seq["n"] + 1, "data": {}}},
                ]}
            if method == "session.prompt":
                return {"accepted": True}
            raise AssertionError(method)

        agent_chat.web_rpc = fake_rpc
        agent_chat.POLL_INTERVAL_SECONDS = 0.01
        try:
            entry = agent_chat.send_message(self.root, "加一个 XX 功能")
            self.assertEqual(entry["role"], "assistant")
            self.assertIn("改完了", entry["text"])
            self.assertIn("session.create", calls)
            self.assertIn("session.prompt", calls)
            msgs = agent_chat.read_log(self.root)
            self.assertEqual(msgs[0]["role"], "user")
            # 单飞：busy 期间第二条被拒
            agent_chat.chat_busy = True
            with self.assertRaises(RuntimeError):
                agent_chat.send_message(self.root, "第二条")
            agent_chat.chat_busy = False
        finally:
            agent_chat.chat_busy = False

    def test_chat_error_recorded(self) -> None:
        import agent_chat

        agent_chat.web_up = lambda timeout=0.3: True

        def boom(root):
            raise RuntimeError("dsh web 启动超时")

        agent_chat.ensure_dsh_web = boom
        try:
            entry = agent_chat.send_message(self.root, "hi")
            self.assertEqual(entry["role"], "error")
            self.assertIn("超时", entry["text"])
        finally:
            agent_chat.chat_busy = False


class TestComet(FixtureBase):
    def test_parse_config(self) -> None:
        cfg = collector.parse_comet_config(
            "# 注释\nschema: comet.project.v1\ndefault_workflow: native\n"
            "workflows:\n  - native\n  # - classic（注释掉）\n"
            "native:\n  language: zh-CN\n"
        )
        self.assertEqual(cfg["defaultWorkflow"], "native")
        self.assertEqual(cfg["workflows"], ["native"])

    def test_parse_state_summary(self) -> None:
        summary = collector.parse_comet_state_summary(
            'schema: comet.native.v4\nname: spec-remediation\nphase: archive\n'
            'status: done\nverification_result: "pass"\ncreated_at: 2026-08-19T14:44:57.510Z\n'
            'history:\n  - name: 不应匹配的嵌套 name: x\n'
        )
        self.assertEqual(summary["name"], "spec-remediation")
        self.assertEqual(summary["verificationResult"], '"pass"')
        self.assertEqual(summary["createdAt"], "2026-08-19T14:44:57.510Z")

    def test_collect_comet_fixture(self) -> None:
        (self.root / ".comet").mkdir()
        (self.root / ".comet" / "config.yaml").write_text(
            "default_workflow: native\nworkflows:\n  - native\n", encoding="utf-8")
        archived = self.root / "docs" / "comet" / "archive" / "2026-08-19-demo-change"
        archived.mkdir(parents=True)
        (archived / "comet-state.yaml").write_text(
            "name: demo-change\nphase: archive\nstatus: done\nverification_result: pass\n"
            "created_at: 2026-08-19T10:00:00.000Z\n", encoding="utf-8")
        result = collector._collect_comet(self.root)
        self.assertEqual(result["config"]["defaultWorkflow"], "native")
        # dashboardUp 取决于本机 4321 是否真有 comet dashboard 在跑，只断言键存在
        self.assertIsInstance(result["dashboardUp"], bool)
        self.assertEqual(len(result["archivedChanges"]), 1)
        self.assertEqual(result["archivedChanges"][0]["name"], "demo-change")
        self.assertEqual(result["archivedChanges"][0]["verificationResult"], "pass")
        # installed 视环境而定，activeChanges 在无 comet CLI 时为空列表不抛错
        self.assertIn(result["installed"], (True, False))
        self.assertIsInstance(result["activeChanges"], list)


class TestNonTrellisDegradation(unittest.TestCase):
    """无 .trellis/scripts/common 的项目（跨项目迁移）也必须能出快照。"""

    def test_snapshot_on_repo_without_trellis(self) -> None:
        import shutil
        import subprocess
        import sys

        with tempfile.TemporaryDirectory() as tmp:
            tool_dst = Path(tmp) / "tools" / "trellis-dashboard"
            tool_dst.mkdir(parents=True)
            for f in ("collector.py", "agent_runner.py", "agent_chat.py"):
                shutil.copy(Path(__file__).parent / f, tool_dst / f)
            code = (
                "import sys, json; sys.path.insert(0, %r); "
                "import collector; "
                "snap = collector.collect_snapshot(%r); "
                "print(json.dumps({'schema': snap['schema'], 'active': snap['tasks']['active'], "
                "'comet_installed_key': 'comet' in snap, 'developer': snap['developer']}))"
                % (str(tool_dst), tmp)
            )
            proc = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=30)
            self.assertEqual(proc.returncode, 0, msg=proc.stderr)
            payload = json.loads(proc.stdout.strip().splitlines()[-1])
            self.assertEqual(payload["schema"], "trellis.dashboard.v1")
            self.assertEqual(payload["active"], [])
            self.assertTrue(payload["comet_installed_key"])
            self.assertEqual(payload["developer"], "unknown")
