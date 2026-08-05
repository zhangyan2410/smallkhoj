# Stable member Names and Channel identity — Implementation Plan

## Delivery mode

- 这是显式 Trellis、高风险跨 backend/daemon/frontend/database 的 full-lane 任务。
- 用户批准本轮 `prd.md + design.md + implement.md` 后才运行 `task.py start`。
- 主代理负责所有方案取舍、代码修改和最终验证；子代理只做宽检索/独立核验。
- 先写 focused contract tests，再逐层实现；每一层独立绿后再接下一层。
- local/cloud product data按已确认决定 clean reset；实际删除和真实 runtime/browser测试前
  先通知用户。

## Execution status — 2026-08-06

- Backend/schema/daemon/frontend implementation through Phase 8 is complete.
- Final local automated gates:
  - backend Ruff PASS;
  - backend `505 passed, 58 skipped` without migration URLs;
  - isolated PostgreSQL release gate `562 passed` with zero skips;
  - daemon full `npm test` PASS (no daemon code changed after that run);
  - frontend `265 passed`, lint/typecheck/typecheck:e2e PASS, production build and
    standalone artifact PASS.
- Real evidence already covers Chinese Agent Name/Description creation, visible
  Channel removal, compact OpenCode join/leave context turns, zero tool calls,
  zero visible acknowledgement reply, and post-removal delivery cutoff. Evidence
  is under this task's `evidence/` directory.
- Supplemental real UI evidence now also covers Chinese/English Create Agent
  copy, live Unicode Name validation, the Description limit state, real `@/#`
  suggestions, the IME Enter guard, and the English remove-Agent confirmation.
  See `evidence/REAL_local_ui_supplement_20260806.md`.
- Phase 11 cloud reset/rollout remains intentionally pending. Read-only SSH
  inspection uniquely identified Tencent Lighthouse `124.222.40.40`, bundle
  `/home/ubuntu/smallkhoj-deploy/smallkhoj-deploy`, with backend/frontend/db/caddy
  running. `PUBLIC_API_KEY` and `NEXT_PUBLIC_API_KEY` are both non-development
  values and match, so the older key blocker is resolved. Destructive reset and
  deploying HEAD `a7dc867` still require the explicit final go-ahead.
- Broader manual acceptance cases still needing user/provider participation, if
  required before release, are the two-origin same-Name collision, bootstrap
  retry/invite return, a true narrow/touch run, and proof that a removed Agent
  continues working in another Channel. English locale and IME behavior are now
  covered by the supplemental real UI evidence.
- The task remains `in_progress`; do not archive until the user accepts the local
  result and decides the cloud rollout target/timing.

## Phase 0 — Start gate 与工作区保护

- [ ] 用户整体批准规划文件。
- [ ] 运行 task start，再使用 `trellis-before-dev` 收集当前 full-lane context。
- [ ] 保存并复核当前 dirty diff，尤其：
  - `frontend/app/(app)/chat/[channel]/channel-client.tsx`
  - `frontend/app/(app)/chat/[channel]/composer.tsx`
  - `frontend/app/(app)/tasks/page.tsx`
  - `frontend/hooks/use-chat-draft.ts`
  - `frontend/lib/chat-draft-state.ts`
- [ ] 明确以上聊天草稿实现为现有用户修改；后续只能增量编辑，不能还原。
- [ ] 把未提交 OpenCode Activity 修复视为独立工作，不修改、不 stage、不混入本任务：
  - `agent/daemon/aaa-daemon/src/runtime/runtime-activity.ts`
  - `agent/daemon/aaa-daemon/test/runtime-activity.test.mjs`
- [ ] 记录 baseline `git status` 和相关 focused tests；不因无关已有 dirty state清理文件。

## Phase 1 — Name domain + 0006 schema（先红）

### 1.1 Contract fixtures/tests

- [ ] 新增 backend/frontend 共用 Unicode Name fixture：valid、invalid、NFC、NFKC、
  casefold、reserved suffix、中文和边界长度。
- [ ] backend unit tests先覆盖 `normalize_handle`、Description normalization、
  serverHandle pattern/generation。
- [ ] real PostgreSQL schema tests先覆盖：
  - Human + active Agent同 origin namespace；
  - cross-origin同名允许；
  - Agent tombstone释放；Human tombstone不释放；
  - concurrent insert由 named partial unique index裁决。

### 1.2 ORM + Alembic

