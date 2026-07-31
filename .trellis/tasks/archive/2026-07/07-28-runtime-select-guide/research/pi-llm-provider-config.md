# Pi LLM Provider / Key 配置方式调研

来源：https://pt-act-pi-mono.mintlify.app/packages/coding-agent
核实日期：2026-07-28
**更新（2026-07-28）：key 决策反转 → 见下「本任务的决定」**

## Pi 原生配置机制（事实）

| 机制 | 详情 |
|---|---|
| 环境变量 | `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`（标准 provider）。**没有** `PI_LLM_API_KEY` 这类泛化变量。 |
| 配置文件 | `~/.pi/agent/settings.json`（全局）、`.pi/settings.json`（项目级）。无 `~/.pi/config.json`。 |
| CLI flag | `--provider`、`--model`。**没有** `--api-key` / `--base-url`。 |
| 内置 provider | Anthropic、OpenAI |
| 自定义 OpenAI 兼容 provider | 通过 TypeScript extension + `pi.registerProvider()`（SDK 提供 ModelRegistry/authStorage） |

## 本任务的决定（更新）

**built-in Pi 走后端 MiniMax 中转（relay），用户无需配 key。**

理由（产品方决策，2026-07-28）：Pi 的 key「通过 Claude Code 的 MiniMax 对应到 Pi」——即复用项目既有的、仅在 backend 持有的 MiniMax 供应，Pi 的模型请求经 daemon→backend relay 中转，backend 注入凭证。这让没用过 AI 的小白无需自备 key 就能用 built-in Pi。

这与 07-22 的 `pi_llm_relay.py` + `writeProviderExtension`（指向本地 AgentProxy 的 provider extension）+ lease 容量限流机制**完全一致**——直接摘用 07-22 这套，不剥离。

（之前的「用户自配标准 provider key」方案作废。）

## daemon driver 改造（相对 07-22）

**不再剥离 relay/lease**。摘用 07-22 `pi-runtime.ts` 的：
- `writeProviderExtension`（指向 AgentProxy 的 OpenAI 兼容 provider extension）
- env 注入 `SMALLKHOJ_LLM_PROXY_URL`/`SMALLKHOJ_LLM_PROXY_TOKEN`/`SMALLKHOJ_LLM_RUN_ID`
- 清空 `LLM_API_KEY`/`PI_LLM_API_KEY`（防用户本地 key 污染 relay 路径）
- lease acquire/heartbeat/release + `capacity_waiting`/`capacity_running` 事件

**只剥离** 07-22 的 `SERVER_GUIDE_ROLE_PROMPT` + `runtimeRole==='server_guide'` 分支（guide 那套不做）。`buildPiSystemPrompt` 退回只用 base prompt。

## 待真测验证点

- 选 Pi（无需配 key）创建 agent，发消息，Pi 经 relay 用 MiniMax 完成真实回复。
- 并发两回合：一 running 一 waiting，释放后 FIFO 递进。
- 长期 MiniMax 凭证不出现在浏览器/产物/daemon 配置/进程参数/日志。
- daemon-owned config home（`<workspace>/.smallkhoj/pi`）隔离用户全局 `~/.pi`。
