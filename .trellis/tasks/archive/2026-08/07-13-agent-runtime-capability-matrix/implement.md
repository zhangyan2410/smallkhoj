# Agent Runtime Capability Matrix — Implementation Plan

**Task:** `.trellis/tasks/07-13-agent-runtime-capability-matrix`  
**Goal:** 在严格调用预算和隔离边界内，产出可复现的 Provider capability evidence、版本化矩阵和 portable reliable-wakeup 结论，不修改生产 runtime。  
**Acceptance Criteria:** 覆盖 `prd.md` 的全部 13 条 acceptance criteria；逐项映射见本文第 16 节。  
**Architecture cell:** task-local capability spike；不新增生产 ownership cell  
**Map delta:** none  
**Map delta why:** 本任务只创建任务内探针和证据，不改变 SmallKhoj 生产组件所有权或数据流。  
**Architecture:** Python 标准库实现 task-local controller、预算 ledger、进程 ownership guard、redactor 和少量 surface driver；所有 Provider 在 `/tmp` disposable fixture 中运行，sanitized evidence 回写任务目录。统一边界是 Adapter Invocation，Provider Turn 能力只在有证据时单独标记。  
**Tech Stack:** Python 3 standard library、provider CLI/ACP/JSON-RPC/HTTP-SSE、Git disposable fixture、Markdown/JSON evidence  
**前端验证:** No

---

## 1. Finish Line and Non-goals

### Finish line

任务完成时，另一个开发者可以只看 task-local harness、sanitized evidence 和矩阵，复现每个 `verified`/`conditional` 结论，并清楚知道哪些能力因为预算、认证、协议或安全限制仍是 `unverified`/`blocked`。

最终必须存在：

```text
.trellis/tasks/07-13-agent-runtime-capability-matrix/
├── prd.md
├── research.md
├── research/reference-project-runtime-patterns.md
├── design.md
├── implement.md
├── probes/
│   ├── README.md
│   ├── cli.py
│   ├── lib/
│   ├── surfaces/
│   ├── cases/
│   └── tests/
├── evidence/
│   ├── run-manifest.json
│   ├── static-preflight.json
│   └── <surface>/<case>/evidence.json
└── provider-capability-matrix.md
```

若某 Provider 在 live gate 前 blocked，对应 `evidence/<surface>/<case>/evidence.json` 仍应存在，记录 `blocked`/`not_executed` 和原因，不要求伪造 live transcript。

### What this task does not build

- 生产 durable Mailbox、数据库表、lease 或 scheduler；
- NATS/Redis Streams；
- 生产 Codex app-server adapter；
- vendor Agent 的 transparent suspend/resume；
- Pi/owned loop；
- 前端状态 UI；
- `@` SLA 或 urgent interrupt 产品策略。

## 2. Terminal Schemas

实现围绕 `design.md` 中的终态类型构建，不先写会被丢弃的 throwaway runner：

- `CapabilitySupport`
- `RuntimeCapabilities`
- `ProbeEvidence`
- `BusyInputBehavior`
- `ProbeExecutionStatus`

Python 表达位置：

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/schema.py`
- Test: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_schema.py`

Schema 必须能 round-trip JSON、拒绝未知 support level、要求 `verified/conditional` 携带 evidence id，并允许 `delivery_uncertain` 保存 contradictory signals。

## 3. Stateful Object Census and Lifecycle Gate

本 spike 自己也有状态对象。以下四个对象在实现前必须先写测试，避免预算、进程或原始证据在 crash/retry 时失控。

### 3.1 Probe Case lifecycle

唯一 owner：`ProbeController`。

| Current | Event | Next | Rule |
| --- | --- | --- | --- |
| `planned` | static preflight passes | `ready` | 不触发模型 |
| `planned` | preflight blocks | `blocked` | 写 evidence 后终止该 case |
| `ready` | live budget reserved | `running` | 先落 ledger 再写 prompt |
| `running` | coherent terminal | `passed` / `failed` / `cancelled` | 保存所有原始观察 |
| `running` | controller timeout | `timed_out` / `delivery_uncertain` | 依据 side-effect evidence |
| `running` | process/controller crash recovery | `delivery_uncertain` | 不自动回到 `ready` |
| any terminal | retry request | new attempt id | 旧 attempt 不改写；预算不退款 |

