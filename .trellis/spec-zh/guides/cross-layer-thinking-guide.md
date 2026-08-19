# 跨层思考指南

> **目的**：动手实现之前，先想清楚数据在各层之间的流转。

---

## 问题所在

**大多数 bug 发生在层与层的边界上**，而不是层内部。

常见的跨层 bug：
- API 返回的是格式 A，前端却期望格式 B
- 数据库存储 X，服务层转换成 Y，途中丢了数据
- 多个层用不同方式实现了同一段逻辑

---

## 实现跨层功能之前

### 第 1 步：画出数据流

把数据的移动路径画出来：

```
Source → Transform → Store → Retrieve → Transform → Display
```

对每一个箭头追问：
- 数据此刻处于什么格式？
- 哪里可能出错？
- 谁负责校验？

### 第 2 步：识别边界

| 边界 | 常见问题 |
|----------|---------------|
| API ↔ Service | 类型不匹配、字段缺失 |
| Service ↔ Database | 格式转换、null 处理 |
| 后端 ↔ 前端 | 序列化、日期格式 |
| 组件 ↔ 组件 | props 形状变化 |

### 第 3 步：定义契约（contract）

对每一个边界：
- 确切的输入格式是什么？
- 确切的输出格式是什么？
- 可能发生哪些错误？

---

## 常见跨层错误

### 错误 1：隐式的格式假设

**坏**：不检查就假定日期格式

**好**：在边界处做显式格式转换

### 错误 2：分散的校验

**坏**：在多个层重复校验同一件事

**好**：在入口处校验一次

### 错误 3：抽象泄漏

**坏**：组件知道数据库 schema

**好**：每一层只认识相邻的层

---

## 跨层功能检查清单（checklist）

实现前：
- [ ] 画出完整的数据流
- [ ] 识别所有层边界
- [ ] 定义每个边界处的格式
- [ ] 决定校验发生在哪里

实现后：
- [ ] 用边界情况测试（null、空值、非法值）
- [ ] 验证每个边界处的错误处理
- [ ] 检查数据往返后完好无损

---

## 跨平台模板一致性

同一条 Trellis 命令/skill 在本仓库存在于**多个平台面**——例如 `trellis-check` 同时以命令（`.zcode/commands/trellis/check.md`）、skill 正文（`.agents/skills/trellis-check/SKILL.md`）、Claude 副本（`.claude/skills/trellis-check/SKILL.md`）和 Codex 子代理（subagent，`.codex/agents/trellis-check.toml`）四种形态分发。共享钩子（hook）也是多副本：`inject-workflow-state.py` / `session-start.py` 被写入每个支持钩子的平台目录（`.claude/hooks/`、`.codex/hooks/`……）。改其中一份就是一个跨层边界。

### 检查清单：修改任何命令/skill/钩子模板之后

- [ ] 先找出所有平台副本：`find .zcode .agents .claude .codex -name '<name>*'`
- [ ] 更新每一份副本，并按平台形态适配（Markdown `.md` 对 Codex 的 TOML 子代理；`.codex` 版本明确记载 Codex 不会自动注入任务上下文，必须自跑 `task.py current`）
- [ ] 尊重托管块（managed block）：`<!-- TRELLIS:START/END -->`（AGENTS.md）或 `<comet-ambient-resume>` 块内的内容会被 `trellis update` / `comet init` 覆盖——要持久的改动放在块外，或改生成工具本身
- [ ] 覆盖面刻意不均——`.zcode/commands/trellis/` 有 12 个命令，`.claude/commands/trellis/` 只有 2 个（"Not every platform exposes every command"，AGENTS.md）。新增命令时要逐平台决定是否挂载。

**真实漂移样本（本仓库现存）**：共享钩子 `inject-workflow-state.py` 在 `.claude/hooks/` 与 `.codex/hooks/` 之间已经分叉——`.codex` 副本多出一段 `ZCODE_PROJECT_DIR` 映射和 `.zcode` 脚本目录分支，`.claude` 副本没有。"同步各平台钩子副本"要当作一次显式改动来做；绝不要假设副本天然一致。

---

## 生成的运行时模板升级一致性

有些生成文件既是文档，又是运行时输入。本仓库里，`.trellis/workflow.md` 会被 `.trellis/scripts/common/workflow_phase.py`（`_MARKER_RE` 平台标记）、各平台的 `session-start.py` 钩子（对 `[workflow-state:*]` 块做正则 + 生成目录）、以及 `get_context.py --mode phase --platform <p>`（经 `common/git_context.py`）解析。AGENTS.md/CLAUDE.md 里的托管块由 `trellis update` 重新生成。模板改动必须对照"每一个解析器实际读什么"来验证，而不是只看文件长什么样。

### 检查清单：修改运行时会解析的模板之后

