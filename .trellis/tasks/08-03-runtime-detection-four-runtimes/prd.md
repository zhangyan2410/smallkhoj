# Detected runtimes: 4-runtime local CLI detection without ccswitch dependency

## Goal

让「检测到的运行时」对**没有配置 ccswitch 的用户**也可用。

当前问题：daemon 的 `detectedRuntimes` 主要靠读 ccswitch / ccs-claude / opencode
配置产出 provider 条目；没配 ccswitch 的机器几乎看不到有用信息，而且 provider
条目随用户配置膨胀（参考图里 9+ 个 chip），语义不符合「这台机器能跑哪些 runtime」。

产品只支持 4 种 runtime：**claude_code / codex / opencode / pi**。

## Requirements

### R1 — daemon 上报固定 4 种 runtime

- `detectedRuntimesForInventory` 始终输出 4 条 runtime 条目：
  - `claude_code`：`detectClaudeCommand` 命中 → `available`，否则 → `not_installed`
  - `codex`：`detectCodexCommand` 命中 → `available`，否则 → `not_installed`
  - `opencode`：`detectOpenCodeCommand` 命中 → `available`，否则 → `not_installed`
  - `pi`：bundled layout 在 → `available`（`source: bundled` + version），不在 → `not_installed`
- 不再把 daemon 自己的 `config.runtime` 当作第一条上报（避免「配了 claude_code 就只
  显示 claude_code」的误导）。
- `DetectedRuntime.status` 联合类型加 `not_installed`（daemon TS 类型 + 后端序列化透传）。

### R2 — provider 条目变成可选附加

- ccswitch / ccs-claude / manual / opencode-config 检测出的 provider 条目**仍然上报**
  （`runtimeProvider`/`provider`/`model`/`source`），供 Provider 下拉等高级用法使用，
  但前端 Computers 页默认不把 provider 条目和 4 条 runtime 条目混在一起平铺。
- 检测可用性**完全不依赖** ccswitch：没装 ccswitch 时 4 条 runtime 条目照常出现。

### R3 — 前端展示

- Computers 详情页 chips：4 条 runtime 条目保持英文品牌名
  （Claude Code / Codex / OpenCode / Built-in Pi），`not_installed` 用灰色/禁用样式，
  provider 附加条目不在这个区平铺（或折叠到次要位置，取实现简单的方案）。
- `runtimeLabel` 补 `opencode` / `pi` / `not_installed` 的映射与状态文案
  （i18n：`未安装` / `not installed`）。

## Acceptance Criteria

- [ ] 无 ccswitch 环境的机器上，`detectedRuntimes` 含全部 4 条 runtime 条目，
      未安装的标记 `not_installed`（daemon 单测覆盖）。
- [ ] 有 ccswitch 的机器上，provider 条目仍上报且不丢失 `runtimeProvider`。
- [ ] Computers 页对无 ccswitch 用户显示 4 个 chip，品牌英文名 + 中文状态。
- [ ] frontend `bun test`、daemon `node --test`（相关文件）、backend pytest、
      Integration Gate 合同测试全绿。
- [ ] `./twd` 真实 UI 验证 Computers 详情页 chips 区。

## Out of scope

- 不改 runtime 启动逻辑（`resolveRuntimeProviderLaunch` 行为保持不变）。
- 不动 create-agent-dialog 的 Provider 下拉数据源（仍可用 provider 条目）。

## Notes

- daemon 源码：`agent/daemon/aaa-daemon/src/runtime/runtime-provider.ts`；
  上报点 `src/daemon/daemon.ts:754,1697`。
- 前端：`frontend/lib/control-plane.ts runtimeLabel`、
  `frontend/app/(app)/computers/page.tsx RuntimeStatusChip`、
  `frontend/lib/runtime-options.ts`。