- [ ] `backend/models/slock.py`：
  - Server `server_handle`；
  - Account `auth_subject/home_server_id/display_name`；
  - Member `account_id/origin_server_id/handle/handle_key/deleted_at` 与 Human/Agent、
    Account/home Server复合约束、Agent-only Description
    constraints；
  - Channel `membership_revision`；
  - owner/name partial unique indexes。
- [ ] 新增 `backend/alembic/versions/0006_stable_member_identity.py`，父 revision为当前
  `0005_llm_run_lease`。
- [ ] upgrade 非空 identity data时抛 `IDENTITY_CLEAN_RESET_REQUIRED`；禁止猜测 backfill。
- [ ] 显式 drop/replace旧 `uq_members_server_display_name`，不能让 mutable
  displayName uniqueness与新 partial handle index同时残留。
- [ ] downgrade只允许空 identity tables，并完整恢复 DDL 以便 migration test。
- [ ] 更新 `backend/scripts/legacy_schema_preflight.py` post-baseline registry。
- [ ] 检查 `backend/models/seed.py` 仍是 data-only，删除 shared/demo identity bootstrap，
  不增加启动 DDL。

### 1.3 Domain module

- [ ] 新增 `backend/services/member_identity.py`，集中 Name/Description/serverHandle/
  reference token逻辑。
- [ ] 只捕获本任务 named unique index的 `IntegrityError`；有限重试 serverHandle碰撞，
  Name冲突返回 409。

Checkpoint：

```bash
cd backend
uv run pytest tests/test_member_identity.py -q
uv run pytest tests/test_member_identity_postgres.py -q
uv run pytest tests/test_alembic_migrations_postgres.py -q
uv run ruff check models/slock.py services/member_identity.py alembic/versions/0006_stable_member_identity.py
```

PostgreSQL migration URL缺失时必须记录为待真实 DB gate，不能把 skip写成通过。

## Phase 2 — Account/home Server 与 signup bootstrap

### 2.1 Backend service

- [ ] 把 Better Auth bootstrap、legacy/internal bootstrap统一到一个幂等事务服务。
- [ ] 一次创建 Account、home Server/serverHandle、Human Member/handle、owner
  ServerMembership、application session。
- [ ] retry只接受同 external subject + 同 immutable Name；已提交响应丢失时可安全重发
  session。
- [ ] `resolve_active_server_context` 默认 home Server，但授权只信 active
  ServerMembership。
- [ ] invite acceptance复用 `Member.account_id == Account.id` 的同一 Human identity；
  删除 Server-local Human copy逻辑。
- [ ] 所有 Human actor resolver通过 Account/ServerMembership找到同一 Member ID。
- [ ] Agent foreign Server/Channel membership路径 fail closed。
- [ ] 删除/禁用任意创建 additional Server 的 service、route 和测试期望。

### 2.2 Frontend auth shell（先做契约，UI在 Phase 6完成）

- [ ] 定义 `anonymous -> better-auth-created -> app-bootstrap-pending -> complete` 状态。
- [ ] 保留 safe `returnTo`；未完成 app bootstrap不能进入 `(app)`。

Focused tests：

```bash
cd backend
uv run pytest \
  tests/test_server_account_membership.py \
  tests/test_server_invites.py \
  tests/test_better_auth_bridge.py -q
```

新增并发/幂等 case必须使用 independent PostgreSQL transactions。

## Phase 3 — Agent lifecycle、immutable Name、Description

- [ ] Agent create接收 `name + description`，调用同一 identity module，最终 DB unique
  constraint兜底。
- [ ] 增加 Agent Name availability endpoint；signup endpoint只做规范化/预览，不做
  错误的 global uniqueness。
- [ ] `backend/routers/member_serialization.py`：raw `handle`、contextual `reference`、
  Human/Agent字段隔离。
- [ ] public owner/admin Agent PATCH支持 Description；Human Description明确 400。
- [ ] internal Agent `updateProfile`拒绝 handle/displayName/description。
- [ ] Agent delete改为 tombstone transaction：撤 credential/runtime/membership/config，
  保留 Member/messages/tasks/files attribution。
- [ ] active member/agent/list/auth查询统一排除 `deleted_at IS NOT NULL`；historical nested
  serialization可显示 tombstone。
- [ ] 同名重新创建断言新 Member ID、新空配置/Description/Channel membership。

