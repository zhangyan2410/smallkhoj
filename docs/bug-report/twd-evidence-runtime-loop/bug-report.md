# TWD evidence and runtime verification defects

## 1. Reporter

The operator reported that the `./twd` wrapper was unreliable in real project
work. Deterministic tests, an independent read-only audit, and the local real
runtime loop supplied the concrete reproductions.

## 2. Reproduction and expected behavior

Observed defects included timeout diagnostics emitted as successful JSON,
target-independent multi-bridge selection, partial URL acceptance, premature
post-navigation proof, compact/error inconsistencies, broken `act` cleanup,
incorrect boolean parsing, and authentication failure when a restarted local
tab was on `chrome-error://`. During final validation, a real agent reply also
produced an Integration Gate false negative because its long generated Slock
wrapper path was truncated before `message send`.

Expected behavior is fail-closed: the exact bridge/tab/final URL must be proven,
timeouts must be nonzero coded failures, handled CLI errors must be stable JSON,
and the real runtime Gate must recognize the actual Slock send without inferring
success merely from a persisted reply.

## 3. Root cause analysis

The outer shell launchers were pass-through and were not the defect. The Python
core/CLI treated uncertain transport states as ordinary values, selected the
first populated bridge before applying selectors, and did not enforce a single
command-wide failure contract. The Node guard compared only part of the URL and
trusted too few exact-tab payloads. It also tried token-bearing cookie injection
before recovering a dead page to the configured frontend origin. Finally, daemon
activity used a generic 200-character limit after retaining a generated absolute
wrapper path, consuming the preview before the semantic Slock verb.

## 4. Repair

Execution timeouts/interruption now raise coded terminal errors and always clean
pending state. Discovery is selector-aware across bridges. Guard acceptance
uses the same exact tab, validates every payload, proves normalized URL
components with bounded polling, and safely recovers frontend origin before
obtaining/injecting a token. CLI compact/error, `act` cleanup, and boolean
contracts were corrected. Daemon activity sanitization now collapses generated
Slock wrapper paths to `slock` before the existing size limit.

## 5. Verification

Every confirmed defect received a failing regression before implementation.
Focused Python/Node suites passed after repair. A live delayed exact-tab command
returned `EXECUTION_TIMEOUT` and a later command on the same tab succeeded. The
feature worktree then created a real Computer, Agent, Channel, conversation and
Task; UI, API, PostgreSQL and runtime trace agreed. The first live Integration
Gate report was retained at 10/11, and the same scenario passed 11/11 after the
daemon preview repair. This report makes no cloud-production claim.
