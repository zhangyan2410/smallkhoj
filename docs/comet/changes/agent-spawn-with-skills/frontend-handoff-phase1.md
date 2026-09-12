# 前端交接包 · 第一期：agent 职责与技能显性化

> 面向：接手 frontend/ 实现的 agent（无前期对话上下文，本文自包含）。
> 范围：仅 `frontend/` 目录。后端/daemon 由主会话并行实现，**API 契约以下文为准（已冻结）**，后端未就绪前可按契约 mock。
> 来源：Comet Native change `agent-spawn-with-skills`，需求背景见同目录 `brief.md`。

## 任务概述

SmallKhoj 当前创建 agent 只有「名称/描述/computer/runtime/provider」，agent 是空壳。本期为 agent 增加「职责」（system prompt）与「技能装配」（skills），并在 UI 显性展示；同时扩展权限配置（三个新能力开关）。产品形态对标万有无界（work.wanuai.cn）实测：编辑表单极简（名称+职责两字段），能力全部外置为带触发描述的技能卡。

## 改动点

### 1. 创建/编辑 agent 表单（`frontend/components/create-agent-form.tsx`）

新增两个字段：

- **职责（systemPrompt）**：多行 textarea，placeholder 示例「1、负责…… 2、遇到 X 时……」（参考万有小万的职责：「1、日常事务自己接…… 2、复杂任务把对的事交给对的 Agent 或工具 3、过程中记住你的偏好和上下文」）。可留空。最长 8000 字符。
- **技能（skillIds）**：多选 chips。数据源 `GET /api/v1/skills`（见契约）。每项显示技能名；选中后 chip 高亮。空列表时显示占位文案（「服务器还没有已安装的技能」+ 禁用态），不阻塞表单提交。

编辑路径（`frontend/app/(app)/members/actions.ts` 的 PATCH）同步支持这两个字段。

### 2. 成员详情 · 职责与技能展示

成员详情页（member-tabs，参照现有 `workspace-tab.tsx` 的只读展示风格）新增：

- **职责区块**：只读文本，空则显示占位（「未设置职责」）。
- **技能区块**：卡片列表，每张卡片显示：技能名、版本号（v1.0.x 样式）、触发描述（description，通常一两句「何时使用」）。形态对照万有技能卡（名称+版本+Use-when 描述，无其他装饰）。

### 3. 权限开关扩展（`frontend/app/(app)/members/actions.ts` + 成员详情权限区）

现有 permissions/actions map 编辑 UI 增加三个布尔开关：

- `manageAgents` — 管理其他 agent（创建/编辑/启停/归档，助手 agent 的核心特权）
- `installSkills` — 装配/卸载技能
- `proposeAgents` — 提议创建新 agent（普通 agent 的低权限路径，默认开）

开关文案要写清楚含义（面向管理员的一句人话说明，不要只放键名）。

## API 契约（冻结）

### `GET /api/v1/skills`（新增，server 已安装技能列表）

```json
{ "skills": [ { "id": "uuid", "name": "web-search", "version": "1.0.2",
  "description": "Search the public web. Use when …",
  "source": "builtin|user|agent|market", "trustLevel": "trusted|reviewed|untrusted" } ] }
```

### `POST /api/v1/members/agents`（扩展）

请求体新增可选字段：`"systemPrompt": string (≤8000)`, `"skillIds": string[]`（须为已安装技能 id，未知 id 返回 400）。

### `PATCH /api/v1/members/{id}`（扩展）

新增可选字段：`"systemPrompt": string | null`（null=清除），`"skillIds": string[]`（**全量替换**装配，空数组=清空）。

### 成员读取（`GET /api/v1/members`、`GET /api/v1/members/{id}` 及现有返回 member 的响应）

member 对象新增：

```json
{ "systemPrompt": "……" | null,
  "skills": [ { "id": "uuid", "name": "web-search", "version": "1.0.2", "description": "…" } ] }
```

### 权限 map

`permissions` 对象新增键 `manageAgents` / `installSkills` / `proposeAgents`（bool）。后端在 agent 创建时持久化完整 policy map（见 `backend/services/agent_permissions.py`），前端按全键读写。

## 类型层

`frontend/lib/control-plane.ts` 的 member 类型补 `systemPrompt`、`skills` 字段；新增 Skill 类型。所有新 UI 文案进 i18n（`frontend/messages/zh-CN.json` 与 en，两份都要）。

## 验收清单

1. 创建表单能填职责、能选技能；提交后详情页正确显示两者。
2. 编辑能改职责与技能；技能为全量替换语义。
3. `GET /api/v1/skills` 空时不报错、表单可正常提交（技能为空选）。
4. 三个权限开关可配置并正确持久化/回显。
5. 新文案 zh-CN/en 完整，无硬编码中文。
6. `bun run lint` 与 typecheck 通过。
7. 不做真机浏览器验收——集成验证由主会话负责（后端就绪后统一跑）。

## 边界（不要做）

- 不改 `backend/`、`agent/daemon/`、消息流卡片（提议卡片/诞生事件是第二期）。
- 不做技能商城 UI、技能编辑器（第三期）。
- 不改 runtime/computer 选择逻辑。

## 规约入口

- 动手前读 `.trellis/spec/` 中 frontend 相关层规约。
- 组件风格对齐现有 `create-agent-form.tsx` / `workspace-tab.tsx`（shadcn/ui 惯例、现有表单校验模式）。
