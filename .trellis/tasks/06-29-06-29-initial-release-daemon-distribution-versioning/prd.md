# Initial release daemon distribution and versioning

## Goal

Replace development-path daemon connect commands with a product-grade downloadable, versioned daemon distribution and install/connect/upgrade flow.

This is release-critical because the current generated command can only work on a developer machine that already has the SmallKhoj repository checkout. External users should be able to install a daemon artifact, run a one-time connect command, reconnect later, and upgrade safely without knowing the repository layout.

## Requirements

- The frontend/backend must stop generating connect commands that point at a local development checkout path such as `/Users/code/project/smallkhoj/smallkhoj-daemon`.
- Users must have a clear download/install path for the daemon before they can run `connect`.
- The first supported platform can be macOS arm64, because the initial operator machine is a Mac mini. The design must leave room for macOS x64 and Linux later.
- The daemon distribution must include or install everything needed to run the daemon without a repository checkout. A user should not need to `cd agent/daemon/aaa-daemon`, run `npm install`, or run `npm run build`.
- The daemon package must expose a stable product command name, for example `smallkhoj-daemon`.
- The command shown by the product should look like an installed CLI command or an install-and-connect bootstrap, not an absolute path into a developer workspace.
- The daemon must expose a real version. Product UI and backend registration should record that version, and the version must match the packaged artifact.
- The version scheme must distinguish:
  - daemon CLI/package version;
  - daemon protocol/API compatibility if needed;
  - server/control-plane version or minimum supported daemon version.
- The backend should be able to warn or block unsupported daemon versions during connect/register/heartbeat.
- Connect-token safety must remain unchanged: browser-visible commands show one-time `sk_connect_...` tickets, not durable machine tokens.
- Reconnect should use the installed daemon and current Server URL. It should not require regenerating a repository-specific command.
- Upgrade behavior must be explicit:
  - how the user installs the newest daemon;
  - how the UI detects an old daemon;
  - whether running daemons need restart;
  - how failed upgrade/install attempts are diagnosed.
- The packaging flow must be reproducible from the repository and suitable for CI/release automation.
- The first release may use a simple hosted artifact or script as long as it is versioned, checksumable, and documented. It does not need a polished native installer.
- Release docs must explain the supported install path, upgrade path, rollback path, and troubleshooting path.
- The deployment flow must make daemon artifact URLs domain-aware. A production server should not hand out localhost or developer-machine download links.

## Acceptance Criteria

- [ ] `/computers` or equivalent onboarding UI no longer displays an absolute development-path daemon command.
- [ ] A fresh machine without a SmallKhoj repository checkout can install or download the daemon and run the generated connect command.
- [ ] The daemon can report `smallkhoj-daemon --version`, and that version matches the release artifact metadata.
- [ ] Backend Computer records and UI show the connected daemon version from the packaged daemon.
- [ ] Backend connect/register/heartbeat has a minimum-version or compatibility check, or the task explicitly records why it is deferred.
- [ ] Reconnect command uses the installed packaged daemon and the selected Server URL.
- [ ] Connect commands still expose only one-time connect tickets, not durable machine tokens.
- [ ] Artifact generation is covered by a repeatable script or CI-ready command.
- [ ] macOS arm64 artifact is produced or the task records a concrete blocker.
- [ ] Release docs include install, connect, reconnect, upgrade, rollback, and troubleshooting instructions.
- [ ] Real validation covers install/connect from outside the repository checkout path.
- [ ] Existing developer workflow remains available for local development, but it is not the product-facing command in production.

## Current Evidence

- `backend/routers/public_api.py` currently builds connect/start commands from `DEFAULT_DAEMON_LAUNCHER = Path(__file__).resolve().parents[2] / "smallkhoj-daemon"`.
- The root `smallkhoj-daemon` wrapper derives `DAEMON_DIR="$ROOT_DIR/agent/daemon/aaa-daemon"`, so it assumes a repository checkout.
- The wrapper runs `npm install` and `npm run build` when the daemon build is missing, and also attempts a build on every run. That is acceptable for development but not for a downloaded user daemon.
- `agent/daemon/aaa-daemon/package.json` has `version: 0.2.0`, while the wrapper help prints `smallkhoj-daemon 0.1.0`. Version ownership is currently split.
- The older `.trellis/tasks/06-09-daemon-packaged-onboarding/` task treated the root wrapper as packaged onboarding. That is no longer enough for the initial release.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
