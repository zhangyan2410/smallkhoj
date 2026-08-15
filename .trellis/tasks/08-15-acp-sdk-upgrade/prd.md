# ACP SDK 升级 0.28.1 → 1.3.0：变更审计 + 迁移 + 沉淀

## Goal

把 daemon 的 `@agentclientprotocol/sdk` 从 `^0.28.1` 升到 `^1.3.0`（官方
1.0 稳定线），完成一次**审计驱动的协议依赖升级**：先盘点上游新功能/废弃/
行为变化，再迁移，最后把"协议 SDK 升级流程"沉淀为可复用文档——为后续
接入 kimicode / DeepSeek Harness（可能要求新协议特性）扫清依赖障碍。

## Background

- goose 任务（08-06）接入时锁 `^0.28.1`；上游 2026-06-24 发布 1.0.0
  （API 冻结），现已到 1.3.0。
- ACP 官方 SDK 家族：TS `@agentclientprotocol/sdk`（我们用）+ Rust crate
  （Zed/goose 用），同一 `agentclientprotocol` org 维护。历史包
  `@zed-industries/agent-client-protocol`（0.4.5）已废弃，勿混用。
- 审计结论（详见 research/upstream-changelog-audit.md）：**无 API 破坏**
  ——SessionUpdate 联合成员、Client 接口、PROTOCOL_VERSION(=1)、
  ndJsonStream/ClientSideConnection 全部兼容；风险集中在 1.2.0 的
  JSON-RPC 校验策略统一（行为级）。

## Requirements

### R1 升级与验证
- daemon `package.json` 升 `^1.3.0`，`npm install`。
- 回归阶梯：tsc build → 6 个相关单测文件 → `smoke:goose-acp`
  （真实 goose + 真实 LLM 中继，覆盖校验策略变化下的通知流）。
- 单测如暴露 0.28→1.3 的 shape 事实变化，更新测试内固化的事实注释。

### R2 变更审计（已完成，随任务归档）
- 新功能清单（请求取消、请求上下文、guards、v2 实验 API）与启用建议。
- 废弃清单（无 API 废弃；历史 npm 包勿用）。
- 行为变化清单（1.2.0 校验统一、ndJsonStream 线性化、TS 可扩展联合）。

### R3 沉淀
- "协议 SDK 升级流程"追加进 `.agents/skills/smallkhoj-add-runtime`：
  版本阶梯 diff 方法（npm pack 两版 diff schema literals / 导出面 /
  PROTOCOL_VERSION）、回归阶梯、何时必须升级（新 agent 按新协议版本
  握手时）。

## Non-goals

- ❌ 启用 ACP v2 实验 API / schema v2 alpha（等正式化单独立任务）。
- ❌ 协议级取消替换 daemon 现有 stall watchdog（记录为未来选项）。
- ❌ backend/frontend 无关改动。

## Acceptance Criteria

- [x] daemon 依赖 `^1.3.0`，`npm install` + `tsc` 通过。
- [x] 相关单测全绿（codex-acp-activity / codex-acp-runtime / codex-acp-mvp /
      acp-event-translator / runtime-activity / pi，38/38）。
- [x] `smoke:goose-acp` 通过（真实 goose 1.46 + MiniMax：codec/通知/负载 round-trip）。
- [x] 变更审计文档入库（research/upstream-changelog-audit.md）。
- [x] 升级流程沉淀进 skill（smallkhoj-add-runtime 附录节）。
- [x] 在 main 上直接落地（用户指定，属 contained 升级 + 全量回归）。

## Risks

- 1.2.0 校验策略统一对 goose ext 通知的拒绝行为变化——smoke gate 兜底。
- `npm install` 需网络（此前出现过需走 7887 代理的情况）。
