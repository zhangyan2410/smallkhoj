# 接手说明：Runtime Activity 与 Aura 命令统一

更新时间：2026-08-05（Asia/Shanghai）

## 0. 当前结论

用户已明确要求当前 Agent 停止继续实现，只整理上下文并交给下一位接手者。
因此，这份文件是当前工作树的交接入口；从这里开始，不要根据 Raft task
#1 顶层消息里“当前错误实现”的旧描述直接回滚代码。那段文字记录的是
2026-08-04 的初始诊断，后续已经按 Claude 基线纠正，并又完成了 Aura
短命令与干净首启测试。

当前候选实现的结论是：

1. Codex/OpenCode Activity 已按 Claude Code 的产品语义归一：
   Working → Thinking → Ran <tool> → Thinking（如有）→ Idle。
2. Claude、Codex、Codex ACP、OpenCode、Pi 的新建或新启动 runtime，其
   Agent-facing 提示词、示例、workspace memory、纠错/回退文案一律只教
   PATH 中的裸 aura；不得出现或教授 slock、raft 命令名。
3. slock/raft wrapper 仅继续作为既有调用方的兼容别名；不得把这些别名注入
   新 runtime、推荐给模型，或作为 aura 失败后的提示词回退方案。
4. Activity 预览只清理 proxy secret，不再把绝对 wrapper 路径伪装成短命令。
   短预览必须来自 provider 实际执行的 aura 命令。
5. “全新电脑、空 HOME、没有预装协作 CLI”已有自动化矩阵证明；宿主 PATH
   中即使有一个故意错误的 aura，runtime-local .slock/aura 仍优先。
6. 当前改动没有 commit、push、publish、PR 或 merge。用户要求停止后，
   不要继续扩写实现，除非获得新的明确授权。

## 1. 仓库与 Git 边界

- 仓库：/Users/code/project/smallkhoj
- 分支：main
- 当前 HEAD：4784ef0
- 远端基线：origin/main = 5803dd6
- 当前状态：main 相对 origin/main ahead 7
- Trellis 任务：
  .trellis/tasks/08-04-repair-codex-opencode-runtime-gates
- Trellis task.json 仍为 in_progress，父任务是
  08-03-runtime-detection-four-runtimes。

最近 8 个提交：

~~~text
4784ef0 docs(trellis): record runtime gate contracts and evidence
99f43e6 fix(frontend): clarify runtime diagnostics and gate skips
04c2463 feat(integration-gate): add four-runtime foundation profiles
31c12d1 fix(daemon): harden Codex ACP runtime diagnostics
ccce58e fix(backend): accept OpenCode runtime aliases
5b192d4 chore(frontend): remove dead code + wire task-board i18n
0281cf7 fix(frontend): harden auth/me fetch with timeout and retry
5803dd6 chore(daemon): publish local candidate 0.2.4
~~~

不要改写这 7 个本地提交的历史，不要 reset、stash、checkout 或清理当前 dirty
工作树，也不要 push。当前未提交 patch 是这次 Activity/Aura follow-up 的唯一
现场，必须原地保护。

### 明确属于用户、禁止纳入本任务的 dirty 文件

- .gitignore
- docs/multi-agent-development-workflow.md

不要编辑、回退、格式化、暂存或提交这两个文件。

### 当前 Activity/Aura follow-up 的 dirty 文件

规范与任务资料：

- .trellis/spec/backend/event-delivery-contracts.md
- .trellis/spec/backend/runtime-slock-integration.md
- .trellis/tasks/08-04-repair-codex-opencode-runtime-gates/prd.md
- .trellis/tasks/08-04-repair-codex-opencode-runtime-gates/design.md
- .trellis/tasks/08-04-repair-codex-opencode-runtime-gates/implement.md
- .trellis/tasks/08-04-repair-codex-opencode-runtime-gates/evidence/quality-gate.md
- .trellis/tasks/08-04-repair-codex-opencode-runtime-gates/evidence/live-test-boundary.md
- 本文件 handoff.md

Daemon 源码：

- agent/daemon/aaa-daemon/src/daemon/daemon.ts
- agent/daemon/aaa-daemon/src/runtime/runtime-activity.ts（新增、未跟踪）
- agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts
- agent/daemon/aaa-daemon/src/runtime/codex-acp-bridge.ts
- agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts
- agent/daemon/aaa-daemon/src/runtime/codex-runtime.ts
- agent/daemon/aaa-daemon/src/runtime/opencode-server-runtime.ts
- agent/daemon/aaa-daemon/src/runtime/pi-runtime.ts
- agent/daemon/aaa-daemon/src/runtime/slock-wrapper.ts

