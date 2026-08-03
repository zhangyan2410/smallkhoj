# First-use Agent Creation Guide — Technical Design

## 1. 边界

纯前端任务。不改 backend / daemon / relay / lease（07-28 已完成）。复用现有 `CreateAgentForm` + `CreateAgentDialog` + `runtimeOptionsFromDetected` + DM 创建逻辑。

## 2. 现有结构（复用基础）

- `frontend/components/create-agent-form.tsx`：共享创建表单，已有 `onSuccess` 回调、动态 runtime 下拉、bundled Pi 标识（07-28 加的）。
- `frontend/app/(app)/chat/[channel]/create-agent-dialog.tsx`：chat 页的创建弹窗，已接 `CreateAgentForm`，创建后建 DM。
- `frontend/app/(app)/members/page.tsx`：members 页，用 `CreateAgentDialog`。
- `frontend/app/(app)/chat/page.tsx`：chat 首页（dm-starter 等）。
- `frontend/lib/runtime-options.ts`：`runtimeOptionsFromDetected` 已就绪。

## 3. 改动点

### 3.1 空 Server 首屏引导（`chat/page.tsx` 或新组件）
- 当 Server 无任何 agent member 时，chat 首页渲染一个「欢迎 / 创建第一个 Agent」引导卡片，而不是空 dm-starter。
- 卡片：一句话说明 + 一个「创建 Agent」按钮（打开 `CreateAgentDialog`）。
- 引导卡片用 ProductShell 原语（Panel/Card/Button），不手撸视觉。

### 3.2 创建表单产品化（`create-agent-form.tsx`）
- 字段标签去技术化：
  - 「Runtime」→「选择 AI 助手类型」
  - 「Computer」→ 仍需选，但放次要位置 / 折叠进「高级」
  - 「Provider」→ 折叠进「高级」（bundled Pi 不需要）
- bundled Pi 项强化标识：badge「官方 · 无需配置」+ 默认选中（本机无其它 runtime 时）。
- 表单顶部引导文案：「选一个 AI 助手就能开始。推荐自带的 Pi，使用官方模型，无需任何配置。」
- 选 Pi 时：隐藏 key/provider 区（Pi 走 relay 不需要）。
- 选非 Pi（claude_code 等）时：显示「需要本机已安装并配置」提示。

### 3.3 创建成功自动进 DM（`CreateAgentDialog` / `onSuccess`）
- 创建 agent 成功后，调 `/api/v1/dm` 建 DM（peer=新 agent）→ `router.push` 到 DM 页。
- 当前 `CreateAgentDialog` 的 onSuccess 已有建 DM 逻辑（chat 页弹窗），members 页的入口要补同样的「建 DM + 跳转」。

### 3.4 文案（`messages/zh-CN.json` + `en.json`）
- 新增 `firstUse.*` 命名空间：
  - `welcome.title` / `welcome.description`
  - `createAgent.runtimeLabel`（"选择 AI 助手类型"）
  - `createAgent.bundledBadge`（"官方 · 无需配置"）
  - `createAgent.bundledHint`（"使用官方模型，无需任何 API key"）
  - `createAgent.advancedToggle`（"高级选项"）
  - `createAgent.localRuntimeHint`（"需要本机已安装并配置"）

## 4. 数据流（不变）

```
空 Server → chat 首页检测无 agent → 渲染引导卡片
  → 点创建 → CreateAgentDialog → CreateAgentForm
    → runtimeOptionsFromDetected(computers) → 动态 runtime 选项 (Pi 默认推荐)
    → 用户填 name + 选 Pi (无需 key) → POST /api/v1/members/agents
    → onSuccess → POST /api/v1/dm (peer=新agent) → router.push 到 DM
```

computer 选择：bundled Pi 仍要绑一个 computer（Pi 跑在 daemon 上）。如果用户已有 computer（连过 daemon），默认选第一个 online 的；如果没 computer，引导卡片要先引导连 computer（复用 07-28 的 connect 流程）。

## 5. 状态判断
- 「无 agent」：members 列表 filter kind=agent 为空。
- 「无 computer」：computers 列表为空或全 offline。
- 「有 computer 无 agent」：本任务主路径（引导创建 agent）。
- 「无 computer」：引导卡片改为「先连接你的电脑」+ connect 流程（复用现有 computers 页）。

## 6. 兼容性
- 进阶用户：表单「高级」展开后仍能手选 runtime/provider/computer，不破坏现有流程。
- 现有 CreateAgentDialog（chat 页）行为不变，只是 onSuccess 统一为「建 DM + 跳转」。

## 7. 验证
- frontend lint/tsc/build/test。
- `./twd` 真测：空 Server → 引导 → 创建 Pi → 自动进 DM（marker + DOM 断言 + 截图）。
