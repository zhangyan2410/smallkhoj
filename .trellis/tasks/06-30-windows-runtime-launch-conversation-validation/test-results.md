# Windows Runtime Launch And Conversation Validation Results

Status: not run yet

## Test Environment

- Tester:
- Date:
- Windows version:
- Shell:
- Node version:
- Git commit tested:
- Backend target:
- Daemon package/version:
- Claude Code install path/detection:
- Codex CLI install path/detection:

## Commands Run

```powershell
# Fill in exact commands.
```

## Runtime Detection Summary

- Claude Code:
- Codex CLI:
- CC Switch provider metadata:
- Any unavailable runtime:

## Conversation Test

- Marker:
- Channel/DM:
- Agent:
- Runtime:
- Message sent:
- Reply received:
- Visible in product state:

## Log Checks

Forbidden strings should not appear in the product launch path:

- `cc-switch.ps1`
- `ccs-claude`
- `/Users/lee`
- `spawn claude ENOENT` after claimed startup
- `spawn codex ENOENT` after claimed startup
- misleading `pid=unknown` start without a clear unavailable/start failure

Relevant log excerpts:

```text
```

## Pass/Fail Matrix

- [ ] Windows machine details recorded.
- [ ] Daemon connect/register succeeded.
- [ ] Claude Code command detection is correct when installed.
- [ ] Codex command detection is correct when installed, or unavailable state is explicit.
- [ ] `claude_code` runtime starts from backend/daemon control.
- [ ] Runtime receives a message and replies successfully.
- [ ] Logs contain no forbidden implicit wrapper/script launch.
- [ ] Failures, if any, have clear errors and follow-up notes.

## Result

Outcome: pending

Remaining fixes:

- None recorded yet.
