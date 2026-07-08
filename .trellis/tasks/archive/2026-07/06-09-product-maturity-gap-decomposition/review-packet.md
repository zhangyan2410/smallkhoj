# Review Packet：SmallKhoj 产品成熟度拆解

这份文档是给你看的“审批前速读包”。它不要求你一次吃下所有细节，只帮你快速判断：这 25 个 Trellis 子任务是不是方向对、顺序对、每个任务到底要做什么。

## 你现在要做的决定

请你确认或调整这次拆解：

* Slock 作为“产品能力参考”，但 SmallKhoj 不照搬 Slock 的视觉风格。
* SmallKhoj 的 UI 方向是更冷静、更密集、更像产品工作台的青蓝色体系。
* 后续实现按 Trellis 子任务一个一个推进，每个浏览器/运行时相关任务都必须留下真实证据。
* 建议第一个实现任务是 `06-09-trellis-real-test-quality-gate`，先把“真实测试证据”这件事立成规矩。

## 已经产出的东西

父级规划任务里已经有这些材料：

* `prd.md`：总需求和拆解依据。
* `research/slock-product-surface.md`：Slock 产品表面的观察。
* `research/smallkhoj-current-gap.md`：SmallKhoj 当前差距。
* `real-test-sop-integration.md`：真实测试 SOP 怎么接入 Trellis。
* `execution-roadmap.md`：执行路线图。
* `agent-handoff-sop.md`：交给 agent 做事时怎么交接。
* `completion-audit.md`：完成度审计。
* `review-packet.md`：你正在看的这份速读包。
* `assets/`：Slock 和 SmallKhoj 的截图证据。

子任务也都已经建好：

* 一共 25 个子任务目录。
* 每个子任务都有 `prd.md`、`info.md`、`implement.jsonl`、`check.jsonl`、`task.json`。
* 每个子任务的 `info.md` 都包含实现计划、规格约束、真实测试 SOP、证据清单、顺序说明。

Trellis 流程/规范也已经更新过：

* `.trellis/workflow.md`：把真实测试证据纳入浏览器、运行时、控制面工作的质量门禁。
* `.trellis/spec/frontend/quality-guidelines.md`：要求仓库内 UI/浏览器验证使用项目 WebDriver：`twd.py`。
* `.trellis/spec/backend/runtime-slock-integration.md`：要求产品可见的运行时/控制面改动必须用 WebDriver 加 API/DB/trace 交叉验证。

## 25 个任务分别要做什么

下面这 25 个不是让你一口气全做。你只需要知道每个任务的意义，然后决定先后顺序。我的建议是：先做 Foundation，再做 Chat/Tasks 这些高频表面。

### Foundation：先把地基打稳

1. `06-09-trellis-real-test-quality-gate`
   你要做的是：把“真实浏览器/真实运行时证据”变成 Trellis 的质量门禁。以后 UI 或 daemon/runtime 相关任务不能只靠单元测试说完成，必须用 `twd.py`、API、DB、trace、marker 证明真实路径走通。

2. `06-09-frontend-design-system-cyan-blue`
   你要做的是：建立 SmallKhoj 自己的青蓝色产品视觉系统。重点不是好看截图，而是统一 shell、列表行、状态 badge、runtime chip、消息行、任务卡、成员行、电脑行、空状态、错误状态，让后面页面不各写各的。

3. `06-09-frontend-product-shell-and-navigation`
   你要做的是：把 `/` 从“链接入口页”升级成真正的产品工作台。主导航要能到 Chat、Tasks、Members、Computers、Notifications/Activity、Settings，并支持每个模块自己的二级侧栏。

### Core Product Surfaces：先把最常用的产品表面做厚

4. `06-09-chat-product-surface`
   你要做的是：把 Chat 做成 SmallKhoj 的核心协作表面。侧栏要有 Activity、Saved、Channels、Direct Messages；会话头部要有 Chat/Tasks/Files；消息要能回复线程、反应、保存、转任务、复制或打开菜单。

5. `06-09-tasks-board-list-filters`
   你要做的是：把 Tasks 从简单表单升级成真正的工作管理页。需要 board/list 两种视图、状态分组、筛选、任务详情、来源消息/线程链接、证据区，并保留创建和更新任务能力。

6. `06-09-members-agent-profile-tabs`
   你要做的是：把 Members 做成“人类成员 + agent 成员”的详情工作台。选中成员后能看 Profile、Permissions、Agent DMs、Reminders、Workspace、Apps、Activity，并保留创建 agent 和绑定电脑/runtime 的流程。

7. `06-09-computers-product-detail`
   你要做的是：把 Computers 做成 daemon 和 runtime 的运维表面。选中电脑后要能看到系统信息、daemon 版本、machine ID、lease、heartbeat、runtime 检测、agent workspace、重连命令、workspace scan、生命周期控制状态。

### Collaboration Depth：把协作动作补完整

8. `06-09-message-actions-thread-reactions-saved`
   你要做的是：补齐消息级动作。每条消息要有稳定的回复线程、reaction、保存/书签、转任务、复制链接/菜单等入口，动作不能造成布局跳动，也要能键盘访问。

9. `06-09-thread-panel-and-summary`
   你要做的是：把线程做成一等功能。线程面板要显示 root message、回复列表、发送回复、回复数、摘要/状态，并确保 DM 和 channel 的 `parent_id`、`threadId` 合同都不破。

10. `06-09-task-from-message-and-thread`
    你要做的是：让“从消息/线程转任务”可靠可追溯。任务创建时要预填标题、描述、来源 channel/message/thread；创建后消息或线程里要能跳到任务，任务里也能跳回原始上下文。

