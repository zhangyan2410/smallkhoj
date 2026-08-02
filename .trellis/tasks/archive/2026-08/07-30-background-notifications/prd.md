# 系统级后台通知：DM/任务指派/待审请求的浏览器提醒

## Goal

当用户没有盯着 SmallKhoj（其他标签页、其他窗口、最小化）时，对"需要人来响应"的实时事件给出浏览器/系统级通知（Notification API），点击通知可直达对应页面。与 app 内红点（任务 `07-30-realtime-activity-indicators`）互补：红点覆盖"app 打开时"，本任务覆盖"app 不在前台时"。

## 背景：现状证据（2026-07-30 只读调查）

- 全项目无 `Notification` / service worker 使用（grep `frontend/app components lib hooks` 零命中）。
- 后端 SSE（`/api/v1/events/stream`）已推送 `message.created`、`task.created/updated`、`memory.*` 等事件，事件带 scope/seq/epoch，前端 `lib/realtime-events.ts` 已有 high-water 去重与断线重连。
- 产品定位（`PRODUCT.md`）：本地人机协作工作台，操作者需要及时响应 agent 的 DM、任务与待审请求；当前离开页面即失去感知。
- 已知缺口（佐证必要性）：AppRail 无活动指示已由 `07-30-realtime-activity-indicators` 覆盖 app 内部分；本任务不重复其实现，只消费其状态层/订阅口。

## Requirements

### R1 通知权限与设置

- 在 settings 页提供通知开关入口：申请权限、显示当前授权状态（granted/denied/default）、被拒时的引导文案（i18n，en + zh-CN）。
- 按域提供细粒度开关（至少：DM/频道消息、任务、memory 待审），默认全开；拒绝授权后功能静默降级，不报错不骚扰。

### R2 事件 → 通知映射

- 触发事件（首期）：
  - DM 新消息（`message.created`，scope.kind=dm）—— 最高优先级；
  - 频道消息中 @提及当前用户（若事件 payload 可判定；判不定则频道消息不通知，宁缺毋滥）；
  - 任务指派给当前用户 / 任务状态变更需 review（`task.created/updated`）；
  - memory proposal 待审（`memory.*`）。
- 抑制规则：对应路由当前可见且文档聚焦时不发（Page Visibility + 路由匹配）；自己触发的事件不通知；同 epoch/seq 不重复通知（复用 high-water 语义）。
- 防骚扰：同一 scope 的连续事件做节流/折叠（如 30s 内同频道合并为一条"N 条新消息"），不逐条弹。

### R3 点击直达

- 点击通知聚焦已有窗口（`window.focus` 语义）并导航到对应路由（DM → `/dm/<member>`，频道 → `/chat/<name>`，任务 → `/tasks?task=<id>`，memory → 对应页面）。

### R4 架构约束

- **依赖关系**：通知的事件订阅必须建立在 `07-30-realtime-activity-indicators` 的 R1 状态层/订阅口之上（或与其同一实现批次交付）；禁止再开一条独立 SSE 连接。若 indicators 任务尚未开始，本任务先行时需把订阅口设计成 indicators 可直接复用的形态，并在 implement 阶段回填对齐。
- 纯前端闭环：v1 不引入 service worker / Web Push；页面存活（含后台标签页）即可，页面关闭后不要求通知。
- i18n：所有文案走 `messages/en.json` / `zh-CN.json`（当前两文件 key 完全对齐，新增 key 必须双语同步）。
- 可访问性：通知不只依赖颜色；设置页开关可键盘操作。

## Acceptance Criteria

- [ ] 后台标签页状态下收到 DM，出现系统通知，点击后聚焦窗口并落在对应 DM 页面（`./twd` 或真机可见证据）。
- [ ] 当前正停留在对应频道/DM 且窗口聚焦时，不产生系统通知（抑制生效）。
- [ ] 同一事件（同 epoch/seq）重连重放后不重复通知。
- [ ] 权限被拒绝时：设置页显示 denied 状态与引导文案，功能静默降级，控制台无未捕获错误。
- [ ] 各域开关关闭后对应事件不再通知；设置持久化（刷新后保持）。
- [ ] 高频消息场景下通知被节流/折叠（30s 同 scope 一条）。
- [ ] 未新增独立 SSE 连接（Network 面板证据：连接数不随通知功能开启而增加）。
- [ ] lint、type-check 通过；en/zh-CN 消息 key 保持对齐；e2e 不红。

## Notes

- 已识别但暂缓的相关缺口（不在本任务）：移动端主导航缺失（`components/app-rail.tsx` 在 `<sm` 断点 `hidden` 且无替代导航），建议将来与 PRODUCT.md 确认移动端定位后另立任务。
- 建议实施顺序：R4 订阅口（与 indicators 协调）→ R1 设置 → R2 映射/抑制/节流 → R3 直达。
- 用户明确要求：本任务仅完成规划文档，不进入实现（未执行 `task.py start`）。
