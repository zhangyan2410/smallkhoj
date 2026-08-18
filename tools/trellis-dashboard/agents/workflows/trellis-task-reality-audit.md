---
id: trellis-task-reality-audit
name: 活跃任务真实性审计
description: 逐个核实活跃 Trellis 任务的真实状态；证据充分的"已完成"写入 needsDecision 待用户拍板归档
timeoutMinutes: 60
---

你在 /Users/code/project/smallkhoj 仓库执行「活跃任务真实性审计」固定工作流。目标：核实 `.trellis/tasks/`（不含 archive/）每个活跃任务的真实状态；Trellis 状态可能过时——标 planning 但实际已实现、标 in_progress 但实际已完成。

## 执行纪律

- **顺序执行，不要派生子代理/并行任务**（headless 模式下并行子代理不稳定）；逐项做完再做下一项。

## 方法（对每个活跃任务）

1. 读 task.json（title/notes/branch/commit/children）+ prd.md 的 Goal 与 Acceptance Criteria；ls 任务目录看工件（verify-result.md / verification-record.md / quality-gate.md / evidence/）。
2. 找实现证据：
   - `git log --oneline --all --grep="<关键词>"`（英文 slug 词 + 中文标题各试）
   - prd 提到的文件/模块/符号是否落地（rg；前端 frontend/，daemon agent/daemon/，后端 backend/）
   - 工件里的完成结论（quality-gate PASS / verify-result 记录）
3. 判定：
   - **DONE**：强证据（verify 工件通过，或明确相关提交+代码落地）
   - **LIKELY_DONE**：提交/代码与验收点吻合但无 verify 工件
   - **PARTIAL**：部分实现（说明缺什么）
   - **NO_EVIDENCE**：找不到实现痕迹（状态属实）

## 对 DONE / LIKELY_DONE 的处理（重要：不自动归档）

往该任务 task.json 的 `meta.needsDecision` 写一段**自包含的平实中文**（不甩 AC 编号/黑话）：这个任务做了什么、现在到什么程度、请用户在 ①归档 ②保留 两项里选。保留原有 meta 其它键。已有 needsDecision 的任务跳过（等用户处理）。

## 边界

- 只允许写 `.trellis/tasks/*/task.json` 的 meta.needsDecision 字段（用 python json 读写，保持其它字段不动）。不改 status、不归档、不动 spec、不 git commit。
- 静态验证（rg/git log/cat）即可，不跑测试。
- 完成后输出中文总结表格：每任务一行（目录 | Trellis 状态 | 判定 | 一行证据 | 是否已标 needsDecision）。
