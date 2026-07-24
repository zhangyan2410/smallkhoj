# Local capacity probe inherited the workstation HTTP proxy

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | The first real 8-user dry-run failed during fixture bootstrap with HTTP 502 and `httpx.ReadError`; several sibling tasks then emitted `Task exception was never retrieved`. No SSE or load phase started. |
| **2. Evidence** | The traceback entered `httpcore._async.http_proxy`, proving loopback requests were sent through the workstation proxy. `bootstrap_fixtures` awaited `asyncio.as_completed()` and propagated the first error without cancelling and draining its original task list. |
| **3. Confirmed root cause** | `httpx.AsyncClient` defaults to `trust_env=True`, while the local-only probe had no proxy opt-out. The fail-fast fixture loop also lacked structured sibling-task cleanup. |
| **4. Diagnostic strategy** | Keep the exact live dry-run as the RED. Disable environment proxy inheritance on the one probe client, add a `finally` block that cancels unfinished fixture tasks and gathers every task with `return_exceptions=True`, then rerun the same command. |
| **5. Timeout strategy** | The existing connect timeout remains the upper bound. Any subsequent failure must return one redacted error type and leave no unobserved task exception. |
| **6. Warning strategy** | Do not modify global proxy settings, add `NO_PROXY` assumptions, retry through the proxy, print credentials, or weaken the loopback target gate. |
| **7. User-visible correction** | None; this is a new local verification tool. It now reaches the explicitly validated local candidate directly and exits cleanly on fixture failure. |
| **8. Acceptance** | The repeated real 8-user, 5-steady/8-peak dry-run completed successfully with 8/8 streams, 15/15 correlated events, zero request/event errors and complete cleanup. Focused unit/Ruff/diff gates passed and the report secret scan found no credential value. |

## Five-piece report

- **Reporter:** Local capacity harness TDD dry-run on 2026-07-23.
- **Reproduction:** Run the local-only probe on a workstation with HTTP proxy environment variables set.
- **Root cause:** Implicit environment proxy inheritance plus incomplete sibling-task cleanup.
- **Repair:** Set `trust_env=False` on the capacity client and always cancel/drain fixture tasks.
- **Verification:** Repeat the exact disposable local dry-run and require a complete JSON report with no unhandled task output.

## Monitoring follow-up

The first successful dry-run reported seven PostgreSQL waiters because the
observer counted every non-null `wait_event`, including idle clients waiting on
`ClientRead`. A focused RED contract now requires `state = 'active' AND
wait_event IS NOT NULL`; the query uses that definition so capacity evidence
does not label healthy idle sockets as blocked SQL work.

## Bug diagnosis capsule: formal capacity evidence could pass without the reviewed load

| Field | Content |
| --- | --- |
| **1. Symptom** | The probe could report `acceptance.passed=true` without Docker resource evidence, with zero or materially incomplete active-user traffic, and after less than the configured 60-second cleanup observation. |
| **2. Evidence** | `ResourceMonitor.sample()` recorded only PostgreSQL plus an optional host PID; `capacity_failures()` did not require request volume, per-user cycles, peak concurrent SSE, clean candidate state, PostgreSQL configuration, container restart/OOM state, or zero ready streams; cleanup returned as soon as PG/FD counts first recovered. |
| **3. Confirmed root cause** | The initial harness validated protocol errors and latency but did not model evidence completeness as an acceptance contract. A timeout was also implemented as a maximum recovery wait instead of a fixed observation window. |
| **4. Diagnostic strategy** | Add focused contracts for targeted Docker discovery/inspection/stats, per-user workload accounting, actual phase timing, PostgreSQL invariants, clean candidate provenance and a fake-clock cleanup observation before changing the probe. |
| **5. Timeout strategy** | Keep the implementation bounded to the four production-shape services and deterministic local subprocess calls. If Docker output cannot be parsed without broad inspection, fail closed instead of recording partial evidence. |
| **6. Warning strategy** | Any missing service/sample, command error, container replacement/restart/OOM, active-task exception, insufficient per-user cycles, dirty candidate, PostgreSQL mismatch, deadlock, short workload/spike/cleanup duration, or residual client stream must make acceptance false. |
| **7. User-visible correction** | Operators receive a machine-readable report that proves the requested load actually ran and ties it to the exact local containers; the report still explicitly does not claim cloud capacity. |
| **8. Acceptance** | Focused RED tests must fail on the old behavior, then pass after the probe records all four core services, at least target-minus-one cycles per active user, the real 500-SSE peak, expected PostgreSQL state, a clean candidate and the full cleanup observation. A short Caddy smoke precedes the committed 30-minute run. |

Fixture data intentionally is not removed with cross-table SQL. Formal evidence uses
a freshly recreated disposable Compose volume, a unique namespace, and `down -v`
after the report and residual-count checks are saved. This keeps cleanup ownership
at the database boundary and avoids turning a capacity probe into a destructive
production-shaped data-deletion tool.