- [ ] 找出读取该模板的每一个解析器——对 `workflow.md` 而言：`workflow_phase.py`（平台标记行）、`session-start.py` 钩子（`[workflow-state:*]` 标签 + 目录）、`get_context.py --platform` 过滤
- [ ] 检查承重语法是否落在托管区域之外——像 `[Claude Code, Cursor, OpenCode, codex-sub-agent]` / `[codex-inline, Kilo, Antigravity, Devin]`（workflow.md）这样的平台标记行会被解析，却不在任何保护块里；`trellis update` 只重写托管块，块外的失效（stale）标记会原样保留
- [ ] `[workflow-state:STATUS]` 面包屑（breadcrumb）标签是钩子的唯一事实源——自 v0.5.0-rc.0 起钩子脚本不再内置兜底字典（workflow.md 的 "WORKFLOW-STATE BREADCRUMB CONTRACT"）；改一个标签名会让所有平台钩子静默退化为通用提示行
- [ ] 对每个被触碰的平台用 `get_context.py --mode phase --step <X.Y> --platform <p>` 验证（`.agents/skills/trellis-continue` 记载的用法）
- [ ] 更新持有该运行时契约的 spec 或任务文档

**真实案例（契约注记）**：AGENTS.md 写明 `TRELLIS:START/END` 块内的编辑"可能被未来的 `trellis update` 覆盖"——放在块里的手工路由文字只能活到下一次更新；平台行为修复要放在托管块之外，或改生成工具。

---

## 模式探测检查清单

当代码靠探测（端口连接、二进制查找、CLI JSON 状态）来决定模式/端点时，探测质量直接决定正确性。本仓库里：dashboard 的 `_collect_agents` 用 0.2 秒 socket 连接探测 DSH web 端口、用 `shutil.which` 探测二进制（`tools/trellis-dashboard/collector.py`）；`agent_runner._resolve_dsh_bin` 按 环境变量覆盖 > `~/.dsh/toolchain/bin/dsh` wrapper > PATH 三级解析；Comet 恢复探针用 `comet resume-probe . --stdin --json` 路由会话入口（AGENTS.md 的 `<comet-ambient-resume>` 块）。

### 实现前：
- [ ] 探测在**所有**使用该结果的代码路径中都会执行（交互式、脚本式、委派 agent 的 prompt）
- [ ] 区分"不存在"与瞬时错误——不要把两者都当作不存在
- [ ] 瞬时错误必须**中止或带原因重试**，绝不静默切换模式
- [ ] 探测失败要产生显式、形状明确的兜底值（例如 collector 返回 `{"sdkAvailable": false, "busy": false, "messages": []}` 而不是抛异常）
- [ ] 解析阶梯（环境变量 > wrapper > PATH）写在实现处，而不是留在调用者脑子里

### 实现后：
- [ ] 追踪（trace）从探测结果到判定分支的每一条路径——不允许穿透
- [ ] 对路由型探针，只信任契约声明的字段：resume-probe 的结果只信任 `workflow`/`skill`/`entrySource`；状态无效且没有 `nextCommand` 时，停下并报告——绝不猜另一个 workflow
- [ ] 外部格式契约（CLI JSON 信封、标记格式）要做 schema 校验；非 JSON、非零退出码或 schema 不对，含义是"停下并原样报告错误"，不是"兜底回退"
- [ ] 读取结构化响应的探测消费方必须解析**完整**响应体，绝不把固定长度前缀当完整 JSON

**真实案例（本仓库）**：comet 入口 skill 解析 `comet workflow resolve . --activate --json`，把 CLI 缺失 / 非零退出 / 非 JSON / schema 无效一律当作带原始错误的硬停止——没有兜底猜测。dashboard 的 Agent 面板用同样纪律：`chat_status` 抛异常时降级为显式的 `sdkAvailable: false` 载荷，而不是假装服务在线。

---

## 何时编写流程文档

满足以下条件时，在 `docs/` 下创建专门的流程文档：
- 功能横跨 3 层以上（前端 → 后端 → daemon/runtime，或控制面状态）
- 改动了浏览器可见的产品行为、daemon/runtime 投递或控制面状态（`docs/real-test-sop-template.md` 声明的触发条件）
- 验证路径容易造假、需要"禁止使用"反例清单（见 `docs/real-runtime-dm-reply-sop.md`：禁 fake-recorder、禁直接插库、禁手动 POST agent 回复）
- 该区域反复出 bug（孤儿 daemon → `docs/orphan-daemon-cleanup.md`；P2 局域网注册 → `docs/p2-lan-daemon-registration-runbook.md`）

让流程文档真正生效的规则：
- 给文档机器可查的证据格式（SOP 模板的 `REAL_<task-slug>_<yyyyMMddHHmmss>` 标记），而不是只有文字断言。
- 把它挂进 agent 真会读的索引：AGENTS.md 的 Project Index 把 UI 验收路由到 `./twd`、真机测试环境选择路由到 `smallkhoj-real-test` skill（其只读上下文收集器的输出必须原样嵌进委派 prompt）、多 agent Git 流程路由到 `docs/multi-agent-development-workflow.md`。没被索引的流程文档对 agent 来说不存在。
- 分层叠加而不是重复：更深路径的文档（真机 runtime DM 回复）在通用模板的标记纪律之上叠加。