Focused tests：

```bash
cd backend
uv run pytest \
  tests/test_member_serialization.py \
  tests/test_public_api_authorization.py \
  tests/test_agent_permissions.py \
  tests/test_agent_tombstone_identity_postgres.py -q
```

## Phase 4 — Channel reference、membership events、mentions

### 4.1 Projection + membership service

- [ ] 新增 `backend/services/channel_member_references.py`，实现 current roster bare/
  qualified projection与 Human/Agent serializer分层。
- [ ] 新增 `backend/services/channel_membership.py`，锁 Channel、统一 add/remove、revision、
  compact event和 post-commit publish。
- [ ] 把所有生产 `ChannelMember(...)`/delete写路径迁入 service：
  - public add/remove；
  - Agent self join/leave；
  - Agent tombstone delete 的全部 Channel memberships（稳定 lock order + 每 Channel
    compact leave event）；
  - Channel create；
  - DM create；
  - invite/private add；
  - integration bootstrap；
  - chat read cursor lazy join：public Channel首次 read通过 membership service并只发一次
    join；private/DM read cursor不得隐式创建 membership。
- [ ] `channel.member_joined/left` payload只含 changed member/referenceUpdates/revision；
  不含 Description/displayName/full roster。
- [ ] browser SSE scope/refetch语义保持 product-safe。

### 4.2 Removed Agent boundary

- [ ] event visibility只为 exact `removedAgentId` 放行该条 final left notice。
- [ ] 修改 `_event_visible_to_agent`/daemon expansion的判定顺序：channel-scoped event的
  actor/target shortcut不能绕过当前 membership；唯一例外是 exact final left notice。
- [ ] 删除 commit 后 future channel events不再扩展给 removed Agent。
- [ ] 一次成功 remove只写一个 leave EventRecord；重复 DELETE 404无新 event；daemon
  用 `agentId + eventId + rosterRevision` 在 provider delivery前去重 replay。
- [ ] Agent send/read对所有 Channel kind重查 current ChannelMember。

### 4.3 Mention parser

- [ ] 删除 public/agent 两套 ASCII parser，改成 Channel-scoped Unicode parser。
- [ ] message request接收 optional `mentionMemberIds` 并验证 canonical token/current
  membership。
- [ ] manual bare unique/qualified resolve；unknown/ambiguous普通文本成功发送。
- [ ] notification匹配只信 Message.mentions UUID，移除 displayName substring/prefix猜测。
- [ ] Markdown token highlighter使用同一 grammar fixture；它仍只负责视觉，不宣称 resolved。

Focused tests：

```bash
cd backend
uv run pytest \
  tests/test_channel_member_references.py \
  tests/test_channel_membership_events_postgres.py \
  tests/test_public_api_authorization.py \
  tests/test_daemon_control.py \
  tests/test_unicode_mentions.py -q
```

必须加 regression：加入第二个 `ean` 后两个都 qualified；离开后剩余成员恢复 bare；
旧 Message.content原样不变；删除一个属于多个 Channels 的 Agent时按稳定 lock order
为每个 Channel各发一次 leave且不死锁。

## Phase 5 — daemon snapshot-once 与轻量更新

- [ ] 在 provider drivers之上的共享 daemon delivery层新增
  `RuntimeChannelContextRegistry`。
- [ ] 第一次 Channel event到达时调用 Agent-authenticated channel members endpoint，
  把完整 snapshot与第一条 work合并；Agent Description只在这里出现。
- [ ] `channel.member_joined/left` 加入 explicit runtime-context allowlist，但保持
  non-message/non-freshness/non-task。
- [ ] 更新 daemon `ChannelEvent`/normalized runtime payload TypeScript contracts，加入
  `rosterRevision/member/referenceUpdates/removedAgentId`，不靠 `any` 或旧
  `channelName/memberId` 形状隐式兼容。
- [ ] revision去重；gap时内部 fetch + compact reconciliation，不再次注入 Description。
- [ ] Agent self-join首事件被 snapshot覆盖，避免 snapshot + duplicate join。
- [ ] removal final notice清 Channel context并 purge queued Channel messages；保留其他
  Channel/runtime。
- [ ] 更新所有 managed runtime system prompt：变化可能频繁、记最新、替换旧 reference、
  不回复确认、不形成长期职责假设、不确定运行 `aura channel members`。