旁路禁止：surface driver 不得直接把 case 标为 passed；只能提交 observation，由 controller/assessor 决定终态。

### 3.2 Call Budget Ledger lifecycle

唯一 owner：`CallBudgetLedger`。静态/no-model run 可以有自己的零输入账本；所有 live case 共享 `/tmp/smallkhoj-agent-runtime-capability-matrix/_live-budget/call-budget.json`，因此换 run id、surface 或重启 controller 都不能绕过每 Provider 两次上限。sanitized reconciliation/summary 写入 task-local evidence；本轮从旧 per-run ledger 迁移的已消耗输入见 `evidence/live-budget-reconciliation-20260714.json`。

| Current | Event | Next | Rule |
| --- | --- | --- | --- |
| `available(n<2)` | reserve model-bearing input | `reserved(n+1)` | 原子写盘成功后才能发 prompt |
| `reserved` | input write attempted | `consumed` | 即使 transport 失败也计数 |
| `reserved` | crash before input | `consumed_unknown` | fail-closed，不退款 |
| `available(n=2)` | reserve | `rejected` | case → `not_executed` |

旁路禁止：surface driver 不得直接调用模型；所有 model-bearing frame 必须带 reservation id。

### 3.3 Owned Process Registry lifecycle

唯一 owner：`OwnedProcessRegistry`。

| Current | Event | Next | Rule |
| --- | --- | --- | --- |
| absent | controller spawns process group | `running` | 记录 PID/PGID/cwd/start time |
| `running` | protocol cancel/interrupt | `cancel_requested` | 保留进程身份 |
| `running/cancel_requested` | process exits | `terminated` | 记录 code/signal |
| `running/cancel_requested` | cleanup timeout | `force_terminated` | 仅 registry 内 PGID |
| any active | PID identity mismatch | `cleanup_uncertain` | 禁止 kill，提示 manual inspection |

旁路禁止：不得按进程名 kill，不得接管用户已有 Provider 进程。

### 3.4 Raw Evidence lifecycle

唯一 owner：`EvidenceRecorder`。

| Current | Event | Next | Rule |
| --- | --- | --- | --- |
| absent | case starts | `raw_open` | `/tmp` 权限受限目录 |
| `raw_open` | case terminal | `raw_closed` | fsync 后停止追加 |
| `raw_closed` | redaction passes | `sanitized_written` | 任务目录只写 sanitized copy |
| `sanitized_written` | digest verified | `raw_deleted` | 删除 raw transcript |
| `raw_closed` | redaction uncertain | `quarantined_then_deleted` | 任务目录只写 hash/结构摘要 |

旁路禁止：不得把 raw transcript `cp` 到 task 目录，不得把 auth/env dump 当 evidence。

### 3.5 Invariants

- **INV-1:** 没有已持久化 reservation id，不得发送 model-bearing input。
- **INV-2:** 每个 Provider 的 `consumed + consumed_unknown ≤ 2`；attempt 失败不退款。
- **INV-3:** cleanup 只能 signal registry 中 identity 仍匹配的实验 PGID。
- **INV-4:** Provider cwd 必须位于当前 run 的 `/tmp` fixture 下。
- **INV-5:** task `evidence/` 中不得出现 raw transcript、token、Authorization header 或未分类的大字段。
- **INV-6:** `verified`/`conditional` 必须引用 dynamic evidence id；跨 surface evidence 不得替代当前 surface。
- **INV-7:** `unsupported` 必须有 protocol/documented/reproducible rejection basis；“help 没写”不足以判 unsupported。
- **INV-8:** `delivery_uncertain` 不自动 retry；后续 attempt 需要显式新 case/decision，仍受预算限制。
- **INV-9:** Adapter terminal 与 semantic outcome 分栏，前者不能自动生成 `handled=true`。
- **INV-10:** 任何 stop condition 触发后，当前 Provider 不再发新的 model input。

### 3.6 Adversarial tests