### Verification result (2026-07-24)

- RED: focused tests produced `22 failed, 12 passed` because Docker discovery,
  targeted state/stats parsing, fail-closed acceptance and the fixed observation
  helper did not exist.
- GREEN: `17 passed, 22 subtests passed`; focused Ruff passed; the complete script
  suite passed `129` tests.
- Local Caddy smoke: 5 steady / 8 peak SSE, 3 active users, 15 target cycles each.
  All 8 streams were concurrently ready; all users completed 15 cycles; 45 reads,
  45 writes and 45 correctly scoped events completed. Four core containers had
  complete samples with no restart, OOM or stopped state; PostgreSQL reported
  `max_connections=100` and zero deadlock delta; client cleanup reached zero.
- The smoke report intentionally failed only with `CANDIDATE_DIRTY`, proving the
  provenance guard rejects this pre-commit worktree. The report contained none of
  the public-key, auth-bridge or database-password values.
- The smoke Compose project and all labeled containers, network and volumes were
  removed after evidence inspection. The formal 300/500 run remains pending until
  a clean candidate commit is rebuilt into fresh production-shape images.

## Bug diagnosis capsule: release provenance and formal-capacity continuity could be forged

| Field | Content |
| --- | --- |
| **1. Symptom** | Three self-consistent but false release claims were accepted: a dirty filesystem could be built and labeled with clean `HEAD`; a baseline-only NOTIFY listener peak could hide listener loss for the whole workload; and a clean 1/2/1 short profile could be recomputed into `acceptance.passed=true` and presented as the 300/500/30 gate. |
| **2. Evidence** | Reviewer reproductions used staged/unstaged/untracked build-context changes, changed all post-baseline `notify_listeners` samples to zero and recomputed `_postgres_summary()`, and reduced every mutually dependent fixture/stream/workload/HTTP/event count to a valid 1/2/1 profile. The existing evaluator returned no failures. Report threshold evidence was also optional and ignored, so CLI p95/headroom limits and expected PostgreSQL max connections could be weakened. |
| **3. Confirmed root cause** | Candidate identity, formal-profile strength, and runtime-owner continuity were represented as point values or caller assertions instead of invariants over the build context and complete evidence history. A commit SHA label proves only a string unless the build context is clean and bound to that SHA; a historical maximum proves existence once, not continuous ownership; internal report consistency does not prove the operator-requested minimum load. |
| **4. Diagnostic strategy** | Treat these as one state-machine failure mode. Add RED tests for staged/unstaged/untracked and mismatched-SHA builds, baseline-only listeners, downgraded formal counts/durations/intervals/PostgreSQL settings, missing or weakened threshold evidence, non-formal smoke disposition, and existing-image label verification before changing implementation. Scan every sibling provenance/profile/raw-history boundary for the same point-in-time assumption. |
| **5. Timeout strategy** | Keep Git and Docker inspection local and bounded; fail before build/upload when provenance cannot be established. Capacity sampling keeps its existing finite interval and cleanup bounds. No cloud access is needed for this repair. |
| **6. Warning strategy** | Do not repair this by trusting an operator-supplied SHA, by checking only `git diff` (which misses staged/untracked state), by preserving only peak listener counts, by allowing threshold/profile fields to be omitted, or by calling a short smoke formal acceptance. Do not read or print deployment secrets while validating provenance. |
| **7. User-visible correction** | Release output will distinguish diagnostic smoke from formal capacity, reject dirty or mislabeled image candidates before transfer, and explain the exact fail-closed evidence code when continuous listener ownership or formal profile strength is missing. |
| **8. Acceptance** | RED tests fail for every forged path; GREEN requires clean `HEAD`-matched image builds, verified labels for any skip-build path, full raw listener continuity, a non-downgradable `formal-300-500-30-v1` contract with threshold evidence, focused/full script gates, and explicit reviewer approval on the latest files. |

This capsule is intentionally recorded before implementation. Final RED/GREEN counts,
reviewer disposition, and any real local-prod smoke evidence will be appended only after
those checks actually run.

## Bug diagnosis capsule: formal report did not bind the complete connection budget

