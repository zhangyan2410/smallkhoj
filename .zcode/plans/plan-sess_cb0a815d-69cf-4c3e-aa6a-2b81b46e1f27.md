# 全部停止 / 全部重启（带确认弹窗）

## 目标
Computers 详情页 lifecycle 区的「全部停止」「全部重启」按钮从永久 disabled 改为可用：
点击 → 二级确认弹窗（写明影响 N 个工作区）→ 确认后前端循环调用 `POST /api/v1/workspaces/:id/lifecycle` → 显示执行结果 → 完成后 `router.refresh()`。

「扫描工作区」「对齐状态」本次不做（后端无对应能力，需另起任务）。

## 实现

### 1. 新建 client 组件 `BatchLifecycleButtons`
路径：`frontend/app/(app)/computers/batch-lifecycle-buttons.tsx`

Props：
```ts
{
  workspaces: AgentWorkspace[]      // 该电脑的所有 workspace
  computerId: string
  sessionToken?: string | null
  activeServerId?: string | null
  copy: ComputersCopy               // 复用现有 i18n
}
```

内部逻辑：
- 算 `stopTargets` = workspaces 中 `status ∈ {running, active, idle, busy, pending_start}` 的（复用 WorkspaceRow 的 `canStop` 判断）
- 算 `restartTargets` = workspaces 中 `status ∈ {running, active, idle, busy}` 的（复用 `canRestart` 判断）
- 两个按钮：disabled 当 `daemonOffline || targets.length === 0`
- 点击按钮 → 打开对应确认 Dialog（用 `ui/dialog.tsx`，单一 `openDialog: "none"|"stop"|"restart"` state 机，条件渲染保证同时只有一个 dialog——和 connect-computer-form 同模式）
- Dialog 内容：标题 + 「这将停止/重启 N 个工作区：」+ workspace 名字列表 + 取消 / 确认按钮
- 确认时：`for (const w of targets) await apiPost("/api/v1/workspaces/:id/lifecycle", {action}, sessionToken, activeServerId)`，用 `Promise.allSettled` 并发；记录 rejected 项
- 执行中：确认按钮变 loading（disabled + 文案变「执行中…」）
- 完成后：`router.refresh()`；若有失败，Dialog 内显示「X 个成功，Y 个失败」+ 失败 workspace 名单；全成功则关闭 Dialog

### 2. 改 `frontend/app/(app)/computers/page.tsx`
- `ComputerDetail` 接收新 props：`sessionToken`、`activeServerId`（从 page 级传入，page 已有这两个值）
- lifecycle 区的「全部停止」「全部重启」两个硬编码 disabled Button → 替换为 `<BatchLifecycleButtons .../>`
- 「扫描工作区」「对齐状态」保持 disabled（title 不变）
- 导出 `ComputersCopy` 类型供新组件复用

### 3. i18n 新增 key（zh-CN + en）
- `batchStopTitle` / `batchRestartTitle`：「全部停止」/「全部重启」
- `batchStopConfirm` / `batchRestartConfirm`：「这将停止 {count} 个工作区，确定继续吗？」
- `batchExecuting`：「执行中…」
- `batchResultMixed`：「{success} 个成功，{failed} 个失败」
- `batchConfirm` / `batchCancel`：「确认执行」/「取消」

## 验证
- lint + tsc 干净
- `bun test test/` 不回归
- `./twd` 真实 UI：在线电脑 + 有运行中 workspace → 点全部停止 → 弹窗显示数量 → 确认 → workspace 状态变化；全部重启同理

## 不做
- 不改后端（循环调现有 lifecycle 接口）
- 不做扫描/对齐（无后端能力）
- 不复用 DestructiveActionDialog（trigger 是红色 destructive 按钮，放进 outline 按钮排视觉不一致）