- crash between budget reservation and stdin write → `consumed_unknown`，不重复发送；
- controller receives timeout while process exits simultaneously → terminal record 单写，保留两条 observation；
- stale PID/PGID reused by unrelated process → cleanup 拒绝 signal；
- raw transcript includes fake bearer/JWT/API key → sanitized evidence 不含明文；
- nominal result=completed + terminal stderr error → assessor 不输出 verified success；
- side-effect sentinel changed + transport lost → `delivery_uncertain`；
- two surface drivers race for the second Provider call → 一个 reservation 成功，一个 `not_executed`；
- case attempts to use SmallKhoj repository as cwd → preflight 拒绝；
- rerun after controller restart → 从 ledger/registry 恢复，不能重置预算或覆盖旧 attempt。

## 4. Phase 0 — Activation Gate

此阶段只有在用户审阅 `prd.md`、`design.md`、`implement.md` 并明确批准后执行。

1. Run:

   ```bash
   rtk python3 ./.trellis/scripts/task.py start .trellis/tasks/07-13-agent-runtime-capability-matrix
   ```

   Expected: task status changes from `planning` to `in_progress`.

2. Load `trellis-before-dev` and read the package/spec context it selects before creating `probes/`.

3. Re-read `rtk git status --short`; confirm unrelated untracked task directories are unchanged.

4. Load the repository's `worktree` skill and follow the sibling worktree + `feat/*` branch rule for non-trivial implementation. The activation step must not use destructive checkout/reset, and must preserve the already-written task artifacts.

5. Stop if planning artifacts changed since review or task activation fails.

Rollback point: before the first file under `probes/` is created, no Provider or production state has changed.

## 5. Phase 1 — Harness Skeleton and Schema (TDD)

### Task 1: Create the task-local harness layout

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/README.md`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/__init__.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/surfaces/__init__.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/__init__.py`

Steps:

1. Write README constraints first: `/tmp` only, two-call cap, no global config mutation, no global kill, redacted output only.
2. Add a CLI with no live behavior yet: `preflight`, `run-case`, `assess`, `cleanup`, `verify-evidence` subcommands.
3. Run:

   ```bash
   rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py --help
   ```

   Expected: lists subcommands and exits 0; no Provider process starts.

### Task 2: Implement terminal schemas

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/schema.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_schema.py`

Steps:

1. Write failing tests for all support levels, evidence status values, required evidence ids and JSON round-trip.
2. Run test and verify failure because schema types/validators do not exist.
3. Implement minimal dataclasses/enums/validators using Python stdlib only.
4. Run the canonical discovery command（dated task directories are not valid Python package names）：

   ```bash
   rtk python3 -m unittest discover -s .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests -p 'test_schema.py' -v
   ```

   Expected: all schema tests pass.

Rollback point: delete only `probes/`; no evidence/provider call exists.

## 6. Phase 2 — Safety Primitives (TDD)

### Task 3: Call budget ledger

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/budget.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_budget.py`

Test first:

- atomic reservation under concurrent processes;
- failed input still consumes budget;
- crash recovery becomes `consumed_unknown`;
- third reservation is rejected;
- one Provider's budget does not leak to another.

Validation:

```bash
rtk python3 -m unittest discover -s .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests -p 'test_budget.py' -v
```

Expected: INV-1 and INV-2 scenarios pass.

### Task 4: Fixture manager and cwd guard

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/fixture.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_fixture.py`

Test first:

- creates run/provider/surface directories only below configured `/tmp` root;
- initializes disposable Git fixture and returns baseline digest;
- refuses workspace root, home root, symlink escape and reused foreign directory;
- computes before/after digest without reading outside fixture.

Validation expected: INV-4 passes; fixture contains only generated nonce/readme/sentinel and `.git`.

### Task 5: Owned process registry and bounded termination

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/process_guard.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_process_guard.py`

Test first with fake local subprocesses:

- registers PID/PGID/cwd/start identity before interaction;
- protocol-cancel hook runs before signals;
- escalates INT/TERM/KILL only for owned group;
- refuses stale/reused PID identity;
- cleanup is idempotent after normal exit;
- simultaneous exit/timeout yields one terminal transition.

Do not test with real Codex/Claude processes yet.

