# Two-Account Server And Computer Validation

Date: 2026-06-29

## Scope

This drill validates real browser login plus Server-scoped resource isolation using two separate Better Auth accounts.

It does not validate runtime launch. The test agents were created with `autoStart: false`, and daemon onboarding used a one-shot `/internal/agent-api/daemon/connect` request rather than a long-running `smallkhoj-daemon` process.

## Accounts And Servers

| Account | Server | Server ID | Role |
|---|---|---|---|
| 青禾 | 青禾的服务器 | `5443f6d5-2ea9-4a83-a381-3fb8b38a0329` | owner |
| 竹影 | 竹影的服务器 | `93b0ab8c-b761-4dbc-8fb4-308ad4a0a77e` | owner |

Both accounts were created through the real `/login` page with Better Auth email/password sign-up. Re-login for `青禾` reused the existing default Server.

## Scoped Resources

| Server | Channel | Computer | Computer ID | Machine ID | Agent | Workspace Status |
|---|---|---|---|---|---|---|
| 青禾的服务器 | 青禾频道 | 共用电脑 | `f4862db1-a1ea-45e1-a734-6ecc90f23df2` | `mac-mini-local-real-0629` | 青禾助手 | stopped |
| 竹影的服务器 | 竹影频道 | 共用电脑 | `3c65b3a1-46bc-46d1-a97d-1396d5fcb076` | `mac-mini-local-real-0629` | 竹影助手 | stopped |

The same visible Computer name and the same `machineId` were intentionally used in both Servers.

## Workspace Directory Behavior

The validation agents were created with `autoStart: false`, so no runtime workspace directory was created during this drill. The current database rows have `agent_workspaces.cwd = NULL` until a real daemon starts the runtime and reports heartbeat/register state.

Daemon default workspace behavior has been tightened for this scenario:

```text
<daemon workspace root>/.slock-runtimes/<serverId>/<computerId-or-machineId>/<workspaceId>
```

For these two test rows, a real runtime launch without an explicit backend `workspacePath` would resolve to paths shaped like:

| Server | Agent | Workspace ID | Default Runtime Directory |
|---|---|---|---|
| 青禾的服务器 | 青禾助手 | `e52c4b8f-5579-49c4-b65d-7eb766f60666` | `<daemon workspace root>/.slock-runtimes/5443f6d5-2ea9-4a83-a381-3fb8b38a0329/f4862db1-a1ea-45e1-a734-6ecc90f23df2/e52c4b8f-5579-49c4-b65d-7eb766f60666` |
| 竹影的服务器 | 竹影助手 | `a8d3c4b0-900d-43ff-871b-bc81e49a7541` | `<daemon workspace root>/.slock-runtimes/93b0ab8c-b761-4dbc-8fb4-308ad4a0a77e/3c65b3a1-46bc-46d1-a97d-1396d5fcb076/a8d3c4b0-900d-43ff-871b-bc81e49a7541` |

This ensures the two Server-local Computer rows do not share runtime wrapper files, `MEMORY.md`, or provider working state when a real daemon later launches runtimes from the same machine.

## Browser Evidence

- `qinghe_chat.png`: `青禾` sees `青禾频道` and not `竹影频道`.
- `qinghe_members.png`: `青禾` sees `青禾助手` and not `竹影助手`.
- `qinghe_computers.png`: `青禾` sees the Server-local `共用电脑` bound to `青禾助手`.
- `zhuying_chat.png`: `竹影` sees `竹影频道` and not `青禾频道`.
- `zhuying_members.png`: `竹影` sees `竹影助手` and not `青禾助手`.
- `zhuying_computers.png`: `竹影` sees the Server-local `共用电脑` bound to `竹影助手`.

## Findings

- Channel, Member/Agent, and Computer views are scoped by the active Server for the tested browser surfaces.
- Current daemon onboarding treats Computer identity as Server-scoped:
  - `/api/v1/computers/connect-command` creates a `ConnectTicket` for one Server.
  - `/internal/agent-api/daemon/connect` resolves or creates `Computer` by `server_id + machine_id`.
  - The same physical `machineId` connected under two Servers creates two `computers` rows.
- This behavior is isolated and consistent with current Server boundaries, but it is not a global "one physical machine, one Computer record" model.

## Product Implication

If SmallKhoj wants one physical local machine to be globally unique across all Servers, the current model needs a follow-up architecture change, likely a global machine identity plus per-Server authorization/binding layer. The current implementation should be described as "one Computer per Server per machine".