- [ ] `aura channel members` CLI/API输出 revision、Member ID、kind、reference、Agent
  Description；断言无 Human displayName。
- [ ] OpenCode/Activity 未提交修复保持不变；如同文件附近必须编辑，先手工复核 diff，
  测试和提交仍分离。

Focused tests：

```bash
cd agent/daemon/aaa-daemon
npm run build
node --test \
  test/channel-member-context.test.mjs \
  test/slock-cli.test.mjs \
  test/slock-cli-golden.test.mjs \
  test/daemon-runtime.test.mjs
```

测试必须逐 runtime验证 Claude/Codex/OpenCode/Pi都经过共享 registry，不允许只在某个
driver补提示词。

## Phase 6 — Frontend Name、signup、Create Agent/Profile

### 6.1 Shared types/validation/i18n

- [ ] `frontend/lib/member-name.ts` + fixture tests。
- [ ] `frontend/lib/control-plane.ts` 更新 Account/Member/Channel member projection类型；
  `handle` raw、`reference` contextual。
- [ ] `frontend/messages/zh-CN.json` 与 `en.json` 同步全部 Name/Description/validation/
  suggestion/removal文案，zh-CN默认。

### 6.2 Signup

- [ ] Sign Up显示必填「名字 / Name」与 immutable `@name` preview；Sign In完全不显示。
- [ ] Better Auth成功、bridge失败时停在 retryable setup；retry不重复 signUp。
- [ ] `(app)` guard要求 SmallKhoj bootstrap complete；invite returnTo回归。
- [ ] Server switcher删除 Create Server affordance，只显示 home/joined切换。

### 6.3 Agent create/edit

- [ ] `CreateAgentForm` 保留现有 runtime/provider/computer语义并加入 Name live validation
  与 Description。
- [ ] desktop exact grid：Name|Computer、Description span 2、Runtime|Provider；窄屏按
  Name/Computer/Description/Runtime/Provider。
- [ ] Textarea plain text、optional label、localized `0/200`、loading/error/disabled。
- [ ] Members 和 Chat DM共享入口都验证。
- [ ] Agent profile提供 owner/admin Description edit；Human profile不显示/提交 Description。

Impeccable/UI gate：只使用现有 atoms/tokens；route代码不手写视觉 primitive；无 Model/
More/新视觉系统；contrast/focus/narrow dialog都检查。

Focused tests：

```bash
cd frontend
bun test test/member-name.test.ts test/create-agent-form.test.ts test/login-bootstrap.test.ts
bun run lint
bun run typecheck
```

## Phase 7 — Composer suggestions + discoverable removal UI

### 7.1 Preserve dirty composer work

- [ ] 编辑前逐行读当前 `composer.tsx`/`channel-client.tsx` 和 `git diff`；保留
  `useChatDraft`、`scopeKey`、channel/thread draft隔离。
- [ ] 不修改无关 `tasks/page.tsx`、不删除两个 untracked chat-draft模块。

### 7.2 Suggestion primitive/composer

- [ ] 新增 Layer-2 composer suggestion primitive；使用 Base UI portal/floating，复用
  ink/sand atoms/tokens。
- [ ] current caret trigger parser、`@` current members、`#` visible non-DM Channels。
- [ ] collision rows、Agent Description、Human decoration边界正确。
- [ ] keyboard/mouse/touch/IME/Esc/scroll/loading/empty/error/narrow viewport。
- [ ] selected Member IDs随 send作为 `mentionMemberIds`；draft clear/send后清理。

### 7.3 Remove Agent

- [ ] loader投影 `canManageChannelMembers`；unauthorized不渲染 trigger。
- [ ] 扩展 `DestructiveActionDialog` 支持 compact custom trigger，同时保持统一 action
  state machine。
- [ ] Agent row永远可见「移除 / Remove」；confirm明确 Agent + Channel。
- [ ] success更新 members/suggestions并 refetch；403/404/network错误可见。
- [ ] 不 delete Agent、不 stop runtime、不改变其他 Channels。

Focused tests：

```bash
cd frontend
bun test \
  test/composer-suggestions.test.ts \
  test/channel-member-removal.test.ts \
  test/destructive-action-dialog.test.ts
bun run lint
bun run typecheck
```

## Phase 8 — Cross-layer automated gates

Backend：

```bash
cd backend
uv run ruff check .
uv run pytest -q
```

Daemon：

```bash
cd agent/daemon/aaa-daemon
npm test
```