### Task 6: Redactor and evidence recorder

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/redact.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/evidence.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_redact.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_evidence.py`

Test first:

- bearer/JWT/API key/cookie/query token redaction；
- `<HOME>` path replacement；
- allowlisted session/turn correlation uses hash/prefix；
- unknown large payload becomes digest/shape summary；
- sanitized file written before raw deletion；
- redaction uncertainty writes only quarantine summary；
- terminal contradictions remain present after sanitization。

Validation expected: INV-5 passes; tests inspect task output fixture and assert no secret marker remains.

Full harness gate:

```bash
rtk python3 -m unittest discover -s .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests -v
```

Expected: all tests pass without starting any Provider.

Rollback point: all created state is task-local code plus `/tmp` test fixtures; delete only those if the harness gate fails.

## 7. Phase 3 — Generic Runner, Assessor and Mock Proof

### Task 7: Generic process/protocol runner

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/runner.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/fixtures/fake_agent.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_runner.py`

Fake agent modes：normal result、busy second input、delayed stderr terminal error、hang、fixture side effect then transport loss、ignore cancel。

Test first, then implement stream capture, monotonic timestamps, stdin frames, bounded timeout and cleanup through `OwnedProcessRegistry`.

Expected proof:

- normal case retains stdout/result/exit；
- terminal stderr can contradict nominal completion；
- hang ends within timeout；
- side-effect + lost terminal becomes uncertain；
- no orphan fake process remains。

### Task 8: Deterministic assessor

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/lib/assess.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_assess.py`

Test first for：

- dynamic evidence required by `verified/conditional`；
- static absence yields `unverified`；
- reproducible explicit rejection can yield `unsupported`；
- busy input attribution order；
- completion does not create semantic handled；
- session resume does not imply suspend continuation；
- side-effect uncertainty prevents automatic retry。

Validation expected: INV-6 through INV-9 pass.

### Task 9: Dry-run manifest

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cases/static-preflight.json`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cases/live-budget.json`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests/test_manifest.py`

The manifest freezes：binary paths discovered at run time、timeouts、Provider cap=2、fixture root、allowed commands、case ordering、stop conditions。它不得包含 auth secret。

Run:

```bash
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py preflight --manifest .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cases/static-preflight.json --dry-run
```

Expected: prints planned non-model commands and live cases, reports model-call budget 0/2 for each Provider, starts no Provider.

Review Gate A: unit tests green、dry-run clean、无生产文件 diff、无 Provider process。

## 8. Phase 4 — Static and No-model Preflight

### Task 10: Surface adapters for static/preflight only

**Files:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/surfaces/codex_appserver.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/surfaces/stream_json.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/surfaces/acp_stdio.py`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/probes/surfaces/opencode_server.py`
- Create: matching `probes/tests/test_*_surface.py` using fake protocol fixtures only.

Implement only enough protocol framing to：start experiment-owned process、initialize/handshake where no model call occurs、send later model frames only through budget ledger、capture JSONL/JSON-RPC/SSE、clean shutdown。

### Task 11: Execute static preflight

Record into：

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/evidence/static-preflight.json`
- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/evidence/run-manifest.json`

Checks：

1. exact binary/version for Codex、Claude、Kimi、OpenCode；
2. Qoder、ZCode、Pi command presence without installation；
3. Codex app-server schema generated inside fixture；
4. surface help/flags and no-model startup/handshake；
5. Provider call budget remains 0；
6. no login flow, payment confirmation or CAPTCHA is crossed。

Run `verify-evidence` after redaction. Expected：sanitized static evidence exists、raw temp removed、no model-bearing prompt sent。

Stop conditions at this phase：

- binary unexpectedly resolves outside known install path；
- command requests global config migration/update；
- startup presents login/payment/CAPTCHA；
- protocol handshake itself triggers model usage unexpectedly；
- redactor cannot safely classify output。

Review Gate B: show static preflight summary and actual live case allocation before first model-bearing input. No need to ask a new product question unless preflight changes the approved risk boundary.

## 9. Phase 5 — Live Provider Probes

Live cases run sequentially, never in parallel across Providers. After every case：settle process、redact、delete raw、verify fixture diff、check ledger、check no owned PID remains。Only then continue.

### Task 12: Codex

**Case files:**