测试：

- agent/daemon/aaa-daemon/test/runtime-activity.test.mjs（新增、未跟踪）
- agent/daemon/aaa-daemon/test/codex-acp-runtime.test.mjs
- agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs
- agent/daemon/aaa-daemon/test/opencode-server-runtime.test.mjs
- agent/daemon/aaa-daemon/test/proxy-wrapper.test.mjs
- agent/daemon/aaa-daemon/test/runtime-mcp.test.mjs
- scripts/tests/test_build_daemon_distribution.py

## 2. 用户确认的产品合同

### 2.1 Activity 必须复制 Claude Code 的可观察语义

正确的时间顺序：

~~~text
Working on message
Thinking（模型分析、旁白或运行时正文预览；details.thought）
Ran <tool>（真实工具执行；details.commandPreview）
Thinking（工具之后仍有正文时）
Idle
~~~

前端按最新在前显示，因此视觉顺序通常相反。核心不是改 Activity 类型名称，
而是让 Codex/OpenCode 的 provider 事件适配成相同、可读的产品语义：

- 用户输入、投递用 [event=...] envelope、连接/session 事件不能成为
  Thinking 或 Output。
- Codex agent_thought_chunk 与 agent_message_chunk 都属于可读
  Thinking，不生成泛化的 Generated output。
- 只有真实工具执行生成一次 Ran <tool> Output。
- tool terminal update 不额外制造 Tool completed / Tool failed Activity；
  它仍可用于 TaskRun/provider 计数与完成边界。
- diagnostics 优先分类成 Warning/Error，不能误标成 Thinking。
- Working、Thinking、Output、Idle 必须按 provider 顺序持久化，Idle 最后。

权威需求与设计见 prd.md 的 R6、design.md 第 10 节，以及
.trellis/spec/backend/runtime-slock-integration.md 的
“Runtime-Specific Stream Events Use A Shared Activity Contract”。

### 2.2 新 runtime 的 Agent 提示词只教 aura

用户纠正了早期“只在 Activity 展示层折叠绝对 wrapper 路径”的方案。正确合同是：

~~~text
runtime child PATH
  = <workspace>/.slock : <host PATH>

provider tool input
  = aura message send ...
  -> <workspace>/.slock/aura
  -> dist/slock-cli.js
  -> daemon-local proxy
~~~

关键边界：

- Claude、Codex、Codex ACP、OpenCode、Pi 的新建或新启动 runtime，所有
  Agent-facing system/instruction prompt、prompt suffix、命令示例、workspace
  memory、纠错与回退文案都只能写裸 aura。
- 上述 Agent-facing 内容不得出现 slock 或 raft 命令名，也不得暗示模型学习、
  尝试或回退到这些旧命令。该限制适用于新 session、重建 session 与后续 turn，
  不能只在首次 prompt 中满足。
- warmup 同样只执行 aura server info；不得借 warmup 或诊断文案把兼容别名
  重新教给模型。
- runtime-local .slock 必须是 child PATH 第一项。
- 包级/全局 aura 目前是 daemon 主命令，不是 agent message CLI；因此
  workspace-local aura 必须抢在宿主命令之前。
- .slock、SLOCK_*、dist/slock-cli.js 等内部实现命名不在本次重命名范围；只要
  它们不进入 Agent-facing 内容，就不构成提示词违约。
- .slock/slock 与 .slock/raft wrapper 继续保留，且只作为旧调用方、旧脚本或
  历史集成的命令解析兼容别名。本 patch 不删除这些别名；兼容性只存在于命令
  解析层，Agent-facing prompt/memory/warmup/诊断不得主动告知、教授或推荐它们，
  也不得在 aura 失败时引导模型回退使用它们。
- warmup 使用 aura server info，故意验证 PATH，而不是绕过 PATH 直接调绝对路径。
- Activity 仅删除 proxy env/token-file 内容；不改写 wrapper 路径。若以后又看到
  绝对 wrapper 路径，应把它当上游回归暴露出来。

验收必须分别证明两个边界，不能用其中一个替代另一个：

1. 各 runtime 最终组装并交给 Agent 的提示内容包含 aura，且不包含 slock/raft
   兼容命令名；检查对象是最终 Agent-facing 内容，不是对整个源码仓库做字符串
   清零，因为内部实现名仍允许保留。
