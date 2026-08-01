# 当前基线：为什么“已经真实跑通”仍然不是 Workflow

## 已经完成并可以复用的能力

2026-08-01 的 TWD 修复已经完成以下底层契约：

- timeout、无 ACK、ACK 无结果、reload 都是 `ok=false` + 稳定 code + 非零退出；
- timeout 后清理执行状态，迟到 result 不污染后续命令；
- exact tab / URL 在全部 bridge 中找 owner，跨 bridge ambiguity 失败关闭；
- Guard 校验完整 URL 和每次返回的 exact `tabId`；
- `--compact`、`act cleanup`、严格 boolean 都有回归测试；
- runtime activity 先把长 `.slock/.../.slock/slock` 路径压缩为 `slock`，避免
  Integration Gate 因 200 字符截断产生 `SLOCK_SEND_MISSING` 假阴性。

真实 run 使用：

```text
marker: TWD_LOOP_20260801142749
exact tab: 1617512975
Integration Gate: chat-gate-msa0udpg, 11/11
范围: local-dev only
```

自动门禁包括：TWD 34、Guard 30、Inkframe 13、Integration Gate 39、Daemon 281、
canonical `make ci`（backend 524、frontend 222、scripts 171）。

完整原始证据当前位于 sibling worktree：

```text
/Users/code/project/smallkhoj-repair-twd-evidence-runtime-loop/
  .trellis/tasks/08-01-repair-twd-evidence-runtime-loop/evidence/
```

## 这次成功依赖了哪些临场编排

1. 人工选择 sibling worktree、branch 和任务边界。
2. 临时选择 backend/frontend/PostgreSQL/TWD/daemon proxy 端口。
3. 手工创建 disposable PostgreSQL container 和多组安全环境变量。
4. 分别启动 backend、frontend、TWD master、daemon 和 managed runtime。
5. 从浏览器 UI 创建/确认 Computer、Agent、Channel、Task，并抄取稳定 ID。
6. 选定 exact tab 后，逐条执行 TWD input/click/eval/screenshot。
7. 用 API、SQL、daemon logs、trace 和 Integration Gate 手工对账。
8. Gate 出现 10/11 时，人工发现真实回复已存在而 command preview 被截断。
9. 修复后 rebuild/restart daemon，再换 marker 重跑 Gate。
10. 最后按 PID/port/container/path 手工清理并恢复 main TWD。

这些步骤能证明一次运行是真的，但不能保证另一个 Agent 知道顺序、边界和失败后的
恢复方式。

## 当前最主要的四个 Workflow 缺口

### 1. 上下文只有索引，没有机器 checkpoint

`trellis-before-dev` 告诉 Agent 应该读什么，但没有保存“已经读到哪个 task、选择了
哪个 profile、基线是否成功”的 schema 化状态。

### 2. Integration Gate 不拥有环境与 fixture

Gate 能判断已有 Agent/Channel 是否回复，却要求调用者先提供全部身份。环境启动、
Computer connect、Agent runtime、Task 创建和 cleanup 仍在 Gate 之外。

### 3. UI、API、DB、trace 证据没有统一 report schema

当前 evidence 是可信的，但文件名和收集顺序来自执行 Agent 的判断。下一次 Agent
可能只留截图，或者忘记候选 worktree/PID cwd。

### 4. Agent 入口发生平台漂移

增强版规则只存在 `.agents/skills/trellis-before-dev/SKILL.md`；Claude 等平台副本
仍可能是 Trellis 模板旧版。即使手工同步，下一次 `trellis update` 也会触发 hash
冲突。因此跨 Agent 复现必须依赖仓库命令和 schema 测试，不能依赖长 skill 副本。

## 可以直接复用，不需要重造的组件

| 组件 | 复用方式 |
| --- | --- |
| `.trellis/scripts/get_context.py` | 生成 task/workflow/spec 基础索引 |
| CodeGraph | 生成候选代码入口，而不是 Bash 全库扫 |
| `make ci` | deterministic source/build gate |
| `tools/integration-gate/` | runtime/API Gate 与脱敏报告存储 |
| `./twd` | exact-tab browser execution |
| `tools/twd-guard/` | auth、origin 与 URL 证明 |
| `./smallkhoj-trace` | backend/frontend/daemon/runtime trace |
| `docs/real-test-sop-template.md` | evidence 语义与 marker 规则 |
| `docs/real-runtime-dm-reply-sop.md` | 真 runtime reply 禁止 mock 的边界 |

## 结论

下一步不是再写一份更长的说明，而是增加一个薄 root command 和一个带 ownership、
checkpoint、resume、deadline、report schema、cleanup 的 runner。中文文档解释入口和
结果；真正保证另一个 Agent 行为一致的是可执行状态机、测试和两次 cold run。