- Create: `probes/cases/codex-appserver-active-steer-interrupt.json`
- Evidence: `evidence/codex-appserver/<case>/evidence.json`

Execution：

1. Reserve call 1; start bounded turn in disposable fixture.
2. Capture `threadId`/`turnId` and `turn/started`.
3. Reserve call 2; during active window send `turn/steer(expectedTurnId=...)` with a second nonce; record protocol response exactly.
4. Send non-model-bearing `turn/interrupt` only to that turn; settle and inspect fixture.
5. Optionally test thread reference/load without a new model input; do not start a post-interrupt turn, so post-interrupt session usability remains `unverified`.
6. Do not infer Codex exec or ACP dynamic capabilities from app-server.

Fallback：if app-server blocks before a model call, reallocate at most two calls to Codex exec normal + resume and record why. If call 1 has been sent, budget is consumed and fallback has only one remaining call。

Stop：auth/payment/CAPTCHA、unexpected workspace path、unbounded tool request、external network side effect、cannot correlate expected turn、cleanup identity mismatch。

### Task 13: Claude Code stream-json

**Case files:**

- Create: `probes/cases/claude-stream-json-busy-input.json`
- Evidence: `evidence/claude-stream-json/<case>/evidence.json`

Execution：

1. Start experiment-owned stream-json process with fixture cwd and bounded permissions.
2. Reserve/send call 1 with active-window nonce.
3. While no first terminal result exists, reserve/send call 2 with second nonce.
4. Capture replayed user input、assistant/tool/partial/result events、session id、process state.
5. Wait only to fixed timeout; cleanly close/terminate own process.
6. Classify second input as adapter queued/provider queued/same-turn/rejected/unknown based only on timestamps、ids、acks。

Do not add kill/resume or compaction call after budget reaches 2；those remain unverified if not observable inside the case。

### Task 14: Kimi Code

**Case files:**

- Create: `probes/cases/kimi-selected-surface.json`
- Evidence: `evidence/kimi-<surface>/<case>/evidence.json`

Execution：

1. Use static preflight to choose ACP or prompt mode, preferring structured events and safe cleanup.
2. Reserve/send call 1 for normal completion/session id.
3. Reserve/send call 2 for either same-session continuation or active busy/cancel behavior; choose one before the first live call and write it to run manifest. If call 2 is cancelled, post-cancel session usability remains `unverified` because a third input is forbidden.
4. Record untested alternative as `not_executed`/`unverified`.

Stop if Kimi tries to initialize global config, requires provider selection mutation, or ACP implementation emits unredactable auth details。

### Task 15: OpenCode

**Case files:**

- Create: `probes/cases/opencode-server-selected-case.json`
- Evidence: `evidence/opencode-server/<case>/evidence.json`

Execution：

1. Start experiment-owned server bound to loopback and an ephemeral port; fixture cwd only.
2. Verify SSE before prompt if possible.
3. Reserve/send call 1 for normal prompt and terminal correlation.
4. Reserve/send call 2 for busy second input or an active input that will be aborted, chosen in manifest. If aborted, post-cancel session usability remains `unverified`; do not start a third input.
5. Close HTTP/SSE, then terminate only owned server process group.

Stop if server binds non-loopback、reuses a user's existing server、requires global config changes、or cleanup cannot prove process ownership。

### Task 16: Missing/blocked providers

Write explicit matrix/evidence rows for Qoder、ZCode、Pi and any installed Provider blocked during preflight：

- binary absent → `not_executed` + capability `unverified`；
- auth absent/payment confirmation → `blocked`；
- do not install、login、change provider or retry repeatedly。

Per-provider rollback point：protocol cancel → owned process termination → fixture snapshot → sanitized evidence → raw deletion。A failure on one Provider does not authorize extra calls or global remediation。

## 10. Phase 6 — Evidence Normalization and Matrix

### Task 17: Verify evidence package

Run:

```bash
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py verify-evidence --root .trellis/tasks/07-13-agent-runtime-capability-matrix/evidence
```

Expected checks：

