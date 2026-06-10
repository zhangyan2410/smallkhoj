# Real Runtime DM Reply SOP

Use this SOP to verify the real product path for human DM -> daemon -> runtime -> Slock reply. Do not use fake recorders or the legacy worker-stack helper for this test.

For the general task-local evidence format, start from `docs/real-test-sop-template.md`, then use this document for the deeper real-runtime DM reply path.

## Purpose

Verify that a browser-authored DM from `zy-ean` reaches a real runtime and that the runtime replies through `slock message send` into the same DM.

## Do Not Use

- Do not use `start-worker-stack.sh start` as the test entrypoint.
- Do not use `fake-recorder` agents or runtime recorder scripts.
- Do not insert messages directly into the database.
- Do not POST an agent reply manually. The reply must be created by the real runtime through the Slock CLI.

## Preconditions

- Backend is running at `http://127.0.0.1:8000`.
- Frontend is running at `http://127.0.0.1:3000`.
- Test Postgres is reachable on port `55432`.
- Project WebDriver master is available:

```bash
python agent/daemon/webdriver/twd.py tabs
```

## Procedure

1. Open the product Computers page with WebDriver:

```bash
python agent/daemon/webdriver/twd.py goto --url-match 127.0.0.1:3000 http://127.0.0.1:3000/computers
```

2. Prefer reconnecting an existing disconnected computer from the UI:

   - Find the disconnected computer you want to test against.
   - Click its `Reconnect` button.
   - Read `[data-testid="reconnect-command"]`.

   If there is no suitable disconnected computer, create a new one instead:

   - Fill `#computer-name` with a unique value, for example `real-ui-<timestamp>`.
   - Click `Generate Connect Command`.
   - Read `[data-testid="connection-command"]`.

3. Run the exact command shown by the UI in a terminal. This connects the daemon through the product connect-ticket flow.

4. Open `/members` with WebDriver and create a new unique real agent:

   - Agent name: `realreply-<timestamp>`
   - Computer: the reconnected or newly connected computer from step 3
   - Runtime: `Claude Code`
   - Backend: `Claude`

5. Confirm the daemon receives `start_runtime` and starts a real runtime for the new agent. Evidence can be gathered from:

```bash
curl -sS http://127.0.0.1:<proxy-port>/internal/daemon/jsonrpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"daemon/logs","params":{}}'
```

Expected log shape:

```text
Handling control command start_runtime for agent <agent-id>
Claude runtime started for agent <agent-id>: pid=<pid>
```

When reconnecting an existing computer, the daemon may also start stale workspaces already bound to that computer. Treat this as background noise unless it blocks the daemon or confuses the target agent evidence. The test target is the new `realreply-<timestamp>` agent only.

6. From the browser home page, use `Start DM with` to create a DM with the new agent.

7. In the chat page, send a unique marker from the browser UI:

```text
REAL_UI_DM_REPLY_<timestamp> 请收到后只通过 slock 回复这一条 DM，回复内容必须包含 ACK_REAL_UI_DM_REPLY_<timestamp>。
```

8. Verify the human message:

```sql
select m.seq, s.display_name as sender, s.type as sender_type, m.content
from messages m
join members s on s.id = m.sender_id
where m.content like '%REAL_UI_DM_REPLY_<timestamp>%';
```

9. Verify runtime delivery and reply:

   - Daemon logs should include `Runtime message delivered from websocket`.
   - The browser DM page should show an agent-authored reply containing `ACK_REAL_UI_DM_REPLY_<timestamp>`.
   - The database should contain a second message in the same `channel_id` from the real agent.

10. Stop the daemon terminal with `Ctrl+C` after the test.

## Pass Criteria

- Browser shows the human marker and the real agent reply in the same DM.
- DB shows the human message and agent reply in the same `channel_id`.
- The agent reply sender is the real runtime agent, not `fake-recorder`.
- Daemon logs show runtime delivery for the marker.
- If stale workspaces were started during reconnect, the pass evidence is still valid only when the runtime delivery, `slock message send`, DB reply sender, and browser-visible ACK all belong to `realreply-<timestamp>`.

## Known Failure Signals

- Reconnect starts stale workspaces, including fake recorders. This is not an automatic failure, but it is a cleanup signal if old runtimes spam logs, consume model quota, or make it hard to identify the target agent.
- `message.created` exists in DB, but daemon logs show no `Runtime message delivered`.
- Runtime process exists, but no `slock message send` reply appears.
- Members page may show stale agent status even when the workspace row is `running`.
