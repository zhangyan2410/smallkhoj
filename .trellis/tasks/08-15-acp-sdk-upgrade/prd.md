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

### R4 优雅取消（升级后追加，用户需求）
- SDK 0.29+ 的取消分两层：`session/cancel`（agent 域、goose 已实现）与
  `$/cancel_request`（JSON-RPC 传输层，legacy `ClientSideConnection.prompt`
  不透传 `cancellationSignal`，需迁新版 client API 才可用——记为后续项）。
- `ManagedRuntimeDriver` 增加可选 `requestGracefulCancel()`；goose/codex
  driver 实现（`bridge.cancel`）。
- daemon 停滞看门狗分级：先优雅取消 → 宽限（min 30s 或 stallTimeout）→ 才
  SIGKILL；进度恢复即重置。无取消能力的 runtime 直接走原 kill 路径。
- goose smoke 增加 `--cancel-after-events <n>` 取消模式。

## 后续任务登记（本任务只登记不实施）

- **B. 用户侧取消入口**（后续做，用户已定）：产品 UI 的任务取消/停止回合
  走 daemon `requestGracefulCancel()`，而不是只能等 turn 自然结束或被
  stall 看门狗杀掉。独立小任务。
- **C. 桥迁移到新版 client API**：legacy `ClientSideConnection.prompt` 不
  透传 `cancellationSignal`；迁移后解锁 `$/cancel_request`（传输层取消）
  与 handler 请求上下文（prompt/响应关联排障）。独立任务。
- **D. goose 无效 env 修正**（属 08-06 遗留）：`GOOSE_DISABLE_SESSION_NAMING=1`
  对 goose 1.46 失效，每 turn 多一次 session 命名 LLM 调用；需查 1.46 的
  正确开关或改 config 方式。已同步登记到 08-06 遗留清单。
- **G1. scoped session 映射不持久化（bug，用户定性）**：`ScopedProviderSessionStore`
  纯内存 Map（session-scope.ts:95），daemon/runtime 重启即丢 → 同 scope 反复
  新建 goose/codex session → 每条新 session 首次 LLM 调用缓存全不命中
  （实测冷启动 1-2% vs 会话内 98-99%）。叠加 warmup/任务 scope 各自建
  session，一次 DM 测试多付 3-4 次全价首调。
- **G2. slock 系统提示词每 turn 重发（bug，codex 历史欠账，goose 原样继承）（✅ 已修复）**：
  提示词未进 system 槽，而是经 `buildCodexPrompt` 拼进每条 user 消息
  （实测 27.5k-29.7k 字符/条，~9k token），每 turn 滚入历史灌水上下文；
  会话内靠缓存压价，新 session 首调全额付。goose 与 codex 同修：改为
  每 session 随首条 prompt 发一次，需设计长会话/goose 压缩后的兜底。
  落地：`writeAgentInstructionsFile` 写 `<workspacePath>/AGENTS.md`
  （marker 幂等合并，保留 agent 自己追加的内容），goose / codex-acp /
  codex-exec 三个 driver 逐 turn 只发裸事件文本；压缩兜底 = 指令在 agent
  自身 system 槽（AGENTS.md）、不在会话历史里，天然免疫 compaction。
  实测数字见验收区 G2。
- **P1. daemon-runtime.test.mjs 预存在问题（main 既有，非本任务引入；本任务
  只顺手修其一）**：在干净 HEAD 90b2bf7 上复现——(a) runtime inventory 断言
  自 08-06 合入 goose 后漏更新（期望四 runtime 不含 goose，已随本任务修正为
  五个并调整顺序断言）；(b) 一批走 daemon 启动假 runtime 的测试（"fake
  Claude with the workspace aura wrapper" 等）因代理 fetch 上游失败而挂
  （Error: fetch failed / HTTP_502），成因待查（环境或 main 回归）；
  (c) 失败路径泄漏 startServer 句柄导致整个测试文件进程不退出（疑似
  close 不在 finally）——历史上多轮 `npm test` 因此挂死残留进程。需独立
  任务修复（含把各 upstream.close() 挪进 finally）。