- every case has schema v1、version、timestamps、terminal、cleanup、uncertainty；
- every live frame has budget reservation correlation；
- all raw paths point to deleted/nonexistent files；
- no owned PID remains；
- Provider cap never exceeds 2；
- no secret marker or Authorization-like pattern；
- fixture before/after digest available；
- blocked/not_executed rows are explicit。

### Task 18: Generate and manually review capability matrix

**File:**

- Create: `.trellis/tasks/07-13-agent-runtime-capability-matrix/provider-capability-matrix.md`

Matrix rows：

- Codex exec；
- Codex ACP；
- Codex app-server；
- Claude stream-json；
- Kimi prompt；
- Kimi ACP；
- OpenCode serve；
- OpenCode ACP；
- Qoder；
- ZCode；
- Pi/owned-loop candidate。

Columns 至少包含：version、invocation start、session persistence、structured events、completion、input ack、busy behavior、cancel、post-cancel usability、active steer、turn IDs、tool events、compaction events、suspend continuation、evidence IDs、uncertainty。

Assessor 可以生成 draft，但必须逐条人工核对：

- `verified/conditional` 是否真有 dynamic evidence；
- 没跑的 surface 是否仍为 unverified；
- same-turn 是否有 turn-id 级证据；
- session resume 是否没有被误写成 suspend；
- nominal completion 是否没有被写成 business handled。

### Task 19: Write architecture conclusion

Update：

- Modify: `.trellis/tasks/07-13-agent-runtime-capability-matrix/research.md`
- Modify: `.trellis/tasks/07-13-agent-runtime-capability-matrix/design.md` only if experiments invalidate a design assumption.

Add：

- tested portable baseline；
- per-Provider enhancement candidates；
- `delivery_uncertain` retry guidance；
- wait/RPC conclusion；
- whether Codex app-server deserves a separate adapter spike；
- whether an owned-loop/Pi spike is justified；
- follow-up production tasks, but do not create/start them before user review。

Review Gate C：evidence ids、matrix cells、written conclusions form a traceable chain。

## 11. Phase 7 — Cleanup and Rollback Verification

### Task 20: Final cleanup

1. Run harness cleanup for current run id.
2. Confirm no registry-owned PID/PGID remains.
3. Remove disposable `/tmp` fixture and raw transcripts.
4. Confirm global Provider/Auth/MCP config mtimes/hashes were not intentionally changed; do not read secret content to do this.
5. Confirm no server listens on experiment OpenCode port.
6. Preserve sanitized evidence and cleanup report only.

Suggested checks：

```bash
rtk git status --short
rtk git diff -- . ':(exclude).trellis/tasks/07-13-agent-runtime-capability-matrix'
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py verify-evidence --root .trellis/tasks/07-13-agent-runtime-capability-matrix/evidence
```

Expected：

- no production source diff from this task；
- unrelated dirty files unchanged；
- only task-local planned files/evidence changed；
- verifier passes；
- no cleanup uncertainty。If cleanup is uncertain, report it and stop instead of claiming completion。

## 12. Phase 8 — Quality Gate and Final Review

### Task 21: Project quality check

After code/evidence exists, load and run `trellis-check` for the active task. In addition to its standard checks：

```bash
rtk python3 -m unittest discover -s .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests -v
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py verify-evidence --root .trellis/tasks/07-13-agent-runtime-capability-matrix/evidence
rtk rg -n "Authorization:|Bearer [A-Za-z0-9._-]+|api[_-]?key|secret|token" .trellis/tasks/07-13-agent-runtime-capability-matrix/evidence
```

The last command is a review signal, not an automatic leak detector：expected matches must be redaction labels/schema field names only; manually inspect every match without printing raw secret-bearing files。

### Task 22: Acceptance review

Read top-to-bottom：

- `prd.md`
- `research.md`
- `research/reference-project-runtime-patterns.md`
- `design.md`
- `implement.md`
- `provider-capability-matrix.md`
- every evidence summary

Verify no placeholder、replacement character、empty evidence id、unsupported inference or contradictory conclusion remains。

Present the final evidence and recommendation to the user. Do not create or start any production follow-up task until the user reviews the result。

### Task 23: Finish workflow

Only after quality gate and user review：