11. `06-09-files-surface-and-attachments`
    你要做的是：做出会话里的 Files 表面和附件流程。能上传/关联文件时就接后端；后端不完整时，要明确写出缺口。文件列表要显示 owner、时间、来源消息、大小、类型，并能从文件跳回消息。

12. `06-09-task-review-evidence`
    你要做的是：让任务能承载“完成证据”。任务详情里要有 evidence 区，能记录截图路径、trace 片段、API/DB 证明、review note、reopen reason、agent 输出链接。

13. `06-09-notifications-inbox-saved-search`
    你要做的是：做 supervisor 的注意力中心。包括通知中心、Activity inbox、Saved items、全局搜索。搜索结果和 saved items 必须能打开源上下文，不只是展示一行文本。

### Agent / Runtime Operations：让 agent 和 runtime 可观察、可控制

14. `06-09-agent-permissions-ui-and-sync`
    你要做的是：把 agent 权限产品化。人能在成员详情里看和改权限；权限要保存到后端，并尽量同步到 daemon/runtime 启动或 heartbeat 配置里。如果后端还没真正 enforce，要在 UI 里诚实说明。

15. `06-09-agent-activity-diagnostics`
    你要做的是：给 agent 做人能看懂的活动诊断面板。不要把原始日志全倒出来，而是总结 runtime 生命周期、最近收到的消息/任务、工具调用、错误、trace 链接。

16. `06-09-runtime-lifecycle-controls`
    你要做的是：补 runtime stop/restart/kill/reconcile 的产品控制和后端路径。按钮什么时候可用、daemon 离线时怎么解释、执行后 workspace 状态怎么更新，都要清楚。

17. `06-09-runtime-provider-expansion`
    你要做的是：扩展 runtime provider 选择。除了 Claude Code，要梳理 Codex CLI、Kimi CLI、OpenCode、Antigravity、Pi、自定义 runtime 等可用性；创建/编辑 agent 时能选择，不能用的要给安装或禁用原因。

18. `06-09-daemon-packaged-onboarding`
    你要做的是：把 daemon 连接从“跑仓库内部命令”升级成产品级 onboarding。macOS 优先，要有安装/启动/重连命令、复制按钮、过期提示、故障排查、版本信息，并继续保证浏览器只展示一次性 connect ticket，不暴露 machine token。

### Supervisor / Platform Maturity：让平台能被长期使用和调试

19. `06-09-human-debug-workbench`
    你要做的是：做一个给人类 supervisor 用的 debug workbench。输入一个 marker，就能串起浏览器 DOM、API、DB、trace、daemon session、runtime message、task evidence，并告诉下一步该查什么。

20. `06-09-trace-to-task-evidence`
    你要做的是：让 `smallkhoj-trace` 可以变成任务证据。它需要按 marker 提取精简 trace summary，挂到 task evidence，而不是把大量 raw log 塞进 UI。

21. `06-09-database-observation-sop`
    你要做的是：写一个低密度、可跟着做的 DB 观察 SOP。用唯一 marker 从浏览器消息一路追到 PostgreSQL/DBX 里的 messages、tasks、events 等表，并解释每个结果代表什么。

22. `06-09-auth-multi-server-account`
    你要做的是：把认证、账号身份、server 选择产品化。要有登录/登出或清晰限定 dev-auth，app shell 里能看到当前账号/server，API header 一致，多 server 行为至少要被定义清楚。

23. `06-09-api-key-management-ui`
    你要做的是：做 API key 管理 UI。人能看 token prefix、类型、owner、创建/撤销状态；创建的新 secret 只显示一次；支持 rotate/revoke；并保证浏览器 URL 不泄露 machine token。

24. `06-09-settings-and-admin`
    你要做的是：做 Settings/Admin 表面。包括账号/server 基本信息、runtime 默认值、provider 默认值、feature flags、安全控制、API keys、daemon onboarding、debug/SOP 入口。不支持的设置要明确 disabled 原因。

25. `06-09-production-readiness-broadcast-cache`
    你要做的是：补生产可用性里的多进程/多实例问题。要审计 EventRecord、DaemonControlHub、内存状态假设，明确哪些地方需要 Redis 或类似 broadcast/cache 层，并保证本地开发仍然简单。

## 建议第一轮先做什么

我建议第一轮先做这 5 个：

1. `06-09-trellis-real-test-quality-gate`
2. `06-09-frontend-design-system-cyan-blue`
3. `06-09-frontend-product-shell-and-navigation`
4. `06-09-chat-product-surface`
5. `06-09-tasks-board-list-filters`

原因很朴素：

* 先立真实测试门禁，后面的“完成”才不会虚。
* 先做 design system 和 product shell，后面页面不会越写越散。
* Chat 和 Tasks 是 SmallKhoj 最核心的日常工作流，最值得先变厚。

## 你可以怎么审批

如果你觉得方向对，可以直接说：

* `确认，可以从 06-09-trellis-real-test-quality-gate 开始`

如果你想调整，也很正常，可以说：

* `方向对，但先调整 first sprint`
* `先补更多 Slock 观察`
* `我要改任务范围`
* `把某个任务拆小一点`
* `某个任务先别做`

## 我对你的建议

这 25 个任务看起来多，但它们不是“今天都要做”。它们更像一张产品成熟度地图：先把质量门禁和产品骨架立住，再一块一块把 Chat、Tasks、Members、Computers、Runtime、Debug 能力补厚。

如果你现在只想推进，不想再陷入规划，我建议直接批准第一轮 5 个任务。第一步从 `06-09-trellis-real-test-quality-gate` 开始，是最稳的。
