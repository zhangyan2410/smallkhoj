# 验证结果（真实链路，2026-08-13）

按 `verify-handoff.md` 四项实测。后端已 `./dev.sh restart`（新 403 代码无热重载）。
浏览器走 kimi-webbridge（session `smallkhoj-dev`），账号：owner=AuarServer（s8pz9），
member=临时注册 `vuser`/`verifier`（auto-join s8pz9，测完已清理）。

## 结论：4/4 全部通过 ✅

### 1. member 建频道被拒（后端 403）✅
- member（verifier，role=member）`POST /api/v1/channels` on s8pz9 →
  **HTTP 403** `Server owner/admin role required`（修复前是 200）。
- owner（AuarServer）同接口 → **HTTP 200** created（回归正常）。

### 2. member 视角 UI 隐藏 ✅
以 vuser（member）切到 s8pz9，浏览器实测：
- 聊天侧栏「频道」区：**无「创建频道」按钮** ✅
- 聊天侧栏「私信」区：**无「创建智能体」按钮** ✅
- 电脑页（/computers）：**无「添加电脑」按钮** ✅
- 工作台首页（/）快速开始：**无「新建频道」表单** ✅
- /daemon 控制页：Channels 区只有计数（1），**无建频道表单** ✅

### 3. owner 视角回归 ✅
同一批入口对 owner（AuarServer）全部可见：
- 聊天侧栏：**「创建频道」「创建智能体」按钮在** ✅
- 电脑页：**「添加电脑」在** ✅

### 4. server 上下文标识 ✅
- rail switcher 当前 server 行：home server 显示「拥有者 · **我的**」；
  加入的 server（s8pz9）显示「成员」（无「我的」）。
- 聊天侧栏 brand 副标题：owner 在 home →「AuarServer · 拥有者 · 我的」；
  member 在 s8pz9 →「AuarServer · 成员」。

## 范围外观察（不在本 handoff 验收项内，仅记录）

- **电脑页 daemon 运行时管理按钮对 member 仍可见**：member 在 /computers 能看到
  「重连 / 扫描工作区 / 全部停止 / 全部重启 / 对齐状态 / 启动 / 停止 / 重启 / 删除」
  等按钮。本任务 handoff 只要求隐藏「添加电脑」（已达标），这些运行时控制按钮是否
  也应按角色隐藏、以及它们的后端是否已拦截，**未在本次范围内验证**，建议另案确认。

## 清理
- 测试账号 vuser、verifier（应用库 + home server + Better Auth user）全部删除。
- s8pz9 恢复为只有 AuarServer(owner) + Official agent + #general。
- `backend/.env` 仍为 `OFFICIAL_SERVER_HANDLE=s8pz9`（官方 server 配置，保留）。