- use `trellis-update-spec` if the capability contract is durable project knowledge；
- follow Phase 3 commit rules and stage only this task's intended files/spec updates；
- never stage unrelated untracked task directories；
- use `trellis-finish-work` to archive/record the completed session as appropriate。

## 13. Stop Conditions

Any one of the following stops the current Provider immediately and prevents further model inputs for it：

- login、payment confirmation、CAPTCHA、subscription/provider selection mutation；
- unexpected or abnormal credit/token consumption；
- prompt requests permission bypass or access outside fixture；
- external network/message/resource side effect is attempted or cannot be ruled out；
- Provider process cannot be tied to experiment registry；
- cancellation would require killing a user-owned/global process；
- global Provider/Auth/MCP config would need modification；
- redactor detects unclassifiable sensitive payload；
- call budget ledger is missing/corrupt or would exceed two；
- fixture path/symlink escapes `/tmp` root；
- terminal evidence conflicts after an external/unknown side effect；
- user sends a new instruction replacing the experiment。

Stop is a valid result：write `blocked` or `delivery_uncertain` evidence, clean owned resources, and do not “fix the environment” outside approved scope。

## 14. Validation Commands Summary

Before live calls：

```bash
rtk python3 -m unittest discover -s .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests -v
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py preflight --manifest .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cases/static-preflight.json --dry-run
```

After each case：

```bash
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py verify-evidence --root .trellis/tasks/07-13-agent-runtime-capability-matrix/evidence
```

Final：

```bash
rtk python3 -m unittest discover -s .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/tests -v
rtk python3 .trellis/tasks/07-13-agent-runtime-capability-matrix/probes/cli.py verify-evidence --root .trellis/tasks/07-13-agent-runtime-capability-matrix/evidence
rtk git status --short
rtk git diff --check -- .trellis/tasks/07-13-agent-runtime-capability-matrix
```

## 15. Risks and Rollback Points

| Risk | Prevention | Rollback point |
| --- | --- | --- |
| Provider credit overrun | atomic provider-level ledger, max 2, no refund/retry | before every model-bearing frame |
| User process interrupted | owned PID/PGID identity, no global kill | before protocol cancel/signal |
| Secret enters repo | raw `/tmp` only, allowlist redactor, verifier | before sanitized write and before raw delete |
| Probe mutates real project | fixture cwd guard, symlink defense | before Provider spawn |
| Unsupported inference | assessor evidence rules + manual matrix review | before matrix cell becomes verified/conditional |
| Side-effect duplicate | `delivery_uncertain`, no automatic retry | immediately after lost terminal/conflict |
| Experimental app-server instability | provider-specific case, no production adapter | stop Codex case; retain blocked evidence |
| Unrelated dirty worktree changed | scoped file list/diff, no reset/checkout | at every phase gate |

## 16. Acceptance-Criteria Coverage

| PRD acceptance criterion | Plan coverage |
| --- | --- |
| Versioned matrix with explicit levels | Tasks 2, 8, 18 |
| Pre-experiment WorkBuddy/Qoder/SmallKhoj/reference synthesis | Existing `research.md` + reference artifact; Phase 0 review |
| Verified/conditional linked to probes | INV-6, Tasks 8, 17, 18 |
| Outer invocation vs Provider Turn | Sections 2/3, Tasks 12–19 |
| Busy input ownership | Design assessment rule, Tasks 12–15, 18 |
| Completion/cancel/post-cancel usability or explicit unverified status | Tasks 12–15, matrix columns |
| Portable RuntimeCapabilities contract | Task 2, Task 18 |
| Reliable-wakeup guarantees/non-guarantees | Task 19 |
| Side-effect-aware retry | INV-8, Tasks 7/8/19 |
| Wait/RPC tier distinction | Task 19 |
| Version/frame/time/redaction/cleanup evidence | Tasks 6, 11–17 |
| No production/global/unrelated changes | fixture guard, cleanup, scoped diff |
| User reviews before follow-up production task | Task 22 |

## 17. Planning Review Question

本计划没有剩余的阻塞性技术或价值开放问题。唯一下一步决策是：用户是否批准把任务从 `planning` 激活为 `in_progress`，从 Phase 0 开始创建 task-local harness，并在 Gate A/B 通过后按已批准预算运行真实探针。
