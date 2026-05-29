# 补充 slock CLI 测试覆盖

## Goal

为 `slock-cli.ts` 中未覆盖的命令变体、flag 组合和错误路径补充行为级测试。

## What I already know

* `slock-cli.test.mjs` 已有 6 个 test case，覆盖了每个命令组的**主路径**（happy path）
* 主路径通过 E2E proxy 穿透测试验证（AgentProxy → upstream fake server）
* 写安全（SLOCK_ALLOW_WRITES / allowlist）已覆盖
* 测试框架：`node:test` + `node:assert/strict`，无第三方依赖

## Requirements

### 未覆盖的命令变体和 flag（20 项）

| # | 命令 | 未测行为 |
|---|------|---------|
| 1 | `message send` | inline positional 内容 |
| 2 | `message send` | `--attachment-id` 多附件 |
| 3 | `message react --remove` | DELETE 方法 |
| 4 | `message check` | 无 `--limit`（裸 check） |
| 5 | `channel join/leave --channel-id` | 显式 channelId |
| 6 | `task claim --id <taskId>` | 按 task ID claim |
| 7 | `task claim --message-id` | 按 message ID |
| 8 | `task claim --assignee` | 带 assignee |
| 9 | `task update --id --title/--assignee` | 按 task ID PATCH |
| 10 | `task update --json` | JSON data |
| 11 | `task create` positional title | 无 --title |
| 12 | `task create --assignee/--status/--message-id/--json` | 扩展字段 |
| 13 | `task create` 多个 `--title` | 批量创建 |
| 14 | `profile get` 无 `--handle` | 自身 profile |
| 15 | `profile update --display-name/--description/--avatar-url/--json` | 非 status 字段 |
| 16 | `reminder create --delay-seconds` | 延迟模式 |
| 17 | `reminder create --repeat/--msg-id/--json` | 扩展字段 |
| 18 | `reminder update --done` | 标记完成 |
| 19 | `reminder update --in/--cadence` | 别名 flag |
| 20 | `attachment download --output <file>` | rawOutputFile |

### 未覆盖的错误路径（27 项）

| # | 场景 | 预期错误码 |
|---|------|-----------|
| 21 | 缺 SLOCK_AGENT_PROXY_URL | MISSING_SLOCK_AGENT_PROXY_URL |
| 22 | 缺 SLOCK_AGENT_PROXY_TOKEN_FILE | MISSING_SLOCK_AGENT_PROXY_TOKEN_FILE |
| 23 | token 文件不存在 | TOKEN_READ_FAILED |
| 24 | 缺 SLOCK_AGENT_ID | MISSING_SLOCK_AGENT_ID |
| 25 | 未知命令 | USAGE (exit 2) |
| 26 | send 缺 --target | MISSING_TARGET |
| 27 | send 无内容 | MISSING_CONTENT |
| 28 | react 缺 --message-id | MISSING_MESSAGE_ID |
| 29 | react 缺 --reaction | MISSING_REACTION |
| 30 | search 缺 --query | MISSING_QUERY |
| 31 | channel members 缺 --channel | MISSING_CHANNEL |
| 32 | channel join/leave 缺 channel | MISSING_CHANNEL |
| 33 | task claim 参数不足 | MISSING_TASK_ID |
| 34 | task update 无字段 | MISSING_UPDATE_FIELDS |
| 35 | task create 缺 --title | MISSING_TITLE |
| 36 | task create 缺 --channel | MISSING_CHANNEL |
| 37 | profile update 无字段 | MISSING_UPDATE_FIELDS |
| 38 | integration login 缺 --service | MISSING_PROVIDER |
| 39 | reminder create 缺 title | MISSING_TEXT |
| 40 | reminder create 缺 --fire-at + --delay-seconds | MISSING_AT |
| 41 | reminder update 无字段 | MISSING_UPDATE_FIELDS |
| 42 | reminder delete 缺 --id | MISSING_REMINDER_ID |
| 43 | attachment 缺 --id | MISSING_ATTACHMENT_ID |
| 44 | upload 缺 --target | MISSING_TARGET |
| 45 | upload 缺 --file | MISSING_FILE |
| 46 | HTTP 非 200 | exit 1 + HTTP_XXX |
| 47 | --json 格式错 | INVALID_JSON |

## Acceptance Criteria

- [ ] 每个"未覆盖"项至少有一个测试 case
- [ ] 全部 `node --test test/*.test.mjs` 通过
- [ ] 无新依赖引入
- [ ] 不修改 `src/` 代码

## Definition of Done

* Tests added
* `node --test` 全绿
* 不修改源码

## Out of Scope

* 基础模块测试（jsonrpc / state / event-buffer）
* E2E 测试
* aaa-daemon CLI（status/stop/attach）
* 修改源码逻辑

## Technical Notes

* 测试模式参考 `slock-cli.test.mjs` 的 `runCli()` helper（spawn 子进程，mock HTTP server）
* 错误路径测试可复用同一 `runCli()` — 不设 env 或不传必要 flag 即触发
* 命令变体测试可用 `parseRequest` 的 E2E 模式（spawn + fake server）或直接 import `parseRequest` 做单元级断言
