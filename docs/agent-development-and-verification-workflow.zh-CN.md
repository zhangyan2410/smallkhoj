# Agent 开发与验证最小流程

这份文档是 SmallKhoj 开发、自动测试、真实验证和部署证据的统一索引。
开始开发时只需要调用 `trellis-before-dev`；skill 会读取本文件并生成本次任务的
开发前简报。

## 1. 动代码前

先确认任务和候选代码身份：

```bash
rtk python3 ./.trellis/scripts/get_context.py
rtk python3 ./.trellis/scripts/get_context.py --mode phase
rtk python3 ./.trellis/scripts/get_context.py --mode packages
rtk git status --short
rtk git branch --show-current
rtk git worktree list
```

然后完成以下索引：

- 任务：完整读取当前 task 的 `task.json`、`prd.md`，以及存在的
  `design.md`、`implement.md` 和直接引用的 research/evidence。
- 规范：从 `.trellis/spec/guides/index.md` 和受影响 layer 的 `index.md`
  进入实际规范；跨层、runtime、skill/platform、部署分别读取对应 guide/contract。
- 代码：先用 `codegraph status/query/explore` 找入口、调用者和测试，再用 `rg`
  查精确字符串、配置和生成副本。
- Git：记录绝对 worktree、branch 和已有 dirty 文件；非本任务改动不得覆盖或回滚。

Integration Gate 的快速合同基线很轻量，开发前先运行：

```bash
rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs
rtk node tools/integration-gate/run.mjs --help
```

如果改动影响 Server、Computer/daemon、Agent runtime、Channel/DM/Chat、协作或
Task，再按实际范围选择一个 live mode，并在修改前、修改后各运行一次：

| Mode | 适用范围 |
| --- | --- |
| `foundation-only` | auth、frontend/backend、daemon、runtime/context 就绪 |
| `chat-reply-channel-base` | 单 Agent Channel 真实回复主链路 |
| `chat-reply-channel-group` | 群聊 responder policy |
| `chat-reply-dm` | 同一 DM 中的真实回复 |
| `collab-channel-v1` | architect/worker 协作与 proof |
| `collab-channel-v2` | 协作加 reviewer acceptance |
| `collab-channel-v3` | 协作加 source-linked Task evidence |

Live Gate 使用明确的 `--server-id`、唯一 marker、准确 Agent/Channel 标识和隔离的
结果路径。环境、browser、daemon、provider 或凭据不可用时，写明 blocker；不能把
“没有运行”写成 PASS。账号、session、connect、machine、provider token 不得进入
日志、报告或提交文件。

## 2. 改完以后

按改动范围从小到大验证，不要求每个任务机械执行全部命令：

| 证据 | 什么时候需要 | 入口 |
| --- | --- | --- |
| 单元、lint、type、build | 所有受影响 layer | package 命令；完整本地矩阵用 `make ci` |
| 已认证跨层集成 | 支持的管理流程 | `make e2e-authenticated`；它不会启动服务，也不是 UI 验收 |
| 浏览器可见行为 | 页面、交互、可见状态变化 | `docs/real-test-sop-template.md` + `./twd` |
| 真实 runtime 回复 | daemon、Agent、DM/Channel 消息传递 | `docs/real-runtime-dm-reply-sop.md` + `./smallkhoj-trace` |
| 核心产品链路 | Server/Computer/Agent/Channel/Task/Chat | 修改前选择的 Integration Gate mode |

真实测试每次使用唯一 `REAL_<task>_<timestamp>` marker，并把证据放在当前 task 的
`evidence/`。截图只是辅证：浏览器结果至少要有 exact-tab URL/DOM；状态写入要有
API 或 DB 对账；runtime 回复要有 trace/Gate 对账。各证据的 marker 和稳定 ID
必须一致。

## 3. 部署声明边界

| 环境 | 能证明什么 | 不能声称什么 |
| --- | --- | --- |
| `local-dev` | 本地开发服务和功能可迭代 | local-prod 或云端可用 |
| `local-prod` | Docker/Caddy/auth/startup/proxy 的 production-shape | cloud-prod healthy |
| `cloud-prod` | 实际目标云环境的 smoke/health 结果 | 未执行的域名、HTTPS、容量或回滚能力 |

涉及发布或云端时，先读 `.trellis/spec/backend/release-pipeline.md`，再按范围读取
`.trellis/spec/backend/deployment-environment-contracts.md`。只有在目标云环境实际
执行规定的 smoke/health gate 后才能写“云端验证通过”；localhost、截图或本地
Integration Gate 都不能代替云端证据。真实部署属于外部变更，必须有用户授权。

## 4. 开发前简报

`trellis-before-dev` 在编辑前输出一份短简报：

```text
Task: 路径、状态、PRD/design/implement
Repository: worktree、branch、dirty 风险
Scope: 受影响 layer、核心数据/消息流
Specs: 本次实际读取的规范
Code map: 入口、消费者、已有测试
Baseline: 自动测试和选定 Gate 的结果；或明确 blocker
Validation: 修改后单元/CI/E2E/TWD/API/DB/trace/Gate 计划
Deployment: none、local-prod 或 cloud-prod；允许声明到哪一层
Unknowns: 仍缺失的环境或证据
```

在这份简报存在前不要编辑代码。完成后重复选定的基线，并且只声明证据真正覆盖的
流程和环境。