Frontend：

```bash
cd frontend
bun test
bun run lint
bun run typecheck
bun run typecheck:e2e
bun run build
test -f .next/standalone/server.js
```

Migration release gate必须提供隔离 PostgreSQL URLs并禁止 skip。失败时只修 owning layer；
不通过放宽测试或兼容 alias绕开产品不变量。

## Phase 9 — Local clean reset + fresh stack（先通知用户）

- [ ] 调用 `smallkhoj-real-test` skill，运行只读 context collector并保存完整输出。
- [ ] 确认实际 ports/process/container/database；测试约定允许重启 3000/8000，但不能
  猜测 38190/38191 或 PostgreSQL端口。
- [ ] 告知用户即将 clean reset local data并启动新 frontend/backend/daemon。
- [ ] 停旧 stack；drop/recreate选定 disposable local DB；`alembic upgrade head`。
- [ ] build并启动当前 checkout的新 backend/frontend/daemon，逐项 health/version确认。
- [ ] 创建全新测试 Account、Computer、Agents、Servers membership、Channels。
- [ ] 不复用旧 session/token/runtime workspace当作新 identity证据。

## Phase 10 — `./twd` + real runtime acceptance（用户参与）

使用唯一 marker `REAL_stable_member_identity_<timestamp>`，证据写 task `evidence/`：

- [ ] exact approved tab + authenticated `./twd`；zh-CN默认与 en切换。
- [ ] signup Name/preview/bootstrap retry；Sign In无 Name。
- [ ] Create Agent中文 Name + 200 字 Description UI/响应式布局。
- [ ] `@`/`#` popup：键盘、mouse/touch、Chinese IME、scroll、clipping、empty/error。
- [ ] 两个跨来源同名 Human进入 Channel：所有歧义成员显示/发送 qualified reference。
- [ ] runtime第一次进入收到一次完整名单 + Agent Description；普通消息不重复。
- [ ] join/leave收到轻量更新且 prompt无自动聊天回复；Description未重复。
- [ ] owner/admin移除 Agent：UI/`@` suggestions立即更新；removed Agent该 Channel send
  403/无后续投递；另一个 Channel仍能工作。
- [ ] 截图 + DOM + API + read-only DB + EventRecord + `smallkhoj-trace` 同 marker交叉核验。

真实 provider回复/思考是否符合提示需要用户验收；开始这一 gate前明确叫用户。

## Phase 11 — Cloud reset/rollout（local acceptance 后）

- [ ] 再次确认目标 cloud stack/database，停止 cloud frontend/backend/daemon。
- [ ] 如需回退保留一次旧 volume/snapshot；然后按已授权的 disposable-data决定 reset。
- [ ] deploy同一已验收 commit/image，fresh `alembic upgrade head`，启动新服务。
- [ ] 只创建新的验收账号/Server/daemon credential；不导入旧 displayName/mentions。
- [ ] 最小 cloud smoke：signup、home Server、Agent create、Channel message、remove Agent。
- [ ] rollback只能恢复旧 app + 旧 DB snapshot成对版本，禁止混用 schema。

## Phase 12 — Independent review 与收尾

- [ ] 独立核验 PRD acceptance逐条映射到 code/test/evidence。
- [ ] 复核 Agent-facing payload全局无 Human displayName；全文检索旧 mutable
  displayName mention/parser和任意 Create Server入口。
- [ ] 复核所有 ChannelMember production writes都经过统一 service。
- [ ] 复核所有 frontend dirty user changes仍存在且语义未倒退。
- [ ] `trellis-check` full-lane；必要时更新 identity/event/runtime/frontend specs。
- [ ] 提交时把本任务变更与独立 OpenCode Activity修复分开；不 stage用户无关文件。
- [ ] 用户最终验收后再 archive/finish task。

## Stop / rollback points

- 0006 migration无法在 empty PostgreSQL fresh-upgrade：停止，不启动新 backend。
- signup bootstrap不能保证 transaction/idempotency：停止，不接 frontend auth。
- Channel membership仍有绕过统一 service的生产写路径：停止，不接 daemon events。
- removed Agent还能在 commit 后 send/receive该 Channel：停止，不做 UI验收通过声明。
- browser行为与 unit/build不一致：以 `./twd` 为失败，继续修复。
- cloud reset前 local real acceptance未通过：不触碰 cloud data。
