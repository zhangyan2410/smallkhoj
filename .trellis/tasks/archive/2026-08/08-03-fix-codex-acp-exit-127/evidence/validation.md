# Validation evidence

## Candidate identity

- Worktree: `/Users/code/project/smallkhoj-fix-codex-acp-exit-127`
- Branch: `feat/fix-codex-acp-exit-127`
- Base: `b97ea3a3269a`
- Deployment boundary: isolated local package/test processes only; no shared Daemon restart, database write, Docker change, or cloud deploy.

## TDD evidence

### Environment boundary

```text
RED: Expected undefined, actual /tmp/smallkhoj-daemon.tgz
GREEN: selector lower=undefined, upper=undefined; npm_config_registry preserved
```

### Final bridge spawn boundary

```text
RED child env: package=/tmp/outer-smallkhoj-daemon.tgz
GREEN child env: package=null, upperPackage=null
```

### Failed ACP readiness/lifecycle

```text
RED workspace states: starting, running, exited
GREEN workspace states: starting, exited
GREEN running agent heartbeat: false
GREEN exit evidence: code=127
```

## Automated checks

```text
TypeScript build: PASS
Focused Codex ACP/runtime/lifecycle regressions: 5/5 PASS
Integration Gate contract tests: 39/39 PASS
Backend Daemon-control tests: 54/54 PASS
Full Daemon suite: 284/286 passed; command exited 1 because of the two baseline-equivalent failures below
```

The two full-suite failures are unrelated pre-existing version-fixture drift:

```text
smallkhoj-daemon packaged CLI connect starts daemon with one-time ticket
smallkhoj-daemon supports Raft-style one-line npx onboarding arguments
expected 0.2.2, actual 0.2.3
```

Both were reproduced with the same assertions on unmodified `main@b97ea3a`; no new task-related failure appeared in the final full-suite run.

## Packaged nested-npx verification

`npm pack` produced:

```text
@smallkhoj/smallkhoj-daemon@0.2.3
smallkhoj-smallkhoj-daemon-0.2.3.tgz
packed size: 232830 bytes
```

The tgz was extracted under `/tmp`, production dependencies were installed there, and the package's own `dist/runtime` modules were used with the tgz set as the outer `npm_config_package`. Result:

```json
{"ok":true,"source":"packed-dist","daemonPackage":"@smallkhoj/smallkhoj-daemon@0.2.3","nestedPackage":"@zed-industries/codex-acp@0.16.0","selectorRemoved":true,"pidStarted":true,"outerPackageWasSet":true}
```

This proves the requested ACP package reached protocol initialization from the packaged candidate instead of recursively selecting the outer Daemon tgz and exiting `127`.