2. slock/raft wrapper 仍可供既有调用方解析与执行；不能通过删除兼容别名来满足
   第一项，也不能只在 Activity 展示层隐藏它们。

权威需求与设计见 prd.md 的 R7、design.md 第 11 节，以及
.trellis/spec/backend/runtime-slock-integration.md 的
“Runtime Agents Use Short Aura Commands From PATH”。

## 3. 已落地实现地图

以下行号对应当前未提交工作树，后续编辑后可能漂移。

### 3.1 Provider Activity 翻译与 daemon 编排

- src/runtime/runtime-activity.ts:32
  translateRuntimeStreamActivity 是新的纯翻译边界。它把四类 runtime 的
  assistant thinking/text 映射为 thinking，把真实 tool_use 映射为
  tool_use signal，并保留 protocol/sourceEvent。
- src/daemon/daemon.ts:424 与 :435
  beginRuntimeActivityTurn 在 runtime 忙时排队新 Activity turn，避免把后一条
  入站消息错误并入前一轮。
- src/daemon/daemon.ts:1172
  stream_event 统一经过 translator；diagnostic 先分流；warmup/idle narration
  被过滤。
- src/daemon/daemon.ts:1211
  toolUseId 去重，只有真实工具生成 Ran <tool>。
- src/daemon/daemon.ts:1222
  details.commandPreview 在写 Activity 前仅做敏感信息清理。
- src/daemon/daemon.ts:1328
  message_sent 边界后启动排队的下一 Activity turn。
- src/daemon/daemon.ts:1932
  每个 runtime 用 activityReportChain 串行 POST，并检查非 2xx；
  provider stream 本身不被同步阻塞。
- src/daemon/daemon.ts:2733
  sanitizeRuntimeCommandPreview 删除 proxy env 与 token-file 路径，不再做
  wrapper-path 语义替换。

### 3.2 OpenCode 角色、reasoning、tool 与 SSE 完成边界

- src/runtime/opencode-server-runtime.ts:75
  parseOpenCodeModel 分离 provider/model。
- src/runtime/opencode-server-runtime.ts:111
  prompt 只允许 workspace-local PATH 中的 Aura CLI。
- src/runtime/opencode-server-runtime.ts:240
  buildOpenCodeRuntimeEnv 注入 SLOCK 身份、PATH 第一项并移除原始 proxy secret。
- src/runtime/opencode-server-runtime.ts:571
  message.updated 记录 messageID → role。
- src/runtime/opencode-server-runtime.ts:579
  message.part.delta 在角色未知时先缓冲；user part 被过滤；assistant
  reasoning/thinking/text 被规范成 assistant stream event。
- src/runtime/opencode-server-runtime.ts:625
  updated part 走同一角色过滤和 reasoning/text/tool 归一。
- src/runtime/opencode-server-runtime.ts:700
  emitToolUseOnce 按 call id 去重。pending shell 没有 command 时延迟到后续
  running/terminal update，避免只显示无意义的 bash。
- src/runtime/opencode-server-runtime.ts:750
  乱序 role 缓冲是有界的：每个 message 最多 100 个事件、map 最多
  256 个 message；不要把它误记为无界队列。
- src/runtime/opencode-server-runtime.ts:761
  HTTP result 前做 bounded SSE drain，给晚到的 terminal/final narration
  一个短窗口。

### 3.3 Aura PATH、prompt、warmup 与发布包

- src/runtime/claude-runtime.ts:53
  Claude 与复用该 prompt 的 Pi 使用 aura CLI ONLY；Agent-facing prompt 不含
  slock/raft 兼容命令名。
- src/runtime/codex-runtime.ts:46
  Codex prompt 只教 PATH-injected aura，不教 slock/raft 兼容命令名。
- src/runtime/codex-acp-runtime.ts:59
  Codex ACP 同样只教 aura，并保留原有 printf/no-heredoc 约束。
- src/runtime/opencode-server-runtime.ts:111 与 :240
  OpenCode prompt/env 补齐 Aura 与 PATH 合同；prompt 不暴露 slock/raft 兼容别名。
- src/runtime/pi-runtime.ts:72 与 :116
  Pi 复用 Claude prompt，并暴露可测试的 buildPiRuntimeEnv；保留 relay
  变量，同时清理 ambient Slock proxy/provider secret。
