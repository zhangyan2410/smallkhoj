# 工程质量门禁与类型契约强化（借鉴 agent-platform 实践）

## Goal

把 agent-platform（Neutree NAP）验证有效的"约束 agent 生成代码"的四类机制移植到
smallkhoj：**API 类型单一来源**、**本地秒级门禁**、**死代码检测**、**文件头契约注释**；
同时补上盘点中发现的最大测试缺口——**daemon 测试套件未纳入 CI**。目标是让 agent
写码的错误在本地几秒内被拦下、接口形状没有自造空间、死代码不再累积。

## Background

### agent-platform 做对了什么（2026-08-19 分析结论）

- 该仓库 323 个提交中 211 个带 Claude 共同署名，约 10 周产出 ~88.5k 行 TS，
  质量靠的不是没放出来的 `.claude/` 提示词，而是放出来的机制：
  1. 类型单一来源：`internal/types/api.ts` 一份 zod schema 驱动前后端 + OpenAPI；
  2. 双保险门禁：husky pre-commit（staged 文件 biome + 全仓库 knip）+ CI 复刻；
  3. knip 治 AI 死代码（未用导出/依赖）；
  4. 文件头契约注释（"thin HTTP shell，业务在 Service"），agent 读文件即带规则。

### smallkhoj 现状差距（盘点结论）

- **API 类型双份手工维护**：backend `routers/agent_api.py` 内联 12 个 pydantic
  BaseModel；frontend `lib/control-plane.ts` 手写 `Member`/`RuntimeInfo` 等类型。
  FastAPI 免费产出 `/openapi.json` 但前端不消费；`contracts/` 只有一个 JSON。
- **无本地 pre-commit**：门禁全在远端 CI（backend 25min / frontend 25min 超时档），
  本地靠 AGENTS.md"一条聚焦验证命令"的自觉约定。
- **无死代码检测**：ruff 只查 F401（未用 import），前端 eslint 是 next 默认配置。
- **daemon 测试未纳管（本次盘点新发现，缺口最大）**：`agent/daemon/aaa-daemon`
  有 20+ 个 `.test.mjs`，但 CI 三个常规 job（source-hygiene/backend/frontend）
  与 `make ci` 都不执行它；`scripts/initial_release_foundation_gate.py` 只做
  字符串标记检查且本身也不在 CI 里跑。daemon 回归目前完全靠本地手跑。
- **错误处理无分类学**：无全局 exception_handler，router 内 inline try/except；
  `.trellis/spec/backend/error-handling.md` 与 `quality-guidelines.md` 是空模板
  （2026-08-19 spec-remediation change 已确认并在这两份文件头加了归属本任务的标注；
  directory-structure / logging-guidelines 已由该 change 按现状填实）。
- **文件头无契约声明**：如 `routers/chat.py` 只有一行描述，无层职责边界说明。

## Requirements（方向）

### R1 API 类型单一来源（结构性收益最大）

- 引入 `openapi-typescript`（或 orval），从 FastAPI `/openapi.json` 生成 TS 类型，
  产物落 `frontend/lib/api-types/`（生成文件带 header 标记，禁止手改）。
- `lib/control-plane.ts` 等手写类型逐步改为 re-export 生成类型；新代码禁止手写
  与后端 pydantic 对应的接口类型。
- CI 增加漂移检查：生成一次类型后 `git diff --exit-code`，防止 schema 与生成物脱节。
- pydantic response model 从 router 内联迁到 `schemas/`（现在 `schemas/` 只有 health）。
- daemon 侧同理评估：daemon ↔ backend 的 JSON-RPC / WS 消息契约是否也从
  openapi 或共享 JSON schema 生成（08-16 租约任务涉及的同一条 WS 通道）。

### R2 本地 pre-commit 快速门禁（成本最低、见效最快）

- 新增 pre-commit hook（bash 脚本，不引 husky 也行），只对 staged 文件跑：
  backend `ruff check --fix`、frontend/daemon `eslint --fix` + `tsc` 增量可选。
- 秒级完成；CI 保持现状作为第二道防绕过门禁（对应 agent-platform 的双保险）。
- 安装方式并入现有 `dev.sh` / `make install`。

### R3 死代码检测（knip）

- frontend 加 `knip` + `knip.json`（对 Next.js 开箱即用）。
- `agent/daemon/aaa-daemon` 是 TS，纳入同一份 knip 配置或单独一份。
- 先跑基线、把存量问题列白名单或按目录 ignore（学 agent-platform"增量管住、
  存量放过"的 diff-scoped 策略），进 `make lint` 与 CI。
