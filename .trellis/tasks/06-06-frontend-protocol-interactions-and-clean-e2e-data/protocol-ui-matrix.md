# Protocol To UI Coverage Matrix

## Public Supervisor API

| Backend route | UI surface | Status |
|---|---|---|
| `GET /api/v1/channels` | Home channel list, chat sidebar, daemon dispatch selectors | Interactive |
| `POST /api/v1/channels` | Home create channel form, daemon dispatch channel form | Interactive |
| `GET /api/v1/channels/{channel_name}/messages` | Chat page, daemon recent messages | Interactive/read |
| `POST /api/v1/channels/{channel_name}/messages` | Chat composer, daemon dispatch message form | Interactive |
| `GET /api/v1/tasks` | Tasks page, daemon tasks panel | Interactive/read |
| `POST /api/v1/tasks` | Tasks create form, daemon dispatch task form | Interactive |
| `PATCH /api/v1/tasks/{task_id}` | Tasks update form, daemon review form | Interactive |
| `GET /api/v1/computers` | Computers page, daemon computers panel | Interactive/read |
| `POST /api/v1/computers/credential` | Computers credential form | Interactive |
| `GET /api/v1/activity` | Daemon activity feed | Read-only |
| `GET /api/v1/files` | Daemon files metadata panel | Read-only; public API has no download route |
| `GET /api/v1/reminders` | Daemon reminders panel | Interactive/read |
| `POST /api/v1/reminders` | Daemon schedule reminder form | Interactive |
| `PATCH /api/v1/reminders/{reminder_id}` | Daemon cancel reminder form | Interactive |
| `GET /api/v1/members` | Home, members page, chat member panel, daemon selectors | Interactive/read |
| `PATCH /api/v1/members/{member_id}` | Daemon agent control form | Interactive |
| `POST /api/v1/members/agents` | Members create-agent form | Interactive |
| `POST /api/v1/channels/{channel_id}/members` | Chat member panel add form | Interactive |
| `DELETE /api/v1/channels/{channel_id}/members/{member_id}` | Chat member panel remove action | Interactive |
| `GET /api/v1/channels/{channel_id}/members` | Chat member panel | Interactive/read |
| `POST /api/v1/dm` | Home DM form | Interactive |

## Agent/Internal API

| Backend route family | UI surface | Status |
|---|---|---|
| `GET /internal/agent-api/server` | Daemon/backend health via trace and control plane summary | Diagnostic |
| `POST /internal/agent-api/daemon/register` | Reflected in Computers and Workspaces panels | Diagnostic/read |
| `POST /internal/agent-api/daemon/heartbeat` | Reflected in Computers status and timestamps | Diagnostic/read |
| Message send/history/search/events | Chat pages and daemon recent messages cover user-facing output; raw agent polling remains CLI/daemon responsibility | Partial |
| Reactions | No dedicated public UI in this pass | Out of scope |
| Agent task claim/submit/update | Public task create/update is interactive; agent-specific lifecycle remains CLI/daemon responsibility | Partial |
| Channel join/leave/resolve | Public channel membership is interactive; agent self-join/leave remains CLI responsibility | Partial |
| Threads follow/unfollow/read | No dedicated public UI in this pass | Out of scope |
| Agent reminders | Public reminder schedule/cancel is interactive; agent-owned CLI parity remains out of scope | Partial |
| Upload/attachments | Public UI lists file metadata after uploads; direct upload/download UI is not supported by public API yet | Partial |
| Profile/avatar | Public member status/permissions/backend edits are interactive; avatar upload remains internal-only | Partial |
| Integrations login/list | No dedicated public UI in this pass | Out of scope |
| Activity create/read | Public activity feed is read-only; create remains agent/internal | Partial |
| Agent heartbeat | Reflected through member/computer status where backend serializes it | Diagnostic/read |
