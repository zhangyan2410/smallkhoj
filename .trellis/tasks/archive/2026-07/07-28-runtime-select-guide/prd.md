# Runtime Select Guide and Dropdown Data-Source Fix

## Goal

让用户（尤其本机没有安装任何 coding agent runtime 的小白）在创建 agent 时，能清楚看到「我这台电脑上有哪些 runtime 可用」，选一个就能创建 agent 用起来。而不是面对一个写死的下拉框，选了本机根本没有的 runtime（例如 codex）然后创建失败。

核心是**简单有效的引导**：把 daemon 实际检测到的 runtime 能力，如实地、清楚地呈现给用户；并让「自带、不用装」的 built-in Pi 作为兜底，始终可选。built-in Pi 通过后端中转使用项目既有的 MiniMax 供应，用户**无需**自备 LLM key。

## Background / Problem

当前（main 基线 `5749828`）创建 agent 表单 `frontend/components/create-agent-form.tsx` 存在两个问题：

1. **Runtime 下拉框选项写死**（line 141）：`["claude_code|Claude Code", "codex|Codex", "custom|Custom"]`，**完全不读** daemon 上报的 `detectedRuntimes`。后果：本机没装 codex，用户也能选 Codex，选了去创建就会出错。
2. **没有 Pi 这个 runtime**：main 基线的 daemon `RuntimeType` union（`types.ts:54`）根本没有 `'pi'`，`detectedRuntimesForInventory`（`runtime-provider.ts`）也不检测 bundled Pi。所以「自带 Pi」这个兜底选项在产品里根本不存在。

值得注意的是：同一张表单的 **Provider 下拉**已经做对了（用 `detectedProviderOptions` 动态聚合 `detectedRuntimes`，还能把没检测到的标灰）。`runtime-options.ts` 里甚至已经把 `Pi` 列进了 `EXPECTED_RUNTIME_PROVIDERS`。也就是说动态检测的 helper 基础设施已经存在，只是 Runtime 下拉没用它，且 Pi 这条链路在 daemon 端断了。

## User Value

- 一个本机什么都没装的用户，打开创建 agent，能清楚看到「自带的 Pi 可用（不用装、不用配 key）」，选它就能用。
- 一个本机装了 codex 的用户，看到 codex 可选；没装的，codex 灰掉或隐藏，不会选了才错。
- 用户一眼能看清「我能用什么」，而不是在写死的下拉里猜。

## Requirements

### R1 — Runtime 选项来自实际检测，不写死
- 创建 agent 表单的 Runtime 选项必须来自 daemon 上报的 `computer.detectedRuntimes`，和 Provider 下拉用同一数据源。
- 不再硬编码 runtime 选项列表。

### R2 — 没检测到的不可选
- 本机未检测到的 runtime（如 codex 没装）必须不可选（灰掉或隐藏），不能出现「选了才在创建时报错」。
- 检测到的 runtime 正常可选。

### R3 — built-in Pi 作为兜底，始终可选且标识清楚
- daemon 端必须把 bundled Pi 作为一种检测到的 runtime 上报：`{ type: 'pi', status: 'available', source: 'bundled', version }`。
- bundled Pi 在 UI 上始终可选（因为随包自带，不依赖用户本机装东西）。
- bundled Pi 要有视觉标识，表明「自带 / 不用装」，和需要本机安装的 runtime 区分开。

### R4 — Pi 作为真正的 runtime 类型打通
- daemon `RuntimeType` union 加 `'pi'`。
- daemon 主流程能启动/管理 Pi runtime（driver 接入 `ManagedRuntimeDriver` 契约）。
- backend runtime 字段已是自由 string，无需 schema 变更；agent 创建/绑定 Pi 的路径要跑通。

### R5 — built-in Pi 走后端 MiniMax 中转，用户无需配 key
- built-in Pi 的模型请求通过后端 relay 中转，复用项目既有的 MiniMax 供应（与 Claude Code 同一来源）。用户**无需**自备或填写任何 LLM key。
- agent 的创建动作仍是用户的（前端表单提交），不是后端/daemon 替用户自动创建。
- MiniMax 并发有限：built-in Pi 的每次完整 Agent 运行/工具循环持有**一个容量租约**（durable lease），用 ready/waiting/running/exhausted/failed 状态在 UI 如实呈现，而非假设无限并发。
- 长期 MiniMax 凭证只在 backend，不得出现在浏览器响应、可下载产物、daemon/Pi 配置、进程参数或日志里。
- 非 Pi 的 runtime（claude_code/codex/custom 等）不强制走 relay，保留其既有行为。

### R6 — 引导文案清楚
- 中英文文案要让用户明白：这里列出的是「你这台电脑能用的 runtime」，选一个 + 配 key 就能建 agent；本机没装别的也没关系，有自带的 Pi。

### R7 — 不回归
- 现有 claude_code / codex / custom runtime 的行为不回归。
- 现有 Provider 下拉的动态行为不回归。
- frontend lint / tsc / build + daemon test / typecheck 全绿。

## Acceptance Criteria

- [ ] Runtime 下拉选项由 `detectedRuntimes` 动态生成，代码里不再有写死的 runtime 选项数组。
- [ ] 本机未检测到的 runtime（如 codex）在 UI 上不可选（灰掉或隐藏），不会出现选了才报错。
- [ ] daemon 上报 bundled Pi（`type:'pi', source:'bundled'`），UI 上始终可选，且有「自带/不用装」视觉标识。
- [ ] daemon `RuntimeType` 包含 `'pi'`，Pi runtime 能被 daemon 启动和管理。
- [ ] 选 Pi runtime（无需用户配 key）→ 能成功创建 agent 并启动；首个真实回合通过后端 relay 用 MiniMax 供应完成（`./twd` 真测）。
- [ ] 容量租约：并发请求时一个 running、其余可见 waiting，释放/过期后按 FIFO 递进（自动测试覆盖）。
- [ ] 长期 MiniMax 凭证不泄露到浏览器响应、产物、daemon/Pi 配置、进程参数、日志。
- [ ] 现有 claude_code / codex / custom 路径行为不回归。
- [ ] frontend `npm test` / `lint` / `tsc --noEmit` / `build` 全绿。
- [ ] daemon `npm test` / `typecheck` 全绿。
- [ ] `./twd` 可见证据：引导界面 + 不可选状态 + Pi 自带标识 + 选 Pi 创建成功。

## Out of Scope

- guide bootstrap / provisioning 权限 / systemRole（不做引导型 agent 的特权 provisioning）。
- guest role / 邀请机制改造 / 多 guest 共享单 agent（明确先不做）。
- 空 server 长状态机 / first-run onboarding 长流程（07-22 那套引导，不在本次范围）。
- 跨平台 embedded Node 打包（07-22 distribution 大改；本次 Pi 走用户本机现有 Node 即可，若真测发现必要再议）。
- 重新验证或重新审批 MiniMax 订阅本身（直接复用既有供应）。

## Notes

- 07-22 任务（`feat/bundled-pi-trial-runtime` 分支，已 stash 保存于 `stash@{0}`）的 `pi-runtime.ts` 和 bundled Pi 检测逻辑是本任务 daemon 层的可摘用资产。
- 本任务从 main 最新提交 `5749828` 开新分支 `feat/runtime-select-guide`。