- backend Python 生态无好等价物（vulture 误报高），本期不做。

### R4 daemon 测试纳入 CI（缺口最大，优先做）

- Makefile 增加 `daemon-ci`：`cd agent/daemon/aaa-daemon && npm ci && npm test`
  （其 test = build + node --test）。
- `.github/workflows/ci.yml` 增加 daemon job（或并入现有 job 矩阵），
  并把 `make ci` 聚合目标加上 `daemon-ci`。
- 评估把 `scripts/initial_release_foundation_gate.py` 也挂进 CI 的 source-hygiene
  job（它目前无人执行）。

### R5 错误分类学 + 补空 spec

- 建 `backend/services/errors.py`：typed error 基类 + 领域错误子类，
  docstring 写明各自映射的 HTTP 状态（学 skills-errors.ts 的模式）。
- FastAPI 全局 exception_handler 统一映射；router 里的 inline try/except 收拢。
- 填实 `.trellis/spec/backend/error-handling.md` 与
  `.trellis/spec/backend/quality-guidelines.md`（2026-08-19 spec-remediation
  change 显式移交：两份模板文件头已加归属标注，本任务在 R5/R2/R6 代码落地后
  把真实规范写入并移除标注；directory-structure / logging-guidelines /
  database-guidelines 无需本任务处理）。

### R6 文件头契约注释

- backend 每个 router/service 文件头补层契约 docstring：本层职责 + "什么不放
  这里"（如 router = thin HTTP shell，鉴权与业务在 service）。
- 与 `.trellis/spec/` 互补：spec 是写前必读，文件头是改文件时就近可见。

## 测试新增清单（盘点结论）

现有：backend 56 个测试文件（含 postgres http 集成）、frontend 51 个、
daemon 20+ 个（未纳管）、scripts/tests + twd-guard + trellis-dashboard。

需要新增：

1. **daemon 套件纳管**（R4）：不是新写，是把现有 20+ 测试跑进 CI——最高优先。
2. **pre-commit hook 自身测试**（R2）：仿 `scripts/tests/` 的 unittest 模式，
   测"staged 文件过滤按目录路由到正确 linter""无 staged 文件时跳过"。
3. **类型漂移检查**（R1）：CI 步骤生成 openapi 类型后 `git diff --exit-code`；
   属于门禁不是单测，但要在 Makefile 暴露为可本地跑的目标。
4. **错误映射测试**（R5）：仿 `test_cors_config.py` 的纯单测风格，测每个
   typed error → 预期 HTTP 状态 + 错误 body 形状；后续 router 收拢时防回归。
5. **knip 基线**（R3）：knip 本身即检查，不需额外测试；白名单文件加注释说明原因。

## Acceptance（验收方向）

- [ ] `make ci` 与 GitHub CI 均执行 daemon 测试套件，且在 daemon 仓库故意
      注入一个失败测试能拦住（本地验证即可）。
- [ ] frontend 存在一个从 openapi.json 生成的类型文件，`lib/control-plane.ts`
      至少一处手写类型替换为生成类型；CI 漂移检查生效（改 pydantic 不重新
      生成时 CI 红）。
- [ ] pre-commit hook 安装后，提交一个带 ruff/eslint 可修错误的 staged 文件，
      本地秒级被拦/自动修复；`--no-verify` 绕过后 CI 仍能拦。
- [ ] `knip` 在 frontend/daemon 跑通，存量白名单有注释，CI 纳入。
- [ ] `services/errors.py` + 全局 exception_handler 落地，配套错误映射单测过；
      `.trellis/spec/backend/error-handling.md` 与 `quality-guidelines.md` 填实
      （含移除文件头的空模板归属标注）。
- [ ] 抽查 3 个 router + 3 个 service 文件头有层契约 docstring。

## Notes

- **与 08-16-single-active-daemon-lease 的边界**：那个任务管运行时租约语义
  （in_progress），本任务只管工程质量门禁与契约，不碰租约逻辑；R1 的
  daemon 契约生成若与租约 WS 消息格式冲突，以 08-16 为准并推迟。
- **建议拆分**：R4（daemon CI）最小可独立交付，建议最先做；R1 工作量最大，
  可再拆"生成管线落地"与"手写类型迁移"两个子任务（`task.py add-subtask`）。
- agent-platform 参考证据：`.gitignore` 排除 `.claude/`（其 agent 提示词未开源），
  `biome.base.json` / `knip.json` / `.husky/pre-commit` / ci.yml 为可抄样本。