- src/runtime/slock-wrapper.ts:38 与 :159
  workspace memory 只推荐 aura；slock/raft wrapper 仅为旧调用方保留；
  prependPathEnv 提供统一 PATH 构造。
- src/daemon/daemon.ts:1480
  warmup 改成 aura server info。
- test/proxy-wrapper.test.mjs:162
  干净首启矩阵使用空 HOME、空 workspace、故意错误的宿主 aura，逐一证明
  Claude/Codex/OpenCode/Pi 都命中新生成的 workspace wrapper。
- scripts/tests/test_build_daemon_distribution.py:37 与 :84
  distribution fixture/归档断言显式证明 dist/slock-cli.js 随包发布。

## 4. 已有验证证据

完整记录见 evidence/quality-gate.md；不要只看聊天中的早期计数，因为新增测试后
总数已经变化。

| 范围 | 命令 | 当前记录 |
| --- | --- | --- |
| Daemon build | rtk npm run build | PASS |
| Aura/Activity/Codex/OpenCode focused | rtk node --test test/proxy-wrapper.test.mjs test/runtime-mcp.test.mjs test/opencode-server-runtime.test.mjs test/codex-acp-runtime.test.mjs test/runtime-activity.test.mjs | 73/73 PASS |
| 完整 daemon runtime | rtk node --test --test-reporter=dot test/daemon-runtime.test.mjs | 32/32 PASS |
| Distribution artifact | rtk python3 -m unittest scripts.tests.test_build_daemon_distribution | 5/5 PASS |
| Integration Gate pure tests | rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs | 51/51 PASS |
| Diff hygiene | rtk git diff --check | PASS |

Aggregate rtk npm test 的最新记录是 295/296，不得宣称整体 PASS。唯一失败是
既存、可独立复现的 real bundled Pi case：

- agent/daemon/aaa-daemon/test/pi-runtime.test.mjs:306
- 测试名：real bundled Pi loads the scoped provider and streams through
  AgentProxy without provider credentials
- 现象：生成的 provider endpoint 没有被调用
- Activity/Codex/OpenCode 相关 target 没有失败

Pi 的历史真实 reply path 还有 Pi 0.73.1 Anthropic SSE usage shape 崩溃边界；
见 evidence/pi-runtime-status.md。provider HTTP 200 不能被写成 Pi reply PASS。

### 真实 UI 证据的准确用途

evidence/live-test-boundary.md 记录了 current-tree daemon 与 open1 的真实
Activity 顺序 PASS，marker 为 ACTIVITY_QA3_20260805T0155_b42f，截图为
/tmp/smallkhoj-activity-qa3.png。

这张截图发生在最终 Aura 修正之前，只能证明：

- Working / real tool Output / readable Thinking / Idle 的分类与顺序；
- 没有新的 Generated output、Tool completed、Tool failed；
- 用户输入没有变成 Thinking。

它不能证明 provider 实际执行了裸 aura，也不能证明绝对 wrapper-path
rewrite 已删除。Aura 的证据是干净首启自动化矩阵，不要把旧截图扩大解释。

## 5. 尚未完成或明确不在本 patch 内的事项

### 5.1 当前代码候选仍未提交

本轮 Activity/Aura follow-up 只在工作树中，尚未 commit。用户此刻要求停止，
所以接手者的第一动作应是审阅和保护现场，不是继续加功能。是否提交、拆 commit、
推送或合并，都需要新的明确授权。

### 5.2 OpenCode 有输出但未发送可见聊天回复

早期真实 marker 曾出现 provider 有 outputTokens 与 Activity，但模型没有执行
消息发送命令，因此聊天没有 Agent 回复。这个问题与 Activity 分类不同：

- 不要在本 patch 中增加“自动把 transcript 回写聊天”的 fallback。
- 先保持当前 Activity/Aura 合同；是否新增 visible-reply fallback 由用户单独立项。

### 5.3 Aura 没有新的 live UI 验收

最终 Aura follow-up 没改 UI，且用户已经要求停止，因此没有重跑 live browser。
若后续静态检查或自动化仍不足以确认新 runtime 的真实提示词/命令行为，接手者
必须先联系用户，由用户决定并配合真实测试；不得自行启动真实测试。获得用户
明确确认后，必须使用 current-tree daemon、唯一 marker、明确 Agent/session
identity，并确认 Activity 显示的命令确实来自实际裸 aura tool input；不要复用
旧截图冒充证据。

