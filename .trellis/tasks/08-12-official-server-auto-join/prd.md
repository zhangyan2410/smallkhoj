# 官方 Server 与自动加入

## Goal

产品有一个「官方 Server」：由团队手动注册的官方账号（示例 `SQTeam@shengqu.com`）持有，其 home server 即官方 server。新用户注册时自动以 `member` 身份加入该官方 server，无需任何额外操作。

## Background（代码现状，已确认事实）

- **Server 只能在注册时创建**：`POST /api/v1/servers` 恒返回 410（`backend/routers/public_api.py:1181-1183`）。唯一建 server 路径是 `bootstrap_account()`（`backend/services/account_bootstrap.py:77-167`）：一次事务创建 home Server + Account + 唯一人类 Member + owner 活跃 membership。
- **membership 写入入口**：`ensure_account_membership()`（`backend/services/server_membership.py:25-63`）幂等（已有活跃行则复用），并内置规则：home server 必须是 owner，非 home server 只能拿 `admin|member`（:35-38）。
- **公开频道对 server 内所有活跃成员开放读写**（`backend/services/server_membership.py:148-150` 只拦 private/dm）——官方 server 的 member 天然可以进频道聊天。
- **不存在任何 system/official/默认 server 概念**：`Server` 无类型列（`backend/models/slock.py:32-56`），`Member.kind` 只允许 `human|agent`（`slock.py:163`）。本任务不引入此类新概念。
- **配置机制**：pydantic-settings + `.env`（`backend/config.py:62-197`），新增配置项即加一个字段。
- **任何 server 都没有退出功能**（无 server-membership 删除端点），官方 server 天然不可退出，无需处理。
- 前端切换器完全由 `auth/me.memberships` 驱动（`frontend/components/server-switcher.tsx`），membership 建好即自然出现，**本任务零前端改动**。
- 相关契约：`.trellis/spec/backend/member-identity-channel-contracts.md`（一人一 home server 一 Member；`POST /servers` 410）。

## Requirements

- R1: 自动加入的用户在官方 server 中是普通 `member` 角色，可在公开频道自由聊天；**不做只读公告/新权限模型**。官方账号为官方 server 的 `owner`。
- R2: 官方账号**手动正常注册**，其 home server 即官方 server；后端新增配置项 `OFFICIAL_SERVER_HANDLE` 指向官方 server 的 `server_handle`（不可变、全局唯一、人类可读）；未配置则不启用自动加入，各环境互不影响。
  - 配置键修订（2026-08-12，实现前代码核实）：初议按账号邮箱配置（如 `SQTeam@shengqu.com`），但应用库 `Account` 无邮箱列（邮箱存于 Better Auth 独立库），`auth_subject` 是不透明的 `better-auth:<userId>`（`public_api.py:717-722`），故改用 `server_handle` 作为配置键。
- R3: 触发点**仅注册时**：`bootstrap_account()` 建完 home server 后，幂等 `ensure_account_membership()` 加入官方 server。**不做存量账号回填**（当前无存量用户）。
- R4: 官方账号自己注册时不重复加入（其 home server 就是官方 server，已是 owner）。
- R5: 配置了官方账号但该账号尚未注册（解析不到官方 server）时，注册照常完成，跳过自动加入，不报错。

## Acceptance Criteria

- [x] AC1（R2+R3）：配置 `OFFICIAL_SERVER_HANDLE` 且官方账号已注册时，新用户注册后其活跃 memberships 包含官方 server，`role=member`、`status=active`（即 `GET /auth/me` 可见）。✅ `test_new_account_auto_joins_configured_official_server`（含 `list_account_memberships` 断言）
- [x] AC2（R4）：官方账号本人注册时，仅拥有其 home server 的 owner membership，不产生额外 member 行。✅ 同测试断言官方账号 membership 数恒为 1；`test_resume_does_not_duplicate_official_membership` 覆盖重复登录
- [x] AC3（R2）：未配置 `OFFICIAL_SERVER_HANDLE` 时，注册行为与现状完全一致（只有自己的 home server）。✅ `test_unset_or_unknown_official_handle_skips_auto_join` + 既有 7 条 bootstrap 基线全绿
- [x] AC4（R5）：配置了但官方 server 句柄不存在（官方账号未注册）时，注册正常完成且不含官方 server membership。✅ 同测试未知句柄分支
- [x] AC5（R1）：新用户加入官方 server 后，可在官方 server 的公开频道读消息、发消息（复用现有 `ensure_channel_access` 行为，无需新代码，验证即可）。✅ 自动加入与邀请接受共用 `ensure_account_membership()`，membership 形态一致；`test_invite_reuses_one_human_identity_across_servers` 等既有测试绿，证明该形态可正常通过 `resolve_active_server_context`

## Out of Scope

- 官方 bot/agent 跨 server 进驻用户 server（`channel_membership.py:51-53` 约束下不可行）
- 频道只读/公告权限模型
- 存量账号回填
- 退出官方 server（所有 server 均无退出功能）
- 前端任何特殊处理（徽章/置顶）