- **G3. goose session 命名开关失效（bug）**：`GOOSE_DISABLE_SESSION_NAMING=1`
  对 goose 1.46 无效，每 session 白跑一次命名 LLM 调用（实测 6,371 input，
  不命中缓存）。改用 goose config 方式关闭。
- **H. 对照参考项目 agent-platform（NAP）逐项审计 ACP 封装（✅ 已完成，
  见 research/acp-wrapping-vs-nap-audit.md）**：判定——G2 与 B 均为**漏抄**
  （NAP 把系统提示词写 AGENTS.md、每 turn 只发裸消息；interrupt 端点即
  用户取消的参考实现）；G1 为**我们架构独有**（resident daemon 的 scope
  映射层，NAP 无此层，需自设计持久化）；G3 自查（NAP config 全托管无对应）。
  G2 修法要点：写 `<workspacePath>/AGENTS.md`（不能写共享的
  ~/.config/goose/AGENTS.md，多 agent 会互相覆盖），goose/codex 同修；
  验收 = 缓存命中率与新 session 首调 input 量复测。

## Non-goals

- ❌ 启用 ACP v2 实验 API / schema v2 alpha（等正式化单独立任务）。
- ❌ 协议级取消替换 daemon 现有 stall watchdog（记录为未来选项）。
- ❌ backend/frontend 无关改动。

## Acceptance Criteria

- [x] daemon 依赖 `^1.3.0`，`npm install` + `tsc` 通过。
- [x] **R1.1 smoke 真实性硬断言**：错误 turn 不得 PASS。落地时发现 goose 1.46
      会把错误 turn 的报错文本本身作为 `item_delta` 流出（"Ran into this
      error: ..."），只数 delta 拦不住——最终 gate = 有流式 delta **且** 无
      goose 错误包装文本 **且** usage 计数 >0（错误 turn usage 恒为 0）。双向
      真机验证：真 key PASS（streamingDeltas=2, inputTokens=5323）；坏 key
      FAIL（exit 1，maxUsageTokens=0 被抓）。
- [x] **G2 实测（真 goose 1.46 + MiniMax-M3，driver 级两 turn）**：
      - per-turn prompt 27 字节（旧实现 ~27,500 字符）；
      - `<workspace>/AGENTS.md` 落盘 26,966 字符且含 slock 指令；turn-1 input
        10,844（= goose 基础提示 + AGENTS.md 进 system 槽；user 消息仅 27 字节
        ——指令唯一来源就是 AGENTS.md，双向证明）；
      - turn-2 input 11,203，**增量 +359**（旧实现此处每 turn 再滚 ~9k）；
      - 复用 session 的 smoke run cache 命中 5,201/5,254 ≈ 99%。
      注：PRD 原先预期"新 session 首调 10-30k → 1-2k"不成立——AGENTS.md 合法地
      进入 goose system 槽，首调仍需支付一次指令 input（~10k），真正的收益是
      多 turn 不再滚入历史（+359/turn vs +9k/turn）与指令免疫 compaction。
- [x] 相关单测全绿（codex-acp-activity / codex-acp-runtime / codex-acp-mvp /
      acp-event-translator / runtime-activity / pi，38/38）。
- [x] `smoke:goose-acp` 通过（真实 goose 1.46 + MiniMax：codec/通知/负载 round-trip）。
      注：升级当轮的 smoke 因 key 取自已删除的 worktree .env 而空跑（错误 turn
      假阳性）；已用 cc-switch 源的 MiniMax token 重跑确认为真实流式回复。
- [x] 优雅取消落地：驱动级单测 ×2（codex/goose，fake-ACP 取消生命周期）+
      真机 cancel smoke（sleep 30 工具调用中途取消 → stopReason cancelled）+
      看门狗先取消后 SIGKILL；测试阶梯 40/40。
- [x] 变更审计文档入库（research/upstream-changelog-audit.md）。
- [x] 升级流程沉淀进 skill（smallkhoj-add-runtime 附录节）。
- [x] 在 main 上直接落地（用户指定，属 contained 升级 + 全量回归）。

## Risks

- 1.2.0 校验策略统一对 goose ext 通知的拒绝行为变化——smoke gate 兜底。
- `npm install` 需网络（此前出现过需走 7887 代理的情况）。
