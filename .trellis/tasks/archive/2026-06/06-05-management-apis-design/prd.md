# 用户产品流程：连接电脑、创建Agent、建频道、聊天协作

## 核心概念

**每个账号 = 一个隔离的 Server。** 用户在自己的 Server 里自由操作，不存在"管理员"概念。所有操作都是正常用户流程。

## 目标

设计 Slock 作为产品的正常用户操作流程，让用户能够：
- 连接自己的电脑
- 创建 Agent
- 建频道、加人
- 跟 Agent 聊天/派任务
- 完成日常协作

这不是服务器管理/权限控制，而是产品体验的核心用户流程。

## 产品流程

### 1. 连接电脑
- 用户在界面上生成一个连接命令（含 machine credential）
- 在目标机器上运行 `npx @slock-ai/daemon@latest --server-url ... --api-key sk_machine_...`
- Daemon 注册成功后，电脑出现在 Computers 页面
- 显示：名称（可编辑）、OS、daemon 版本、检测到的 runtimes、创建时间、agent workspaces

### 2. 创建 Agent
- 用户从 Computers 页面或 Members 页面创建 Agent
- 选择要绑定到哪台电脑的哪个 runtime/workspace
- Agent 创建后出现在 Members 列表中（human 和 agent 共享同一个 member 列表）
- Agent 自动开始运行，用户可以看到状态

### 3. 建频道、加人
- 用户创建 Channel（聊天空间）
- 可以把 Agent 和其他 Human 加到频道中
- 频道是协作的核心场景

### 4. 聊天与任务
- 在频道中发送消息，@mention Agent 来触发工作
- 可以把消息标记为 Task（todo → in_progress → in_review → done）
- 可以和 Agent 开 DM（私聊）
- Agent 执行任务的结果在频道/DM 中展示

## 已有的技术基础

- Backend 模型：`Member`、`Computer`、`AgentWorkspace`、`Channel`、`ChannelMember`（`backend/models/slock.py`）
- P0-backend-core-api ✓ 已完成
- P1-computer-member-model ✓ 已完成
- P1-realtime-events ✓ 已完成
- Public API `/api/v1`：GET channels/members/computers，task/message/reminder 端点
- Agent API `/internal/agent-api`：daemon register/heartbeat，channel self-service
- **缺少：** 创建/删除端点（members、computers、channels 的 POST/DELETE）

## 需要新增的 API

基于用户流程，需要以下后端接口：

### 电脑相关
- `POST /api/v1/computers/credential` — 生成机器连接凭证
- Daemon register/heartbeat 已有（`/internal/agent-api`）

### Agent 相关
- `POST /api/v1/members/agents` — 创建 Agent（绑定到 computer/runtime/workspace）
- `PATCH /api/v1/members/{id}` — 更新 Agent 配置（已有）

### 频道相关
- `POST /api/v1/channels` — 创建频道
- `POST /api/v1/channels/{id}/members` — 添加成员到频道
- `DELETE /api/v1/channels/{id}/members/{member_id}` — 移除成员

### 消息相关
- `POST /api/v1/channels/{id}/messages` — 发送消息（已有基础）
- DM 发送（已有基础）

## 前端页面影响

- **Computers 页面**：添加"连接新电脑"按钮，生成连接命令
- **Members 页面**：添加"创建 Agent"入口
- **Chat 页面**：添加"创建频道"功能，频道内添加成员
- 各页面需要对应的创建表单/弹窗

## MVP 范围

第一版实现：
1. 用户可以生成电脑连接命令并在界面看到已连接的电脑
2. 用户可以创建 Agent 并指定电脑/runtime
3. 用户可以创建频道
4. 用户可以把 Agent 加到频道
5. 用户可以在频道中给 Agent 发消息/任务
6. 用户可以和 Agent 开 DM

## 验收标准

**最终验收：E2E 自动化测试**（Agent 操作浏览器跑通完整流程）

- [ ] Agent 通过浏览器打开前端
- [ ] 在 UI 上生成 machine API Key 并拿到连接命令
- [ ] 启动 daemon 连接成功，Computers 页面显示已连接电脑
- [ ] 在 UI 上创建 Agent，绑定到电脑/runtime
- [ ] Agent 出现在 Members 列表中并开始运行
- [ ] 创建频道，将 Agent 加入频道
- [ ] 在频道中发送消息，Agent 收到并响应
- [ ] 开 DM 与 Agent 私聊，Agent 响应

## 测试便利性备忘

开发/测试期间可以预先写死/简化的东西：
- Server 创建：首次启动自动创建（seed 时创建唯一 server + owner human member），无需注册流程
- 认证：测试阶段可以用固定的 public API key（如 `sk_public_local`）跳过用户登录
- Daemon 启动：不需要 npx 打包，直接本地运行（传 server-url + api-key 参数即可）
- Agent runtime：可以先用 claude_code 或其他本地已有的 runtime，不需要所有 runtime 都支持
- 前端 URL：先用 `localhost:3000`，不需要配置域名

## 技术参考

- Backend 模型：`backend/models/slock.py`
- Public API：`backend/routers/public_api.py`
- Agent API：`backend/routers/agent_api.py`
- 产品设计：`zy-think/design/total-design.md`
- API 规范：`zy-think/design/slock-design-spec.md`
- Backend 规范：`.trellis/spec/backend/runtime-slock-integration.md`
