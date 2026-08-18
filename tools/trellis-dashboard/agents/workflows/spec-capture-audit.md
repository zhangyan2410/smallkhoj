---
id: spec-capture-audit
name: Spec 沉淀审计（增量）
description: 扫描 ledger 里还没有的归档任务/自建 skill，对照 .trellis/spec 判定缺口并当场沉淀，更新 capture-ledger.json
timeoutMinutes: 60
---

你在 /Users/code/project/smallkhoj 仓库执行「Spec 沉淀审计（增量）」固定工作流。目标：把上次审计之后新归档的任务（和新建的自建 skill）里值得沉淀的经验写进 spec，并更新台账。

## 执行纪律

- **顺序执行，不要派生子代理/并行任务**（headless 模式下并行子代理不稳定）；逐项做完再做下一项。

## 数据源与判定顺序

1. 读 `.trellis/spec/capture-ledger.json`（schema trellis.spec-capture.v1），记下 `auditedAt` 和已有条目的 `month:id` 集合。
2. 枚举 `.trellis/tasks/archive/*/`（形如 2026-08/<dir>）全部归档任务；差集 = 本次要审的**新任务**（通常 0~30 个；若超过 50 个，分批处理并在总结里说明剩余量）。另外检查 `.agents/skills/` 下是否有 ledger 里没有的**非 trellis-\* 自建 skill**（kind=skill 条目）。
3. 对每个新条目：读 task.json（title/notes）+ prd.md 的 Goal/Acceptance（长的只读前 60 行），判定：
   - **GAP**：含值得沉淀但 spec 没写的经验——判定前必须 grep `.trellis/spec/`（backend/frontend/guides）确认确实没有（记下你 grep 的关键词）
   - **COVERED**：已有 spec 覆盖（注明哪个文件）
   - **SKIP**：一次性实现/纯调研/被取代（≤8 字理由）

## 沉淀标准与写法（只对 GAP 执行）

- 值得沉淀：可执行契约（签名/载荷/错误行为）、编码约定、跨层 gotcha、防重犯教训。一次性功能本身不算。
- 写法遵循 `.agents/skills/trellis-update-spec/SKILL.md` 的口径（可读它）：优先在既有文件的既有章节内追加条目；只有跨层契约才新开 `## Scenario:`（七段：Scope/Signatures/Contracts/Validation & Error Matrix/Good-Base-Bad/Tests Required/Wrong vs Correct）；单条约定用 `### Convention:` 或 bullet。内容具体可执行，不写原则空话。
- 中文注释可以，spec 正文语言跟随所在文件现状。

## 台账更新

- 对每个处理过的条目在 capture-ledger.json 的 items 里追加：{"kind": "task"|"skill", "month": "<归档月>"|null, "id": "<目录名或 skill 名>", "status": "captured"|"covered"|"skipped", "target": "<spec 相对路径或 null>", "note": "<≤30字概要>"}；更新顶层 auditedAt 为今天。保持 JSON 合法、既有条目不动。

## 边界

- 只允许写：`.trellis/spec/**/*.md` 和 `.trellis/spec/capture-ledger.json`。不碰代码、不 git commit、不动 `.trellis/spec-zh/`（中文刷新是另一个工作流）。
- 静态验证只用 rg/cat/ls；不跑测试套件。
- 完成后输出中文总结：新审 n 条（captured x / covered y / skipped z）、每条 captured 一行落点。
