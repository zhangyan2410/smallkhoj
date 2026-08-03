# First-use Agent Creation Guide — Implementation Plan

## Phase A — Baseline + 契约
1. `trellis-before-dev` 读 frontend spec（component-guidelines / quality-guidelines / reference-projects）。
2. 基线：`cd frontend && npm test && npm run lint && npx tsc --noEmit`。
3. 契约测试（先红）：
   - 空 members（无 agent）时 chat 首页渲染引导卡片（`data-testid=first-use-guide`）。
   - 创建表单 bundled Pi 有「官方·无需配置」标识 + 默认选中。
   - 创建成功后路由到 DM。

## Phase B — 空 Server 引导卡片
- `frontend/app/(app)/chat/page.tsx`（或新组件 `components/first-use-guide.tsx`）：
  - 检测 members 无 kind=agent → 渲染引导卡片。
  - 卡片：welcome 文案 + 「创建 Agent」按钮（打开 CreateAgentDialog）。
  - 无 computer 时：改为「先连接电脑」引导（复用 connect 流程链接）。
- 用 ProductShell Panel/Card/Button 原语。

## Phase C — 创建表单产品化
- `frontend/components/create-agent-form.tsx`：
  - 标签去技术化（Runtime → 选择 AI 助手类型）。
  - bundled Pi badge「官方·无需配置」+ 默认选中逻辑（已有 effectiveRuntime，强化）。
  - 选 Pi 时隐藏 Provider/key 区。
  - 非 Pi 显示「需要本机已安装并配置」。
  - 表单顶部引导文案。
  - 「高级选项」折叠（computer/provider 进阶选择）。

## Phase D — 创建成功进 DM
- `CreateAgentDialog`（chat 页 + members 页入口）onSuccess 统一：
  - `POST /api/v1/dm`（peer=新 agent）→ `router.push(/chat/<dm>)`。
  - members 页当前可能只 revalidate，改成跳转 DM。

## Phase E — 文案本地化
- `frontend/messages/zh-CN.json` + `en.json`：`firstUse.*` + `createAgent.*` 新键。

## Phase F — 测试 + 真测
- 扩展前端测试覆盖引导卡片、bundled 标识、创建后跳转。
- `./twd` 真测（marker `REAL_first_use_guide_<ts>`）：空 Server → 引导 → 创建 Pi → 自动进 DM。
- frontend lint/tsc/build/test 全绿。

## Phase G — 收尾
- `trellis-check` + spec 更新（如有新 pattern）。
- commit。

## 复用清单
- `CreateAgentForm` / `CreateAgentDialog`：已有，扩展。
- `runtimeOptionsFromDetected`：已就绪（07-28）。
- `POST /api/v1/dm` / `POST /api/v1/members/agents`：已就绪。
- ProductShell Panel/Card/Button：现有原语。

## 不做
后端、relay、lease、Pi runtime、guest、空 server 状态机、embedded Node。