### 5.4 独立 PRD 素材，不得顺手塞进本 patch

用户在 2026-08-05 的产品讨论中确认了两项后续方向：

1. 稳定身份：
   - 数据模型需要不可变、唯一的 handle；
   - 不是 runtime 启动时加载全 server roster；
   - 参考 Raft，在成员加入 channel 时向该 channel 范围广播“谁加入了”。
2. 消息引用：
   - agent-facing 契约不应暴露、鼓励或要求理解 seq；
   - 即使数据库内部 seq 目前是 global identity/unique，也只能做内部排序、
     游标与续传；
   - agent 使用 reply-safe target、稳定 msg/message ID、time 和内容上下文；
   - 精确读取/resolve/read-around 应围绕稳定 msgId，而不是 seq。

STOP/静音不是用户需求，已经明确删除。不要把它写回 PRD，也不要实现。

以上是另一项 PRD/协议设计工作，涉及消息投递 canonical output、历史读取与
引用协议，必须单独建任务、设计和验收；本 Activity/Aura patch 没有实现它们。

## 6. 下一位接手者的操作顺序

### 第一步：只读确认现场

~~~bash
cd /Users/code/project/smallkhoj
rtk git status --short --branch
rtk git log --oneline --decorate -8
~~~

必须看到 main、HEAD 4784ef0、ahead 7，并确认 .gitignore 与
docs/multi-agent-development-workflow.md 仍然保留且不纳入。

### 第二步：按权威顺序阅读

1. 本文件 handoff.md
2. prd.md（重点 R6、R7、Acceptance Criteria、Out of Scope）
3. design.md（重点第 10、11 节）
4. implement.md（重点第 10、12 节）
5. evidence/quality-gate.md
6. evidence/live-test-boundary.md
7. .trellis/spec/backend/runtime-slock-integration.md 中新增的 Aura/Activity 场景
8. 本文件第 3 节列出的精确源码锚点

Raft task #1 顶层消息只作历史诊断材料，不能覆盖上述当前权威状态。

### 第三步：按变更类型选择验证，不重复无意义的全套运行

如果只做文档审阅且源码未变：

~~~bash
rtk git diff --check
~~~

如果修改 Aura prompt/env/wrapper/packaging：

~~~bash
cd agent/daemon/aaa-daemon
rtk npm run build
rtk node --test test/proxy-wrapper.test.mjs test/runtime-mcp.test.mjs test/opencode-server-runtime.test.mjs test/codex-acp-runtime.test.mjs test/runtime-activity.test.mjs
cd /Users/code/project/smallkhoj
rtk python3 -m unittest scripts.tests.test_build_daemon_distribution
~~~

如果修改 Activity/OpenCode stream 编排：

~~~bash
cd agent/daemon/aaa-daemon
rtk npm run build
rtk node --test test/runtime-activity.test.mjs test/codex-acp-mvp.test.mjs test/codex-acp-runtime.test.mjs test/opencode-server-runtime.test.mjs
rtk node --test --test-reporter=dot test/daemon-runtime.test.mjs
~~~

只有用户明确要求 aggregate gate 时才再跑 rtk npm test，并预期先核对既知 Pi
失败；不要因为 295/296 就误改 Activity/Aura 代码。

### 第四步：等待明确授权再改变 Git/产品状态

没有新授权时，不要：

- commit、push、publish、开 PR、merge；
- 重启/停止共享的 3000/8000；
- 修改 Claude/Codex/OpenCode/Pi provider 配置、CC Switch current/default、
  user-home 配置或项目 env；
- 创建/清理 protected DB 中的 Agent/workspace；
- 扩展 handle、seq、visible-reply fallback 或 STOP/静音需求。

如用户指定下一位 Agent 接手，应先让当前 Agent 解除 Raft task #1 的 claim，
再由下一位 Agent claim；不要两人同时在同一个 dirty main 工作树写代码。

## 7. 交接完成标准

接手者能准确复述以下四点，即说明上下文没有丢：

1. Activity 复制的是 Claude 可读语义，不是 Generated output 合同。
2. aura 是 runtime 实际执行的 PATH 短命令，不是 Activity 展示层替换。
3. 旧 live 截图只证明 Activity 顺序；Aura 由干净首启自动化证明。
4. 当前 dirty patch 未提交，两个用户 dirty 文件必须排除，handle/seq 是独立
   PRD，STOP/静音明确不做。
