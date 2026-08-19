# Outcome

`.trellis/spec/` 规格库修复为与代码现实一致：审计发现的全部失效、与事实不符、自相矛盾的章节修好；被认领的空模板按分工填实或标注归属；近期重大改动的新增约定核实补齐；中文镜像（`.trellis/spec-zh/`）同步刷新；最后交付一份 plain-Chinese 的"修好清单"（文件 → 修了什么 → 验证方式），并通过 `spec-audit.json` 在 Trellis Dashboard 可见。

# Scope

- 修复审计（`.trellis/spec/spec-audit.json`，2026-08-19 复核版）中 12 节 partial 的原文：frontend/product-ui-style.md（purple rule 色板事实、Object Language 虚构组件）、frontend/state-management.md（Unread §5/§6 rail 下线现状）、frontend/directory-structure.md（globals.css 契约自相矛盾）、backend/database-guidelines.md（3 处 startup DDL 残留）。
- backend/runtime-slock-integration.md 的 1 节 unverifiable：保留前瞻方法论内容，加"方法论章节、无逐码断言"标注。
- 填实 backend/directory-structure.md 与 backend/logging-guidelines.md 两份空模板（按当前代码现实），同步 backend/index.md 索引。
- backend/error-handling.md 与 backend/quality-guidelines.md 文件头加醒目标注（空模板勿据此开发，填实归属 08-19-agent-platform-quality-gates R5/R2/R6）。
- 在 `.trellis/tasks/08-19-agent-platform-quality-gates/prd.md` 增加显式需求条目，认领上述两份模板的填实。
- 改写 guides/cross-layer-thinking-guide.md 中 4 节上游 Trellis 产品内容，映射到本仓库真实代码路径，保留跨层思考方法论。
- 新增核实：08-16 单活跃租约强制语义与 DM 未读抑制（current-chat-view registry）在 spec 中的记载与代码一致，缺则补。
- 刷新 `.trellis/spec-zh/` 中本次改动文件的中文镜像及 manifest hash。
- 更新 `.trellis/spec/spec-audit.json`：本次修复各节的 verdict/evidence 记录修复事实。

# Non-goals

- 不修改任何产品代码（spec 向代码对齐，方向唯一）。
- 不填实 error-handling.md / quality-guidelines.md 的正文（留给 08-19 任务 R5/R2/R6 落地后一起填）。
- 不重开 capture-ledger.json 中已判定 skipped 的 47 项历史裁决。
- 不重建 spec 目录结构、不新增 spec 分区。
- 不处理 08-19 任务本身的 R1–R6 工程实现。

# Acceptance examples

- A1: frontend/product-ui-style.md 的 purple rule 与 `frontend/app/globals.css` 实际色板一致（如实记载 `--agent-color-5` 为 hue 75 的暖沙铜色例外）；Object Language 改为记载真实组件 `member-avatar.tsx` / `smallkhoj-agent-avatar.ts`，spec 全文不再出现 `AvatarObject`、`identity-thin`。
- A2: frontend/state-management.md Unread §5/§6 与现状一致：rail ActivityIndicator 当前下线并保留恢复待办说明；测试要求只引用真实存在的消费者。
- A3: frontend/directory-structure.md 的 globals.css 契约段落消除"water-material rail vs 纸脊"自相矛盾，与 globals.css 现行注释一致（rail-water-texture.png 0 引用的事实如实记载）。
- A4: backend/database-guidelines.md 三处 startup DDL 残留语言（§6 Gateway、§7 Bootstrap CLI、§3 Computer Binding）清除，统一为"Alembic 是唯一 schema writer"。
- A5: backend/directory-structure.md 与 backend/logging-guidelines.md 填实：两文件无 "(To be filled by the team)" 占位；directory-structure 与 `backend/` 真实目录树一致（services/routers/alembic 等逐一可对照）；logging-guidelines 记录现行结构化日志实践（引用真实代码位置）；backend/index.md 索引同步。
- A6: backend/error-handling.md 与 backend/quality-guidelines.md 文件头有醒目标注（空模板、勿据此开发、填实归属 08-19-agent-platform-quality-gates）；该任务 prd.md 出现认领这两份模板填实的显式需求条目。
- A7: guides/cross-layer-thinking-guide.md 的 4 节（Cross-Platform Template Consistency / Generated Runtime Template Upgrade Consistency / Mode-Detection Probe Checklist / When to Create Flow Documentation）改写后引用的代码路径在本仓库真实存在，跨层思考方法论保留。
- A8: 08-16 单活跃租约（add_exclusive、lease.revoked/4001、被撤销后不重连直接退出）与 DM 未读抑制（current-chat-view registry 按 scope.id 抑制当前窗口未读）在 spec 中的记载与代码实现一致；核对不一致或缺失处修正补齐。
- A9: `.trellis/spec-zh/` 中本次改动文件的中文镜像刷新，manifest 记录的原文 hash 与改后英文文件一致；dashboard spec 文件 tab 对这些文件不显示中文过期标记。
- A10: `.trellis/spec/spec-audit.json` 对本次全部触碰章节更新 verdict/evidence（含 runtime-slock 方法论标注节）；最终报告以 plain Chinese 给出"文件 → 修了什么 → 验证方式"清单。

# Constraints and invariants

- spec 修复以代码为唯一事实来源；每处修复必须先在代码中核实证据（文件+行号）再落笔。
- 中文镜像由英文原文翻译而来，英文术语在中文里首次出现时用括号加注（plain-Chinese 约定）。
- 不自动 git commit；Build 完成后报告改动清单等用户审。
- 不碰 `.trellis/tasks/08-19-agent-platform-quality-gates/` 中除 prd.md 需求条目以外的内容。
- dashboard 只读原则不变：本 change 不改 dashboard 代码，只通过数据文件（spec-audit.json / spec-zh）反映状态。

# Decisions

- D1: 隔离方式 = 当前目录（current）。工作树中未跟踪的 08-19 任务目录与本需求零重叠；Comet 归档只提交本 change 所属文件。（用户选定）
- D2: 修复方向 = spec 向代码现实对齐，不改产品代码。（由需求"修好的 spec"确定）
- D3: 空模板分工 = 本次填实 directory-structure + logging-guidelines；error-handling + quality-guidelines 留给 08-19 任务，本次加归属标注并把认领需求写入该任务 PRD。（用户选定）
- D4: cross-layer-thinking-guide.md 的 4 节上游内容改写映射到本仓库真实路径，不删除。（用户选定）
- D5: 中文镜像随本次修复同步刷新；修好清单落盘 spec-audit.json，dashboard Spec 文件 tab 直接可见。（由"给我一列修好的 spec"+ 用户中文阅读偏好确定）

# Open questions

（无——最终共享理解已于 2026-08-19 由用户确认，进入 Build。）

# Verification expectations

- 文本级检查（Verifier 可运行）：spec 全文 `AvatarObject`/`identity-thin` 0 命中；database-guidelines 无 startup DDL 断言残留；两份填实模板无占位符；guide 改写节引用路径逐一存在；spec-zh manifest hash 与原文一致。
- 一致性抽查：A1–A8 每项修复点对照代码证据（文件:行号）核验。
- 回归：`make trellis-dashboard-test`（collector 读 spec/spec-zh 的逻辑不受破坏）。
