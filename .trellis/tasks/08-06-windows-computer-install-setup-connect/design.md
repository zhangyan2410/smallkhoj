# Windows Computer 三阶段安装与连接流程：技术设计

## 1. Design intent

Deliver a Windows-first standalone Aura distribution and a platform-aware Install / Setup / Connect onboarding flow while preserving the current macOS/Linux npx path. The user-facing contract is Aura; `@smallkhoj/smallkhoj-daemon` remains an internal artifact name during development.

The task deliberately separates logical phases even when a future CLI orchestrator can invoke them in one process:

```text
New computer:     Install → Setup → Connect → Online
Existing computer:                 Connect (reconnect with latest compatible Aura)
```

Install and Setup are local operations. Connect is the only phase that consumes a server-issued `sk_connect_` ticket and exchanges it for a `sk_machine_` token.

## 2. Boundaries

### 2.1 Windows standalone distribution

- User-facing executable: `aura.exe`.
- Install root: `%LOCALAPPDATA%\\Aura`.
- Private runtime: a bundled `node.exe`, compiled daemon `dist`, production dependencies, and required N-API/WASM resources. The target computer does not need Node.js, npm, or npx.
- Initial release target: Windows x64. Installer architecture detection must use native Windows signals and keep explicit x86/ARM64 branches; unsupported or mismatched artifacts fail closed.
- Versioned directories allow upgrade, rollback, and side-by-side staging without overwriting a running executable.
- Internal package/release names may remain `smallkhoj-daemon` while all user-facing paths, commands, and copy are Aura.

### 2.2 Local Setup and identity

- Setup writes user-scoped config under `%LOCALAPPDATA%\\Aura\\daemon`.
- `machine-id` is generated once on first Setup and reused across daemon version changes and reconnects.
- `credential.json` stores the resulting machine credential with user ACL protection and atomic replacement. Legacy `.slock` / `.smallkhoj` paths are read or imported only through explicit compatibility logic; Setup never silently overwrites them.
- An explicit reset/regenerate operation handles VM clones, copied user profiles, or deliberate identity replacement.

### 2.3 Connect and reconnect

- Opening the dialog, switching tabs, and entering the Connect preview do not create a ticket. The Web UI creates a `sk_connect_` ticket only when the user clicks/requests the Connect (generate command) or Reconnect action. Install/Setup guidance does not consume the five-minute ticket lifetime.
- First Connect sends machine ID, Computer name, server URL, daemon version, OS metadata, and runtime inventory; the server creates/reuses the Computer and returns a machine token.
- Reconnect skips Install/Setup, uses the server-advertised current compatible Aura release, and reuses the existing local identity/configuration. Using a newer daemon is an upgrade-on-reconnect, not a migration UX.
- If a local old daemon process exists while its server lease is expired, Aura attempts graceful stop. It never force-kills by default. If the server lease is still active, Aura refuses duplicate startup and reports a stop/wait/retry action.
- Compatibility matrix and fallback policy remain a design-stage follow-up; the existing server minimum-version check is the temporary source of truth.

## 3. Cloud and API contracts

### 3.1 Release metadata

Extend the existing daemon download contract so each release exposes immutable metadata:

```json
{
  "daemonVersion": "0.3.0",
  "platform": "win32-x64",
  "artifactUrl": ".../aura-win32-x64-v0.3.0.zip",
  "sha256": "...",
  "minimumDaemonVersion": "0.2.6"
}
```

The backend remains the source of the advertised release version. A newer local version is not downgraded unless an explicit force/rollback operation is requested.

### 3.2 Onboarding command payload

Return structured platform command metadata instead of forcing the UI to derive shell commands:

```json
{
  "platforms": {
    "windows": {
      "shell": "powershell",
      "install": { "command": "...", "label": "Install（安装）" },
      "setup": { "command": "...", "label": "Setup（初始化）" },
      "connect": { "command": null, "label": "Connect（连接）", "requiresTicket": true }
    },
    "unix": {
      "shell": "bash",
      "install": { "command": "..." },
      "setup": { "command": "..." },
      "connect": { "command": null, "label": "Connect（连接）", "requiresTicket": true }
    }
  },
  "ticket": null
}
```

The preview/setup response contains no `sk_connect_` value and no expiry countdown (`ticket: null`; the Connect command is an action placeholder). The UI must not call a ticket-generating endpoint while opening the dialog, changing tabs, or rendering phase cards. A separate explicit Connect/Reconnect action response creates the ticket and returns the platform command plus `ticket.expiresAt`; the legacy Unix `command` field remains available in that action response for current macOS/Linux consumers until the new UI contract is verified. Ticket creation happens only in the explicit Connect action; preview/setup metadata must not create a ticket.

## 4. Frontend behavior

Detailed UI layout, component composition, state matrix, i18n keys, test hooks, and browser evidence requirements live in `ui-design.md`; this section records only the behavioral contract.

- Keep the existing Computers connection Dialog; do not add a new onboarding route.
- Add explicit Windows and macOS/Linux tabs. Browser platform only chooses the initial tab; the user can switch manually.
- Tabs are mutually exclusive: only the selected platform's shell label, commands, copy affordances, warnings, and status guidance are visible/copyable.
- Show all three phase cards for the selected platform. Do not use a local “I finished” checkbox as truth. Only server Online state is authoritative.
- Chinese is the default locale; English has equivalent translations. Guidance explains how to open PowerShell/Terminal, copy/paste, expected output, permission/network errors, retry, and logs.
- Connect/Reconnect is the only action that requests a fresh ticket. Pending state has a bounded deadline and a regenerate-ticket recovery path.
- Use existing atoms and tokens (Tabs, Button, Panel/Card, code/proof surface). Add stable `data-region` / `data-testid` hooks for platform tabs, phase cards, selected shell, and status evidence. Do not put hardcoded colors or one-off controls in the page layer.

## 5. Coexistence and safety

- Process identity combines executable path, PID metadata, config root, machine ID, and daemon ID; status must distinguish Aura standalone, Node/npm daemon, and legacy daemon.
- Local stale installation is not a migration event. Only active process or active server lease blocks replacement.
- Stop/upgrade operations are atomic and recoverable: stage new files, verify checksum/version, switch a pointer/launcher, retain the old version until the new process is healthy, then clean up.
- Never log raw machine tokens or include credentials in status output. The copied Connect command is the deliberate one-time secret handoff and must not be persisted in browser URLs.

## 6. Reference-project decision

Multica's Windows installer was checked for prior art: it uses a no-admin user PATH install, architecture detection from native Windows signals, versioned release downloads, and explicit verification guidance. SmallKhoj adapts those boundaries but rejects Multica's one-command setup because this task needs a visible Windows Install/Setup/Connect sequence and server-issued ticket timing.

## 7. Rollout and rollback

- Keep the existing Unix npx artifact and `command` response field during rollout.
- Publish Windows artifacts alongside Unix artifacts; do not switch the default UI until the Windows x64 real-host smoke flow passes.
- If standalone packaging fails, the server can continue serving the old Unix flow; the Windows tab must show a clear unavailable/retry state rather than emit a broken command.
- If a new Aura version fails health/connection checks, keep the previous version directory and allow explicit rollback; never delete the only known-good local version during upgrade.