| Field | Content |
| --- | --- |
| **1. Symptom** | A formal report recorded `BACKEND_WORKERS=1` and `NOTIFY_PUBLISHER_POOL_SIZE=2`, but did not prove the running DB pool, overflow, Better Auth pool, Feishu reserve or configured PostgreSQL headroom. A report could therefore pass while the deployment-wide pool allocation differed from the reviewed 48-connection budget. |
| **2. Evidence** | The old report schema exposed only two backend runtime integers. It had no frontend runtime inspection and no recomputable connection-budget object. Mutating a passing report to omit the budget, set `required=47`, or change the frontend pool did not produce a capacity failure. |
| **3. Confirmed root cause** | Capacity evidence reused a backend-only runtime contract after the startup validator had expanded to all PostgreSQL clients. The load model and the deployment resource model had separate, drifting evidence boundaries. |
| **4. Diagnostic strategy** | Add report mutations first, then make schema v5 record every base and derived term. Read only the reviewed integer variables from the backend/frontend containers, cross-check backend env capacity against `SHOW max_connections`, and recompute the formula in the evaluator. |
| **5. Timeout strategy** | Inspect targeted variables before fixture creation and fail immediately on any mismatch, so a known-invalid candidate cannot consume the 30-minute formal run. Docker inspection remains bounded and never dumps a container's complete environment. |
| **6. Warning strategy** | Reject missing/extra/non-integer fields, arithmetic inconsistency, runtime/report disagreement, a missing one-listener term, and synchronized substitutions that preserve 48 by shifting capacity between pool, overflow, frontend or headroom. |
| **7. User-visible correction** | Formal evidence now states exactly why the deployment reserves 48 of 100 PostgreSQL connections: backend `18`, Better Auth `10`, Feishu `15`, and operational headroom `5`. This remains local evidence and does not claim that the old cloud version was tested. |
| **8. Acceptance** | Initial focused RED produced `7 failed, 1 passed` plus seven failing subtests. GREEN now passes the complete capacity suite (`35 passed, 256 subtests`), the combined capacity/production-transfer suites (`56 passed, 259 subtests`), the direct production-transfer CLI regression, and canonical focused Ruff. A fresh local-prod smoke and the committed 30-minute 300/500/30 run remain pending. |

The formal allocation is intentionally exact, not merely arithmetically equivalent.
For example, changing DB pool/overflow from `5/10` to `4/11`, or Better Auth/headroom
from `10/5` to `9/6`, preserves the total but changes runtime behavior and is rejected.
The report also records one listener per backend worker explicitly; raw PostgreSQL
samples continue to prove that listener exists throughout every phase.

The v1 profile also fails before fixture creation when the scoped Compose project
contains any `feishu-worker` container. Its 15-connection term is deliberately an
unused reserve; this run does not sample worker CPU/memory or claim worker-load
capacity. Likewise, Better Auth's singleton bound is one frontend process. Worker or
frontend scaling requires explicit replica multipliers and a separately reviewed
profile.

Stored evidence is not trusted by summary. `stored_capacity_report_failures()` rebuilds
the evaluator thresholds, recomputes every failure from raw schema-v5 evidence, and
requires the stored `acceptance` object to match that exact result. The production
image-transfer gate calls this evaluator before checking candidate-tree continuity;
an incomplete or mutated report paired with forged `{passed: true, failures: []}` is
therefore rejected before any release action.

## Bug diagnosis capsule: transfer discarded the tested-tree to merge-SHA mapping

| Field | Content |
| --- | --- |
| **1. Symptom** | `execute_transfer()` could validate a formal report, inspect images and load the archive remotely, then return success without persisting which tested candidate, squash-merge commit, report bytes, image IDs or archive bytes formed that release. A later operator could not machine-verify that the different post-squash SHA had the identical tested tree. |
| **2. Evidence** | The execution path discarded `CapacityEvidence` and `ImageIdentity` after validation and calculated no archive hash. Runbook commands also omitted the now-mandatory `--capacity-report`, so copied real commands could reach only a late CLI error. |
| **3. Confirmed root cause** | Provenance checks were implemented only as transient gates, not as a durable release artifact. Tree equality correctly permits a squash commit with a different SHA, but the two identities and the exact report/archive hashes were never joined into one record. |
| **4. Diagnostic strategy** | Build a temporary Git repository with tested commit A and an empty squash/merge commit B where `A != B` and `tree(A) == tree(B)`. Execute the real transfer orchestration with only Docker/SSH steps replaced, then require one persisted and emitted JSON record binding both commits, the exact report, inspected images and saved archive. Scan all executable runbook blocks for the mandatory capacity flag. |
| **5. Timeout strategy** | Keep the regression local and deterministic: real Git/file/tar/hash operations, mocked Docker/SSH/SCP, and no cloud or network access. If evidence cannot be written after transfer, fail the release rather than silently returning success. |
| **6. Warning strategy** | Never copy report contents, environment variables, public keys, SSH identity contents or server env into release evidence. Record only reviewed artifact paths, hashes, Git identities, image identities and platforms. Do not treat smoke, failed/forged acceptance or a stale different-tree report as releasable. |
| **7. User-visible correction** | Every successful transfer now writes `<output-archive>.release-evidence.json` (or the explicit `--release-evidence` path) and emits a final JSON event with the evidence-file hash and payload. Runbooks explain formal-only, recomputed, same-tree acceptance. |
| **8. Acceptance** | RED failed at the execution boundary because `execute_transfer()` had no `release_evidence` output. GREEN proves post-squash same-tree/different-SHA mapping, exact report and archive SHA-256, image tag/ID/revision/platform, persisted JSON and emitted JSON. The complete production-transfer file passes 23 tests; focused Ruff and `git diff --check` pass. No Docker build, network, cloud, staging or commit was performed for this repair. |
