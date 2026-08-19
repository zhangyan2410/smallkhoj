# Spec Corpus（规格库）完整目标规格

归档后 `.trellis/spec/` 规格库达到的状态。核心不变量：**每一条可对码断言都与仓库代码现实一致**；读中文镜像的用户与读英文原文的 Agent 看到同一事实。

## 1. 事实一致性

- frontend/product-ui-style.md：
  - purple rule 记载真实色板：`--agent-color-1..6` 中 5 个落在 hue 155–230 + coral 区间，`--agent-color-5` 为例外（hue 75 暖沙铜色，见 `frontend/app/globals.css`）；按该规则做 agent 身份配色校验时必须放行该例外。
  - Object Language 记载真实组件契约：member identity 头像由 `member-avatar.tsx`（React 组件）+ `lib/member-avatar.ts`（身份来源解析，DiceBear croodles-neutral）实现；`smallkhoj-agent-avatar.ts` 仅为预览生成器；全文无 `AvatarObject`、无 `identity-thin`。
- frontend/state-management.md Unread 章节：
  - §5 如实记载 rail ActivityIndicator 当前下线（`app-rail.tsx` 注释保留恢复待办）。
  - §6 测试要求只引用真实存在的未读消费者。
- frontend/directory-structure.md：globals.css 契约单一口径（rail = 纸脊材质；`rail-water-texture.png` 无引用的事实如实记载），无自相矛盾。
- backend/database-guidelines.md：全文口径统一为"Alembic 是唯一 schema writer"；§6 Gateway、§7 Bootstrap CLI、§3 Computer Binding 三处不再出现 startup DDL / ADD COLUMN IF NOT EXISTS 类断言；对应"Tests Required"不再要求断言 startup DDL 发出 CREATE TABLE IF NOT EXISTS。
- backend/runtime-slock-integration.md 的"Vendor Runtime Capability Boundary and Reliable Wakeup"节：内容保留，标注为前瞻方法论章节（无逐码断言，不作为对码验收依据）。

## 2. 空模板处置

- backend/directory-structure.md：填实为 `backend/` 真实布局规范（routers/services/schemas/alembic/models 等目录职责、依赖方向），无占位符。
- backend/logging-guidelines.md：填实为现行结构化日志实践（真实代码位置、日志字段约定），无占位符。
- backend/error-handling.md、backend/quality-guidelines.md：文件头有醒目标注块——"空模板，勿据此开发；填实归属 .trellis/tasks/08-19-agent-platform-quality-gates（R5 错误分类学 / R2+R6 质量门禁）"；正文占位保留待该任务填实。
- backend/index.md 索引反映上述状态（填实文件正常索引；两份待填文件标注归属）。
- 08-19-agent-platform-quality-gates 的 prd.md 含显式需求条目：认领 error-handling.md 与 quality-guidelines.md 的填实（代码落地后一起填）。

## 3. 指南本仓库化

guides/cross-layer-thinking-guide.md 四节（Cross-Platform Template Consistency、Generated Runtime Template Upgrade Consistency、Mode-Detection Probe Checklist、When to Create Flow Documentation）：
- 改写为映射本仓库真实路径的版本（引用的每个代码路径存在）。
- 跨层思考方法论（模板一致性、升级链路、探测清单、流程文档时机）保留。

## 4. 新增约定核实

- 08-16 单活跃租约：add_exclusive 独占加入、lease.revoked/4001 撤销通知、被撤销 daemon 不重连直接退出——在 backend/daemon-release-and-lease-contracts.md 的记载与代码一致。
- DM 未读抑制：frontend 通过 current-chat-view registry（模块级当前视图注册）按 scope.id 抑制当前打开 DM 的未读累计——在 frontend/state-management.md 的记载与代码一致。

## 5. 中文镜像与审计台账

- `.trellis/spec-zh/` 中本次改动文件全部刷新；manifest hash 与改后英文原文一致（dashboard 中文视图对这些文件不显示过期标记）。中文版遵守 plain-Chinese 约定：英文术语首次出现加括号注释。
- `.trellis/spec/spec-audit.json`：本次触碰章节 verdict 更新（修复项 → current，附新证据；方法论节按标注记录）；修复记录可作为"修好清单"数据源。
- 交付的修好清单格式：文件 → 修了什么 → 验证方式（plain Chinese）。
