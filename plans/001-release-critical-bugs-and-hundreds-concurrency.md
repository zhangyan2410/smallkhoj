# Plan 001: Release critical audit fixes and prove the hundreds-connection envelope

> **Executor instructions:** Read this entire file before running anything.
> Execute the phases in order and confirm every expected result. If any STOP
> condition occurs, stop and report; do not weaken a validator, silently change
> the topology, visit the old cloud early, or improvise around provenance.
>
> **Drift check:** This plan was written against commit
> `ac80a6a300440cb1c44c25e9779583635eb024bb` on 2026-07-24. Run:
>
> ```bash
> rtk git diff --stat ac80a6a300440cb1c44c25e9779583635eb024bb..HEAD
> rtk git status --short --untracked-files=all
> ```
>
> The first command should be empty before the candidate commit; the second
> should match all and only the exact 145 literal entries in
> `plans/001-release-candidate-paths.txt`. This 145-entry manifest check is
> necessary but not sufficient: Phase 1 separately reconstructs and verifies
> the exact 142-path remediation core tree
> `d093af55e23543f9c5f9f44a96f3676a5f95809a`. Any additional commit, path or
> same-path content change is drift and must be dispositioned before proceeding.

## Status

- **Priority:** P1 release closure
- **Effort:** L; approximately 5–8 elapsed hours when all gates pass first try,
  plus any GitHub review/CI queue time
- **Risk:** HIGH because this integrates security/data fixes, freezes formal
  capacity evidence, and merges to `main`; Plan 001 performs no production
  access or mutation
- **Depends on:** none
- **Category:** correctness, security, performance, tests, delivery
- **Planned at:** `ac80a6a300440cb1c44c25e9779583635eb024bb`, 2026-07-24
- **Feature:** July 2026 critical audit remediation release; no new product feature
- **Architecture cell:** cross-cutting release workflow; no ownership-map change
- **Map delta:** none
- **Map delta why:** this closes already implemented contracts and release evidence;
  it does not introduce a new runtime owner
- **Frontend verification:** Yes. Repository UI acceptance uses `./twd`; committed
  authenticated integration uses Playwright through `make e2e-authenticated`
  and does not substitute for `./twd`.

## One-sentence finish line

The critical security, tenancy, migration, transaction, PostgreSQL/SSE,
deletion, CI and delivery fixes are committed as clean candidate A, pass one
complete local gate plus a target-shaped `300 steady / 500 peak / 30 active`
formal run, squash-merge as identical tree B, and produce verified
`linux/amd64` B images plus an immutable deployment bundle without accessing
the old cloud.

## Acceptance criteria

All criteria are mandatory:

1. The only source checkout modified before merge is
   `/Users/code/project/smallkhoj-audit-remediation` on
   `feat/2026-07-audit-remediation`. The main worktree's `MEMORY.md` and
   `session-observer/` remain untouched.
2. The 142-path remediation overlay exactly reconstructs core tree
   `d093af55e23543f9c5f9f44a96f3676a5f95809a`; it plus the three files under
   `plans/` forms the exact 145-entry manifest and is reviewed and staged only
   through that literal allowlist. No env,
   credential, build archive, `/tmp` file, unrelated WIP, or generated runtime
   content enters A. The three tracked `frontend/.runtime/*` entries enter only
   as deletions.
3. Candidate A is a clean commit. `production_image_transfer.py
   --check-source-only` accepts A.
4. On clean A, the canonical backend, migrations/PostgreSQL, Ruff, scripts,
   frontend locked install/tests/lint/typechecks/production build, Compose,
   diff, Trellis validation and authenticated integration gates all pass.
5. A fresh local production-shaped stack built from A passes post-deploy smoke,
   the minimal exact-tab `./twd` flow, and a machine-asserted one-physical-SSE
   invariant. File quarantine
   behavior remains covered by the existing real-UI evidence plus current
   component/integration tests; repeat the fault injection only if reviewer
   asks, never against cloud or shared data.
6. The formal capacity run is executed on an isolated x86_64 runner exposing
   exactly four Docker CPUs and no more than `3,564,584,960` bytes of Docker
   memory. The suggested isolated Colima profile uses 4 CPU and 3 GiB, which is
   stricter than the target guest memory. The default 6-CPU/12-GiB/aarch64
   profile is not acceptable capacity evidence.
7. Formal capacity uses schema v5, profile `formal-300-500-30-v1`, 300 steady
   SSE, 500 peak SSE, 30 active users, at least 1,800 active seconds, a 60-second
   peak hold and a 60-second cleanup observation. PostgreSQL is exactly
   `48 required / 100 available`, with zero Feishu worker containers.
8. Capacity exits 0 with exact accepted summary; stored evidence recomputation
   returns no failures. Additionally, `samplingOverruns == 0` and
   `maxSampleGapSeconds <= 5.5`, closing the current evaluator/spec cadence gap
   for this release.
9. Candidate A, its images and its Git tree remain unchanged throughout formal
   capacity. Formal capacity is the final tree-bound local gate; any later edit
   or commit that changes the root tree invalidates it. The sole allowed new
   commit identity is squash merge B when `B^{tree} == A^{tree}` exactly.
10. Independent review of the final A diff reports no open P1/P2. P3 and large
    architecture work are recorded as deferred rather than expanded into this
    release.
11. PR checks all succeed and the PR is squash-merged into `main`. Merge commit
    B is contained in `origin/main`, a fresh detached B checkout is clean, and
    `B^{tree} == A^{tree}` exactly.
12. B produces daemon artifacts and three distinct `linux/amd64` images whose
    OCI revision labels all equal B. The frontend is rebuilt `--no-cache` with
    the production public key passed only as a BuildKit secret.
13. Detached B passes a fresh local production-shape smoke using the exact
    inspected image IDs, and the no-clobber B bundle digest is recorded outside
    Git.
14. No cloud host, URL, tab or old deployment is accessed. Production remains
    explicitly pending a separate post-merge runbook bound to B and reviewed
    under the Phase-10 requirements.

## What this plan does not build

- No Router extraction, `ChannelClient` decomposition, chat-state-owner
  consolidation, observer integration, Durable Work Item, `/control/*` redesign,
  Remotion cleanup, or other feature/architecture work.
- No Feishu worker load test. The profile reserves 15 PostgreSQL connections for
  an inactive worker but requires zero worker containers.
- No claim of 300 or 500 simultaneous writers. The contract is 300 steady
  connected SSE users, 500 peak connected SSE users, and 30 continuously active
  users.
- No WAN/Internet load generation. Local formal evidence proves the controlled
  production shape and target resource envelope. Plan 001 does not prove cloud
  deployment or WAN capacity, and it is not honest to call this a 500-user WAN
  cloud benchmark.
- No automatic production rollback or destructive production database restore.
  Those require a separately reviewed maintainer incident-recovery decision.

## Why this matters

The original audit was directionally correct, but several advisor fixes failed
under real PostgreSQL or stopped short of a deployable contract. The current
overlay repairs the high-value failures: sequence/migration adoption, object
authorization and tenancy, delete compensation, PostgreSQL resource ownership,
SSE and pagination, CI/E2E credential alignment, image provenance and visible
destructive actions. The remaining risk is no longer “write more application
code”; it is preserving one candidate identity from local verification through
squash merge and handing the exact B artifact to a separately controlled
production stage.

## Current state and evidence already available

At plan time:

```text
worktree: /Users/code/project/smallkhoj-audit-remediation
branch: feat/2026-07-audit-remediation
HEAD: ac80a6a300440cb1c44c25e9779583635eb024bb
HEAD tree: c9eeb18baef8cc36c11a2aa071176bc5148f10a3
origin/main: c280e43e30bd30c95b284fc3be42a6a7927f4ca7
ahead/behind HEAD...origin/main: 20 / 0
candidate status: dirty, unstaged, uncommitted, not pushed, not merged, not deployed
```

The latest complete local gate recorded before this plan reported:

```text
backend pytest: 513 passed
backend Ruff: passed
scripts suite: 170 collected; 169 passed, 1 conditional skip
capacity/release/E2E contract subset: 75 passed
frontend tests: 204 passed
ESLint: passed
TypeScript app and E2E: passed
Next production build and standalone server: passed
authenticated E2E: 1 passed
Compose, diff, Trellis task validation: passed
```

Those results are useful prior evidence, not a substitute for the clean-A gate
below. `actionlint` and `gitleaks` are locally unavailable and the fallback-layer
script does not exist; say “unavailable,” not “passed.”

The existing dirty local capacity smoke proved the harness at `5 steady / 8
peak / 3 active`, but correctly failed only with `CANDIDATE_DIRTY` and
`NON_FORMAL_CAPACITY_PROFILE`. It is not formal capacity evidence.

The target cloud facts are:

```text
architecture: x86_64 / linux/amd64
vCPUs: 4
guest-visible RAM: 3,564,584,960 bytes (3.3198 GiB, reported as 3.32 GiB)
swap: 3 GiB emergency headroom, excluded from steady RAM
PostgreSQL max_connections: 100
```

## Important finding disposition

| Area | Current disposition | Release boundary |
|---|---|---|
| schema and migration integrity | implemented and focused-gated | clean A full gate, formal capacity, merge |
| object authorization and tenancy | implemented and focused-gated | clean A full gate, independent P1/P2 review |
| deletion and storage compensation | implemented and real-PostgreSQL/UI-gated | minimal clean-A UI plus full regression |
| PostgreSQL/NOTIFY/SSE/pagination | implemented and focused-gated | formal capacity and clean-A full gate |
| CI/E2E/images/release evidence | implemented and contract-gated | PR CI, merged-main proof, running-image proof |
| P006 | `ACCEPT_DOC_TRUTH`, implementation `DEFERRED`, `RELEASE_EXCLUDED` | do not rewrite `DESIGN.md` in this release |
| P007/P008/P010/P011 | `DEFER_LINKED`, `RELEASE_EXCLUDED` | do not touch their WIP/features |
| P009 | `SUPERSEDED_BY_SCHEMA_AND_DELIVERY` | closure occurs through this release plan |
| target-runner identity | script gap; manual P1 release gate | exact x86_64/4-CPU/≤target-memory proof required |
| merged-main identity | transfer-script gap; manual P1 release gate | require B in `origin/main` and clean detached B |
| running-image identity | deploy-verifier gap; post-merge production gate | separate runbook must compare remote running IDs/revisions to B evidence |
| web rollback | automatic rollback rejected for this release | failure freezes writers/ingress and requires a separate incident-recovery review |

## Stateful-object census

This plan owns four lifecycle objects. Production deployment is an explicit
post-merge handoff and may not be silently added to Plan 001.

| Object | Unique lifecycle owner | States | Forbidden bypass |
|---|---|---|---|
| Git candidate | release executor in remediation/release worktrees | dirty overlay → staged allowlist → clean A → reviewed A → merged B | editing A after formal; building from main WIP; calling an unmerged feature HEAD a merge candidate |
| local capacity stack | Compose project `smallkhoj-audit-capacity-final` on the isolated capacity Docker context | absent → fresh A stack → UI-ready → formal-running → evidence-saved → destroyed | shared DB, reused volume, extra worker, unknown forwarding process, default large ARM runner |
| capacity report | `scripts/local_capacity_probe.py` | absent → atomically written → recomputed accepted → immutable by SHA-256 | hand-editing summary, trusting `acceptance.passed` without recomputation, using smoke as formal |
| release artifacts | clean detached B checkout plus `production_image_transfer.py` | built → inspected → archived → locally smoked → handoff-ready | wrong platform, A label on B image, regenerated bundle, cloud transfer inside Plan 001 |

### State/event transition table

| Current state | Event | Required next state | Evidence |
|---|---|---|---|
| dirty overlay | literal staging + commit | clean A | status empty, A and `TREE_A` recorded |
| clean A | full gate/UI/review | reviewed A | command outputs and no P1/P2 |
| reviewed A | target-shaped formal run | accepted A | schema-v5 report, report hash, resource-shape evidence |
| accepted A | PR squash merge | merged B | PR state `MERGED`, B in `origin/main` |
| merged B | tree comparison | releasable B | `TREE_B == TREE_A` and clean detached checkout |
| releasable B | amd64 build | inspected B artifacts | three image IDs, B labels, linux/amd64, daemon manifest |
| inspected B artifacts | fresh local B smoke + immutable bundle | production handoff-ready | exact image-ID parity, local smoke, bundle/report hashes, no cloud access |

### Invariants

- **INV-1:** The old cloud is not contacted before B is merged into `origin/main`.
- **INV-2:** A is clean and immutable during image build, UI, review and formal capacity.
- **INV-3:** Every A runtime image revision label equals A; every release image label equals B.
- **INV-4:** Formal capacity runs against a fresh loopback-only disposable DB and exactly four core services, with no Feishu worker container.
- **INV-5:** PostgreSQL budget is exactly backend 18 + Better Auth 10 + inactive worker reserve 15 + headroom 5 = 48 of 100.
- **INV-6:** Formal report schema/profile/raw evidence recompute cleanly; sampling overruns are zero and maximum sample gap is at most 5.5 seconds.
- **INV-7:** `TREE_A == TREE_B`; equal touched-file diffs are insufficient—the complete root tree must match.
- **INV-8:** Plan 001 never contacts or mutates the cloud; B deployment is not claimed from local evidence.
- **INV-9:** The opaque local env file is only an `--env-file` input. It is never read, printed, sourced, interpolated into chat, or committed.
- **INV-10:** Port `55432` is never used. Unknown SSH/Colima forwards are neither reused nor stopped.
- **INV-11:** Production rollback and DB overwrite/drop/restore are not authorized
  by this plan. A future restore drill may use `dropdb` only as final cleanup
  after this invocation successfully created its unique restore database.
- **INV-12:** Before any Docker CLI metadata or daemon call, the selected
  Docker configuration directory is machine-proved absolute, canonical,
  existing, non-symlink, current-user-owned and outside every Git worktree.
  The selected build context is then machine-proved to name an existing local
  Unix socket. Every direct Docker command uses the frozen `--config`; every
  daemon command also uses an explicit `--context`. Commands that may invoke
  Docker transitively receive pinned `DOCKER_CONFIG` and `DOCKER_CONTEXT`
  values with `DOCKER_HOST` and `PYTHONOPTIMIZE` unset.

### Adversarial scenarios that must fail closed

1. Add or edit one file after formal capacity: report becomes stale; create A2,
   rebuild and rerun the full formal profile.
2. Replace a passing report's acceptance summary: stored recomputation rejects it.
3. Run on the default 6-CPU/12-GiB/ARM Docker profile: target-runner gate rejects it.
4. Start a Feishu worker or a second backend/frontend process: topology gate rejects it.
5. Lose the single NOTIFY listener during any phase: raw-sample evaluator rejects it.
6. Let `origin/main` advance after A: B tree would change; refresh candidate and rerun.
7. Squash produces B with a different tree: do not build, upload or deploy.
8. A command attempts SSH, SCP, a cloud URL or an old-cloud browser tab before
   the separate production runbook: Plan 001 stops without making the request.
9. Evidence contains a possible credential: isolate the file, report only the
   credential type/location, rotate it, and never quote the value.

## Required tools, locations and opaque inputs

Run repository commands from `/Users/code/project/smallkhoj-audit-remediation`
until Phase 8 creates the detached release worktree.

| Token/path | Meaning | Rule |
|---|---|---|
| `/tmp/smallkhoj-audit-local-prod.env` | existing repo-external local gate/runtime env | only pass to `uv --env-file` or Compose `--env-file`; never inspect |
| `__A__`, `__TREE_A__`, `__A_SHORT__` | candidate commit, tree and first 12 hex characters | record exact command output; full values must be 40 lowercase hex |
| `__BASE_MAIN__` | `origin/main` SHA checked immediately before and immediately after A | if it changes before merge, stop |
| `__PR__` | PR URL or number | copy from `gh pr create` |
| `__B__`, `__TREE_B__`, `__B_SHORT__` | squash merge commit, tree and first 12 hex characters | B must be in `origin/main`; trees must match A |
| `__PRODUCTION_BUILD_ENV_FILE__` | operator-supplied single-purpose repo-external env whose only assignment is the production `PUBLIC_API_KEY` | before its first load, machine-prove its path is absolute/canonical, a regular non-symlink file outside every Git worktree, current-user-owned and owner-only; use only as an env-file input; operator validates its single assignment out of band; never inspect contents |
| `__B_IMAGE_ARCHIVE__` | operator-supplied absolute path for the durable B `linux/amd64` Docker archive | parent must already exist on persistent local storage outside every Git worktree and `/tmp`; file must not exist before the no-clobber save |
| `__B_DEPLOYMENT_BUNDLE__` | operator-supplied absolute path for the durable B deployment bundle | same persistent-path/non-containment/no-clobber rules as the image archive; Phase 10 consumes these exact bytes |
| `__LOCAL_DOCKER_CONFIG_DIR__` | operator-selected Docker CLI configuration-store directory | prove it is absolute, canonical, existing, non-symlink, current-user-owned and outside every Git worktree before the first Docker metadata call; never inspect its contents; every Docker CLI invocation names it explicitly |
| `__LOCAL_BUILD_DOCKER_CONTEXT__` | operator-selected Docker context for preflight, CI and A/B image build/archive work | prove its endpoint is an existing local Unix socket before the first daemon call; every daemon command names it explicitly |
| `__CAPACITY_PROFILE__`, `__CAPACITY_DOCKER_CONTEXT__` | A-scoped Colima profile and its actual Docker context | derive after A; never guess or use default context |
| `__B_SMOKE_DOCKER_CONTEXT__` | actual context for the new B-scoped artifact-smoke VM | derive by socket/endpoint match; never guess |
| `__TWD_TRANSPORT_TAB_ID__`, `__TWD_TAB_ID__`, `__UI_MARKER__` | operator-approved blank extension transport, dedicated local tab and unique Task marker | record exact command output; never enumerate all tabs or navigate/read the transport tab |
| `__PLAN_FREEZE_LEDGER__` | absolute repo-external owner-only JSON ledger created after two final cold-review GO verdicts | binds the final plan/README/manifest SHA-256 values, 142-path core tree and full 145-path candidate tree; never regenerate it merely to accept drift |
| `__EVIDENCE_DIR__` | absolute repo-external durable evidence directory | must not be inside either Git worktree |

If any opaque input is missing, stop and ask the operator for the path or
identifier. Never ask for or print the secret value itself.

Placeholders are substituted only in the shell command being run or in a
repo-external execution ledger. Never edit this plan to replace a placeholder.
Commit/tree tokens must match the lengths above; short tokens are exactly 12
lowercase hex. Profile, context and local path tokens must use a conservative
operator-approved character set with no quotes, backticks, dollar signs or
shell metacharacters. A token that fails validation is a STOP, not an
invitation to interpolate it anyway.

## Scope

**In scope:** exactly the literal paths in
`plans/001-release-candidate-paths.txt`, local task-owned containers/profiles,
the PR, merge commit B, detached B release artifacts and local B smoke.

**Out of scope:** all other repository paths, main-worktree WIP, unknown Docker
projects/forwards, every cloud/SSH operation, Feishu/Jira/LLM live writes, and
all production mutation or recovery.

## Phase 0 — Preflight isolation and authority

1. Confirm worktree, branch and base before broad discovery:

   ```bash
   rtk codegraph status
   rtk git rev-parse --show-toplevel
   rtk git branch --show-current
   rtk git worktree list --porcelain
   rtk git rev-parse HEAD HEAD^{tree} origin/main
   rtk git rev-list --left-right --count HEAD...origin/main
   ```

   Expected: root is `/Users/code/project/smallkhoj-audit-remediation`, branch
   is `feat/2026-07-audit-remediation`, and behind count is zero. If behind is
   nonzero, stop: integrate the new base before creating A, then rerun all drift
   and allowlist checks.

2. Confirm the main worktree is separate without reading its WIP:

   ```bash
   rtk git -C /Users/code/project/smallkhoj status --short
   ```

   `MEMORY.md` and `session-observer/` may appear. Do not open, move, delete,
   stage or commit them.

3. Initialize a new durable evidence directory before any evidence-producing
   command. The operator supplies an empty path; it must resolve outside every
   Git worktree and must not be reused from an older candidate:

   ```bash
   rtk env -u PYTHONOPTIMIZE python3 -c 'import os,stat,subprocess,sys; from pathlib import Path; requested=Path(sys.argv[1]); assert requested.is_absolute() and not requested.is_symlink(); parent=requested.parent.resolve(strict=True); canonical=parent/requested.name; assert requested==canonical; roots=[Path(line.removeprefix("worktree ")).resolve() for line in subprocess.check_output(["git","worktree","list","--porcelain"],text=True).splitlines() if line.startswith("worktree ")]; assert roots and all(canonical!=root and root not in canonical.parents for root in roots); exists=canonical.exists(); assert not exists or canonical.is_dir(); st=canonical.stat() if exists else None; assert not exists or (st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700 and next(canonical.iterdir(),None) is None); print("evidence-path-preflight: verified",canonical)' '__EVIDENCE_DIR__'
   rtk mkdir -p '__EVIDENCE_DIR__'
   rtk chmod 700 '__EVIDENCE_DIR__'
   rtk realpath '__EVIDENCE_DIR__'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import os,stat,subprocess,sys; from pathlib import Path; requested=Path(sys.argv[1]); assert requested.is_absolute() and not requested.is_symlink(); real=requested.resolve(strict=True); assert requested==real and real.is_dir(); roots=[Path(line.removeprefix("worktree ")).resolve() for line in subprocess.check_output(["git","worktree","list","--porcelain"],text=True).splitlines() if line.startswith("worktree ")]; assert roots and all(real!=root and root not in real.parents for root in roots); st=real.stat(); assert st.st_uid==os.getuid() and stat.S_IMODE(st.st_mode)==0o700; assert next(real.iterdir(),None) is None; print("evidence-directory: verified",real)' '__EVIDENCE_DIR__'
   rtk stat -f '%Sp %Su %N' '__EVIDENCE_DIR__'
   ```

   Expected: the requested path is absolute/canonical, belongs to no root from
   `git worktree list --porcelain`, contains nothing, is owned by the current
   user and has exact mode `0700`. If it is non-empty or belongs to any
   worktree, choose a new directory. Never put a copy of an env file in this
   directory.

4. Before the first Docker CLI metadata or daemon call, select and prove the
   Docker configuration directory, then select and prove the local build
   context from that exact store. The directory validator is read-only and
   must not enumerate or read any file inside the configuration directory.
   `docker --config ... context inspect` reads local CLI metadata from the
   frozen store; it does not contact the endpoint. The selected endpoint must
   be an existing local Unix socket before `docker info` is allowed:

   ```bash
   rtk env -u PYTHONOPTIMIZE python3 -c 'import os,subprocess,sys; from pathlib import Path; requested=Path(sys.argv[1]); assert requested.is_absolute() and not requested.is_symlink(); real=requested.resolve(strict=True); assert requested==real and real.is_dir(); roots=[Path(line.removeprefix("worktree ")).resolve() for line in subprocess.check_output(["git","worktree","list","--porcelain"],text=True).splitlines() if line.startswith("worktree ")]; assert roots and all(real!=root and root not in real.parents for root in roots); assert real.stat().st_uid==os.getuid(); print("local-docker-config-directory: verified",real)' '__LOCAL_DOCKER_CONFIG_DIR__'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/local-build-docker-endpoint.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ context inspect __LOCAL_BUILD_DOCKER_CONTEXT__ --format '{{.Endpoints.docker.Host}}' > '__EVIDENCE_DIR__/local-build-docker-endpoint.txt'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/local-build-docker-endpoint.txt' ]]"
   rtk env -u PYTHONOPTIMIZE python3 -c 'import os,stat,sys; endpoint=open(sys.argv[1]).read().strip(); assert endpoint.startswith("unix://") and "\n" not in endpoint; path=endpoint.removeprefix("unix://"); assert os.path.isabs(path); st=os.stat(path); assert stat.S_ISSOCK(st.st_mode); print("local-build-docker-endpoint: verified",sys.argv[2],os.path.realpath(path))' '__EVIDENCE_DIR__/local-build-docker-endpoint.txt' __LOCAL_BUILD_DOCKER_CONTEXT__
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/local-build-docker-info.json' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ info --format '{"architecture":{{json .Architecture}},"os":{{json .OSType}},"name":{{json .Name}}}' > '__EVIDENCE_DIR__/local-build-docker-info.json'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/local-build-docker-info.json' ]]"
   rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); assert p.get("os")=="linux" and isinstance(p.get("architecture"),str) and p["architecture"] and isinstance(p.get("name"),str) and p["name"]; print("local-build-docker-daemon: verified",p)' '__EVIDENCE_DIR__/local-build-docker-info.json'
   rtk shasum -a 256 '__EVIDENCE_DIR__/local-build-docker-endpoint.txt' '__EVIDENCE_DIR__/local-build-docker-info.json'
   ```

   Record the validated directory as `__LOCAL_DOCKER_CONFIG_DIR__` and the
   already-existing local context as `__LOCAL_BUILD_DOCKER_CONTEXT__`; do not
   infer either from `HOME`, ambient `DOCKER_CONFIG`, or whichever context is
   currently active. A non-canonical/symlink/unowned/worktree-contained store,
   TCP/SSH endpoint, missing/non-socket Unix path, failed metadata read or
   failed daemon identity is a STOP. After this point, bare Docker commands are
   forbidden. Only `docker --config __LOCAL_DOCKER_CONFIG_DIR__ context
   inspect/ls` may omit `--context`, because those subcommands inspect local
   CLI metadata. They may never omit the frozen `--config`.

5. Verify the opaque env is only usable as an env-file input:

   ```bash
   rtk uv run --project backend --no-sync --env-file /tmp/smallkhoj-audit-local-prod.env rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__LOCAL_BUILD_DOCKER_CONTEXT__ python3 scripts/local_capacity_probe.py --help
   rtk zsh -c 'set -euo pipefail; for service in db backend frontend caddy; do ids=$(rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ compose --env-file /tmp/smallkhoj-audit-local-prod.env -p smallkhoj-audit-capacity-final -f docker-compose.prod.yml ps -aq "$service"); for id in ${(f)ids}; do rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ inspect --format "service=$service container={{.Id}} image={{.Image}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} project={{index .Config.Labels \"com.docker.compose.project\"}}" "$id"; done; done'
   ```

   Expected: help exits 0; Compose output, if present, is limited to the known
   task project. Do not run `cat`, `sed`, `rg`, `source`, `printenv`, Compose
   `config`, or any command that expands env contents.

6. Check protected ports and ownership:

   ```bash
   rtk zsh -c 'set -euo pipefail; for port in 55432 55436 38181 38182; do rc=0; out=$(rtk lsof -nP -iTCP:$port -sTCP:LISTEN 2>&1) || rc=$?; if [[ $rc -eq 1 && -z "$out" ]]; then continue; fi; if [[ $rc -ne 0 ]]; then rtk printf "%s\n" "$out" >&2; exit $rc; fi; if [[ -n "$out" ]]; then rtk printf "listener-on-protected-port=%s\n%s\n" "$port" "$out" >&2; exit 1; fi; done; rtk printf "protected-ports-free=55432,55436,38181,38182\n"'
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ ps --format '{{.ID}} {{.Names}} {{.Image}} {{.Ports}} {{.Status}} {{.Label "com.docker.compose.project"}}' --filter publish=55436
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ ps --format '{{.ID}} {{.Names}} {{.Image}} {{.Ports}} {{.Status}} {{.Label "com.docker.compose.project"}}' --filter publish=38181
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ ps --format '{{.ID}} {{.Names}} {{.Image}} {{.Ports}} {{.Status}} {{.Label "com.docker.compose.project"}}' --filter publish=38182
   ```

   Never use `55432`. A free `38181`, `38182` or `55436` is safe. A listener is
   usable/removable only if Docker identifies the exact task-owned Caddy or
   forward container named later in this plan. Unknown listeners are a STOP;
   do not kill them.

7. From this point through Phase 9, do not run `ssh`, `scp`, a cloud URL,
   `remote_deploy_evidence.py`, or any command that accesses the old cloud.

## Phase 1 — Reconcile the exact release overlay

1. The manifest has 145 literal entries: 142 current remediation paths plus
   itself, this plan and the index.

   ```bash
   rtk wc -l plans/001-release-candidate-paths.txt
   rtk zsh -c 'set -euo pipefail; rtk git -c core.quotePath=false status --short --untracked-files=all | rtk cut -c4- | rtk sort > /tmp/smallkhoj-live-paths.txt; rtk sed "s/^:(literal)//" plans/001-release-candidate-paths.txt | rtk sort > /tmp/smallkhoj-expected-paths.txt; rtk diff -u /tmp/smallkhoj-expected-paths.txt /tmp/smallkhoj-live-paths.txt'
   ```

   Expected: line count `145`; diff exit 0 with no output. Any extra or missing
   path is a STOP until a reviewer explicitly classifies it. Do not edit the
   manifest casually to make the diff green.

2. Pin same-path content, modes, additions and deletions by reconstructing the
   repository tree with the 142 remediation paths but without the three plan
   files. This uses an isolated temporary Git index and does not stage the real
   worktree:

   ```bash
   rtk zsh -c 'set -euo pipefail; tmpdir=$(rtk mktemp -d /tmp/smallkhoj-release-core.XXXXXX); index="$tmpdir/index"; trap "rtk rm -rf '\''$tmpdir'\''" EXIT; rtk env GIT_INDEX_FILE="$index" git read-tree HEAD; rtk env GIT_INDEX_FILE="$index" git add --pathspec-from-file=plans/001-release-candidate-paths.txt; rtk env GIT_INDEX_FILE="$index" git update-index --force-remove -- plans/README.md plans/001-release-critical-bugs-and-hundreds-concurrency.md plans/001-release-candidate-paths.txt; actual=$(rtk env GIT_INDEX_FILE="$index" git write-tree); rtk printf "%s\n" "$actual"; [[ "$actual" == d093af55e23543f9c5f9f44a96f3676a5f95809a ]]'
   ```

   Expected exact output:
   `d093af55e23543f9c5f9f44a96f3676a5f95809a`. A different value means a
   same-path source/test/spec content or mode change and is a STOP even when the
   path-only diff is empty.

3. Bind the three mutable plan files and the complete 145-path candidate tree
   to the repo-external final-review ledger. The ledger is created once only
   after two independent reviewers have returned GO for the same final plan
   SHA. It has this exact schema:

   ```json
   {
     "schemaVersion": 1,
     "manifestEntries": 145,
     "planSha256": "64 lowercase hex",
     "readmeSha256": "64 lowercase hex",
     "manifestSha256": "64 lowercase hex",
     "coreTree": "40 lowercase hex",
     "candidateTree": "40 lowercase hex",
     "reviews": [
       {"reviewer": "non-empty", "verdict": "GO", "planSha256": "same final plan SHA"},
       {"reviewer": "different non-empty reviewer", "verdict": "GO", "planSha256": "same final plan SHA"}
     ]
   }
   ```

   Validate file identities and reviewer binding first:

   ```bash
   rtk zsh -c "[[ -f '__PLAN_FREEZE_LEDGER__' ]]"
   rtk stat -f '%Sp %Su %N' '__PLAN_FREEZE_LEDGER__'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import hashlib,json,os,re,subprocess,sys; from pathlib import Path; ledger=Path(sys.argv[1]); assert ledger.is_absolute() and not ledger.is_symlink(); real=ledger.resolve(strict=True); assert ledger==real; roots=[Path(line.removeprefix("worktree ")).resolve() for line in subprocess.check_output(["git","worktree","list","--porcelain"],text=True).splitlines() if line.startswith("worktree ")]; assert roots and all(real!=root and root not in real.parents for root in roots); p=json.loads(real.read_text()); h=lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest(); assert p["schemaVersion"]==1 and p["manifestEntries"]==145; assert p["planSha256"]==h(sys.argv[2]) and p["readmeSha256"]==h(sys.argv[3]) and p["manifestSha256"]==h(sys.argv[4]); assert p["coreTree"]==sys.argv[5] and re.fullmatch(r"[0-9a-f]{40}",p["candidateTree"]); reviews=p["reviews"]; assert len(reviews)>=2 and len({row["reviewer"] for row in reviews})>=2; assert all(row["reviewer"] and row["verdict"]=="GO" and row["planSha256"]==p["planSha256"] for row in reviews); st=real.stat(); assert st.st_uid==os.getuid() and st.st_mode & 0o077==0; print("plan-freeze-ledger: verified",p["planSha256"],p["candidateTree"])' '__PLAN_FREEZE_LEDGER__' plans/001-release-critical-bugs-and-hundreds-concurrency.md plans/README.md plans/001-release-candidate-paths.txt d093af55e23543f9c5f9f44a96f3676a5f95809a
   ```

   Then reconstruct the full manifest tree with an isolated index and compare
   it to the frozen `candidateTree`:

   ```bash
   rtk zsh -c 'set -euo pipefail; tmpdir=$(rtk mktemp -d /tmp/smallkhoj-release-full.XXXXXX); index="$tmpdir/index"; trap "rtk rm -rf '\''$tmpdir'\''" EXIT; rtk env GIT_INDEX_FILE="$index" git read-tree HEAD; rtk env GIT_INDEX_FILE="$index" git add --pathspec-from-file=plans/001-release-candidate-paths.txt; actual=$(rtk env GIT_INDEX_FILE="$index" git write-tree); expected=$(rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['\''candidateTree'\''])" "__PLAN_FREEZE_LEDGER__"); rtk printf "candidateTree=%s\n" "$actual"; [[ "$actual" == "$expected" ]]'
   ```

   Any hash, review identity, mode, schema or complete-tree mismatch is a STOP.
   The executor may not replace the ledger; return to final cold review.

4. Assert the tracked local runtime artifacts are deletions only:

   ```bash
   rtk git diff --name-status -- frontend/.runtime/dev-server.log frontend/.runtime/dev-server.pid frontend/.runtime/start-dev.sh
   rtk zsh -c 'set -euo pipefail; for path in frontend/.runtime/dev-server.log frontend/.runtime/dev-server.pid frontend/.runtime/start-dev.sh; do [[ ! -e "$path" ]] || exit 1; done'
   ```

   Expected: exactly three `D` entries, one for each named path, and the absence
   assertion exits 0. `A`, `M`, `??`, regenerated log/PID content, or a restored
   hard-coded `start-dev.sh` is a release STOP. The manifest permits only their
   deletion; it never permits staging runtime contents.

5. Review the overlay and documented dispositions:

   ```bash
   rtk git diff --check
   rtk git diff --stat
   rtk git diff --name-status
   rtk rg -n 'RELEASE_EXCLUDED|SUPERSEDED_BY_SCHEMA_AND_DELIVERY|formal capacity pending|旧镜像|old cloud' docs/2026-07-代码审计报告.md docs/audits/2026-07-代码审计-交接给审计agent.md .trellis/tasks/07-20-07-19-codebase-audit/plans/README.md
   ```

   Expected: diff check exits 0; P006–P011 and old-cloud boundaries match the
   disposition table in this plan.

6. Run the final plan-source static Docker binding and placeholder contract.
   This command reads only this plan; it does not invoke Docker, Colima or any
   env file:

   ```bash
   rtk env -u PYTHONOPTIMIZE python3 -c 'import re,sys; from pathlib import Path; path=Path(sys.argv[1]); text=path.read_text(); lines=[line.strip() for line in text.splitlines() if line.lstrip().startswith("rtk ") and "plan-docker-config-contract" not in line]; config="docker --config __LOCAL_DOCKER_CONFIG_DIR__"; docker_lines=[line for line in lines if "docker --" in line or "docker context " in line]; assert docker_lines; bad_config=[line for line in docker_lines if line.count("docker --")!=line.count(config) or "docker context " in line]; assert not bad_config,bad_config; metadata=sum(len(re.findall(re.escape(config)+r" context (?:inspect|ls)\b",line)) for line in docker_lines); configs=sum(line.count(config) for line in docker_lines); contexts=sum(len(re.findall(r"--context __[A-Z0-9_]+__",line)) for line in docker_lines); assert configs==metadata+contexts,(configs,metadata,contexts); sensitive=[line for line in lines if "uv run" in line and "--env-file" in line and any(marker in line for marker in ("make ci","make e2e-authenticated","local_capacity_probe.py",config))]; required=("-u DOCKER_HOST","-u PYTHONOPTIMIZE","DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__","DOCKER_CONTEXT="); bad_env=[line for line in sensitive if any(item not in line for item in required)]; assert sensitive and not bad_env,bad_env; mutators=[line for line in lines if "colima start " in line or "colima delete " in line]; bad_mutators=[line for line in mutators if "rtk env -u DOCKER_HOST DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ colima " not in line]; assert mutators and not bad_mutators,bad_mutators; table=text.split("## Required tools, locations and opaque inputs",1)[1].split("If any opaque input is missing",1)[0]; defined=set(re.findall(r"__[A-Z0-9_]+__",table)); used=set(re.findall(r"__[A-Z0-9_]+__",text.replace(table,"",1))); assert defined==used,(sorted(defined-used),sorted(used-defined)); print("plan-docker-config-contract: verified",len(docker_lines),len(sensitive),len(mutators),len(defined))' plans/001-release-critical-bugs-and-hundreds-concurrency.md
   ```

   Expected: the scan exits 0 and reports nonzero Docker/env-sensitive/Colima
   counts. Every direct Docker CLI occurrence is bound to the one validated
   config store; only context metadata calls omit a daemon context; every
   env-file-wrapped Docker-capable command rebinds both variables after the
   opaque load; Colima context creation/deletion uses the same store; and the
   placeholder definition/use sets are identical. Any listed exception or set
   difference is a STOP before the freeze ledger or real staging.

7. Verify no final release change is still being authored. The current overlay
   already contains the critical implementations. Do not start a refactor.

8. If review discovers a new P1/P2 functional defect, use this mandatory TDD
   loop before A:

   - add the smallest failing regression in the exact affected test file;
   - run it and capture failure for the intended reason, not an environment error;
   - implement the minimal terminal fix;
   - rerun the focused test and its subsystem suite;
   - update the relevant bug report/spec and literal manifest;
   - return to Phase 1 from the beginning.

   A source/test/spec change also invalidates the pinned 142-path core tree.
   The plan owner—not the execution agent—must reconstruct the intended tree,
   review the new diff, replace the fixed core-tree hash in this plan, and
   obtain fresh cold reviews of the whole frozen plan. Merely adding a path to
   the manifest or changing the expected hash until the command passes is
   forbidden.

   P3/style/architecture suggestions are recorded as deferred and do not expand
   this release.

## Phase 2 — Exact staging and clean candidate A

1. Stage only the literal manifest. This is the only staging command allowed:

   ```bash
   rtk git add --pathspec-from-file=plans/001-release-candidate-paths.txt
   rtk git status --short --untracked-files=all
   rtk git diff --cached --name-status
   rtk git diff --cached --check
   rtk git diff --cached --stat
   ```

   Expected: every manifest path is staged, no path outside it is staged,
   cached diff check exits 0, and the worktree has no unstaged/untracked
   remediation path. `git add .` is forbidden.

   The three runtime paths must still be cached deletions, never contents:

   ```bash
   rtk git diff --cached --name-status -- frontend/.runtime/dev-server.log frontend/.runtime/dev-server.pid frontend/.runtime/start-dev.sh
   ```

   Expected: exactly three `D` records. Any other status is a STOP.

2. Run the Trellis task validator before freezing A:

   ```bash
   rtk env -u PYTHONOPTIMIZE python3 ./.trellis/scripts/task.py validate 07-22-audit-remediation-delivery-ui
   ```

   Expected: exit 0. If validation requires a task metadata edit, make it now,
   restage the exact file, and restart Phase 2. No task/doc edit is allowed after
   formal capacity.

3. Freeze the base immediately before A:

   ```bash
   rtk git fetch origin main
   rtk git rev-parse origin/main
   rtk git merge-base --is-ancestor origin/main HEAD
   ```

   Record the 40-character output as `__BASE_MAIN__`. Expected: ancestry exits
   0. If not, stop and create a new candidate on the latest main before any long
   test.

4. Commit the exact overlay:

   ```bash
   rtk git commit -m 'fix(audit): close critical remediation release'
   rtk git rev-parse HEAD
   rtk git rev-parse HEAD^{tree}
   rtk git rev-parse --short=12 HEAD
   rtk git status --porcelain=v1 --untracked-files=all
   rtk env -u PYTHONOPTIMIZE python3 scripts/production_image_transfer.py --check-source-only --source-revision "$(rtk git rev-parse HEAD)"
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,subprocess,sys; p=json.load(open(sys.argv[1])); actual=subprocess.check_output(["git","rev-parse","HEAD^{tree}"],text=True).strip(); assert actual==p["candidateTree"]; print("committed-candidate-tree: verified",actual)' '__PLAN_FREEZE_LEDGER__'
   ```

   Record the first two 40-character values as `__A__` and `__TREE_A__`, and the
   12-character value as `__A_SHORT__`.
   Expected: status is empty; source-only exits 0 with no error. This command is
   allowed to use command substitution because it does not expose a secret.

5. Recheck the base immediately after A:

   ```bash
   rtk git fetch origin main
   rtk git rev-parse origin/main
   rtk git merge-base --is-ancestor origin/main "$(rtk git rev-parse HEAD)"
   ```

   Expected: the printed value still equals `__BASE_MAIN__` and ancestry exits
   0. If either fails, stop and create a new candidate on the latest base before
   any long test.

## Phase 3 — One complete automated gate on clean A

Use the opaque local gate env only through `uv --env-file`:

```bash
rtk uv run --project backend --no-sync --env-file /tmp/smallkhoj-audit-local-prod.env rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__LOCAL_BUILD_DOCKER_CONTEXT__ make ci
rtk env -u PYTHONOPTIMIZE python3 ./.trellis/scripts/task.py validate 07-22-audit-remediation-delivery-ui
rtk git status --porcelain=v1 --untracked-files=all
rtk env -u PYTHONOPTIMIZE python3 scripts/production_image_transfer.py --check-source-only --source-revision "$(rtk git rev-parse HEAD)"
```

Expected high-level result:

```text
scripts: 170 collected; 169 pass with one documented conditional skip
TWD exact-tab guard: all 19 tests pass through canonical scripts-test
backend/migrations/PostgreSQL: all pass (latest backend baseline 513)
Ruff: all checks passed
frontend locked install/tests/lint/app+E2E typecheck/production build: all pass
standalone server: frontend/.next/standalone/server.js exists
Compose and git diff checks: pass
Trellis validation: pass
Git status: empty
source-only: exit 0
```

If `/tmp/smallkhoj-audit-local-prod.env` lacks a required gate-only variable,
stop and request a repo-external gate env path from the operator. Do not inspect
or patch the opaque file, and never redirect tests to a shared or cloud DB.

Do not install `actionlint` or `gitleaks` ad hoc in this release worktree. Record
them as unavailable. Their absence does not waive the later GitHub CI gate.

## Phase 4 — Build A images and create an isolated target-shaped runner

Formal capacity must not use the current default `6 CPU / 12 GiB / aarch64`
Docker VM. Build amd64 images on the existing builder, then load and run them in
a new A-scoped x86_64 capacity profile. Set `__CAPACITY_PROFILE__` in the
repo-external ledger to `smallkhoj-audit-capacity-__A_SHORT__`. The profile must
not already exist; a failed/retried profile is inspected and explicitly deleted
before a new attempt, never silently resumed.

1. Build the A daemon and three `linux/amd64` images. The frontend command loads
   its public key from the opaque env and transports it only as a BuildKit
   secret. Re-read local context metadata immediately before the build and
   require the exact Phase-0 Unix endpoint; metadata drift stops before any
   daemon call:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__A__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ context inspect __LOCAL_BUILD_DOCKER_CONTEXT__ --format '{{.Endpoints.docker.Host}}' > '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__A__.txt'
   rtk cmp '__EVIDENCE_DIR__/local-build-docker-endpoint.txt' '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__A__.txt'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import os,stat,sys; endpoint=open(sys.argv[1]).read().strip(); assert endpoint.startswith("unix://") and "\n" not in endpoint; path=endpoint.removeprefix("unix://"); assert os.path.isabs(path) and stat.S_ISSOCK(os.stat(path).st_mode); print("local-build-docker-endpoint-before-a: verified",os.path.realpath(path))' '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__A__.txt'
   rtk shasum -a 256 '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__A__.txt'
   rtk env -u PYTHONOPTIMIZE python3 scripts/build_daemon_distribution.py --root . --output-dir release-artifacts/smallkhoj-daemon --source-revision "$(rtk git rev-parse HEAD)" --clean-output-dir --json
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ build --platform linux/amd64 --label org.opencontainers.image.revision="$(rtk git rev-parse HEAD)" -f backend/Dockerfile -t smallkhoj-backend:audit-clean-a .
   rtk uv run --project backend --no-sync --env-file /tmp/smallkhoj-audit-local-prod.env rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__LOCAL_BUILD_DOCKER_CONTEXT__ docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ build --no-cache --platform linux/amd64 --label org.opencontainers.image.revision="$(rtk git rev-parse HEAD)" --build-arg NEXT_PUBLIC_API_BASE_URL= --build-arg NEXT_PUBLIC_WS_BASE_URL= --build-arg NEXT_PUBLIC_DEPLOYMENT_ENV=production --secret id=public_api_key,env=PUBLIC_API_KEY -t smallkhoj-frontend:audit-clean-a ./frontend
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ build --platform linux/amd64 --label org.opencontainers.image.revision="$(rtk git rev-parse HEAD)" -t smallkhoj-caddy:audit-clean-a ./deploy/caddy
   ```

   Expected: all builds exit 0. If the amd64 frontend build fails under QEMU,
   stop and move the build/formal run to an operator-approved x86_64 runner. Do
   not fall back to an ARM formal claim.

2. Inspect and save A images outside the repo:

   ```bash
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' smallkhoj-backend:audit-clean-a smallkhoj-frontend:audit-clean-a smallkhoj-caddy:audit-clean-a
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ save -o /tmp/smallkhoj-audit-clean-a-amd64.tar smallkhoj-backend:audit-clean-a smallkhoj-frontend:audit-clean-a smallkhoj-caddy:audit-clean-a
   rtk git status --porcelain=v1 --untracked-files=all
   ```

   Expected: three distinct IDs, every platform `linux/amd64`, every revision
   exactly A, archive outside Git, and status empty.

3. Free the host loopback ports only if the old default-context runtime is the
   already known task-owned stack. Absence is safe; this housekeeping is not
   evidence that the later capacity context is fresh:

   ```bash
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ ps -a --filter name=smallkhoj-audit-capacity-db-forward --filter name=smallkhoj-audit-capacity-api-forward --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}} {{.Label "com.docker.compose.project"}}'
   rtk zsh -c 'set -euo pipefail; for service in db backend frontend caddy feishu-worker; do ids=$(rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ compose --env-file /tmp/smallkhoj-audit-local-prod.env -p smallkhoj-audit-capacity-final -f docker-compose.prod.yml ps -aq "$service"); for id in ${(f)ids}; do rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ inspect --format "service=$service container={{.Id}} image={{.Image}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}} project={{index .Config.Labels \"com.docker.compose.project\"}}" "$id"; done; done'
   ```

   If no named forward and no Compose container exists, skip removal. If they
   exist, inspect each present forward and require its only application network
   to be `smallkhoj-audit-capacity-final_default`; Compose must list only the
   known project. Unknown objects or labels are a STOP. Remove only objects
   proved present and owned, then verify ports `38181`, `38182` and `55436` are
   free:

   ```bash
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ inspect --format '{{.Name}} {{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}{{json .NetworkSettings.Ports}}' smallkhoj-audit-capacity-db-forward smallkhoj-audit-capacity-api-forward
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ rm -f smallkhoj-audit-capacity-db-forward smallkhoj-audit-capacity-api-forward
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ compose --env-file /tmp/smallkhoj-audit-local-prod.env -p smallkhoj-audit-capacity-final -f docker-compose.prod.yml down -v --remove-orphans
   rtk zsh -c 'set -euo pipefail; for port in 38181 38182 55436; do rc=0; out=$(rtk lsof -nP -iTCP:$port -sTCP:LISTEN 2>&1) || rc=$?; if [[ $rc -eq 1 && -z "$out" ]]; then continue; fi; if [[ $rc -ne 0 ]]; then rtk printf "%s\n" "$out" >&2; exit $rc; fi; if [[ -n "$out" ]]; then rtk printf "listener-on-local-gate-port=%s\n%s\n" "$port" "$out" >&2; exit 1; fi; done; rtk printf "local-gate-ports-free=38181,38182,55436\n"'
   ```

   The `docker inspect`/`docker rm` lines are run only when both named forwards
   were listed. If one is absent, inspect/remove only the one present. The three
   `lsof` commands must print nothing; an unknown listener is a STOP.

4. Prove the A-scoped profile is new, start it without global activation, and
   derive the actual Docker context by matching the Colima `docker_socket` to
   the context `DockerEndpoint`:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/colima-list-before-__A__.jsonl' ]]"
   rtk colima list --json > '__EVIDENCE_DIR__/colima-list-before-__A__.jsonl'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; rows=[json.loads(line) for line in open(sys.argv[1]) if line.strip()]; assert all(row.get("name")!=sys.argv[2] for row in rows); print("capacity-profile-absent: verified",sys.argv[2])' '__EVIDENCE_DIR__/colima-list-before-__A__.jsonl' __CAPACITY_PROFILE__
   rtk env -u DOCKER_HOST DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ colima start --profile __CAPACITY_PROFILE__ --activate=false --vm-type qemu --arch x86_64 --cpu 4 --memory 3 --disk 30 --runtime docker
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-colima-__A__.json' ]]"
   rtk colima status --profile __CAPACITY_PROFILE__ --json > '__EVIDENCE_DIR__/capacity-colima-__A__.json'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/capacity-colima-__A__.json' ]]"
   rtk cat '__EVIDENCE_DIR__/capacity-colima-__A__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/docker-contexts-__A__.jsonl' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ context ls --format '{{json .}}' > '__EVIDENCE_DIR__/docker-contexts-__A__.jsonl'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/docker-contexts-__A__.jsonl' ]]"
   rtk cat '__EVIDENCE_DIR__/docker-contexts-__A__.jsonl'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-docker-context-__A__.txt' ]]"
   rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; status=json.load(open(sys.argv[1])); assert status["arch"]=="x86_64" and status["runtime"]=="docker" and status["cpu"]==4 and 0<int(status["memory"])<=3564584960; socket=status.get("docker_socket"); assert isinstance(socket,str) and socket.startswith("unix://"); rows=[json.loads(line) for line in open(sys.argv[2]) if line.strip()]; matches=[row["Name"] for row in rows if row.get("DockerEndpoint")==socket and not row.get("Error")]; assert len(matches)==1, matches; print(matches[0])' '__EVIDENCE_DIR__/capacity-colima-__A__.json' '__EVIDENCE_DIR__/docker-contexts-__A__.jsonl' > '__EVIDENCE_DIR__/capacity-docker-context-__A__.txt'
   rtk cat '__EVIDENCE_DIR__/capacity-docker-context-__A__.txt'
   rtk zsh -c 'set -euo pipefail; [[ "$(<"__EVIDENCE_DIR__/capacity-docker-context-__A__.txt")" == "__CAPACITY_DOCKER_CONTEXT__" ]]'
   ```

   Expected: the absence assertion exits 0; Colima reports `cpu=4`, x86_64 and
   at most `3,564,584,960` bytes. Record the unique matching context name as
   `__CAPACITY_DOCKER_CONTEXT__`; do not infer it from the profile spelling.
   Then prove the daemon shape and that the new daemon has no containers,
   volumes or non-built-in networks:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-docker-info-before-__A__.json' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ info --format '{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}},"architecture":{{json .Architecture}},"os":{{json .OSType}}}' > '__EVIDENCE_DIR__/capacity-docker-info-before-__A__.json'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/capacity-docker-info-before-__A__.json' ]]"
   rtk cat '__EVIDENCE_DIR__/capacity-docker-info-before-__A__.json'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); assert p=={"cpus":4,"memoryBytes":p["memoryBytes"],"architecture":"x86_64","os":"linux"}; assert isinstance(p["memoryBytes"],int) and 0<p["memoryBytes"]<=3564584960; print("capacity-docker-shape: verified",p)' '__EVIDENCE_DIR__/capacity-docker-info-before-__A__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-containers-before-__A__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ ps -aq > '__EVIDENCE_DIR__/capacity-containers-before-__A__.txt'
   rtk zsh -c "[[ ! -s '__EVIDENCE_DIR__/capacity-containers-before-__A__.txt' ]]"
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-volumes-before-__A__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ volume ls -q > '__EVIDENCE_DIR__/capacity-volumes-before-__A__.txt'
   rtk zsh -c "[[ ! -s '__EVIDENCE_DIR__/capacity-volumes-before-__A__.txt' ]]"
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-networks-before-__A__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ network ls --format '{{.Name}} {{.Driver}} {{.Scope}}' > '__EVIDENCE_DIR__/capacity-networks-before-__A__.txt'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; rows=[line.split() for line in open(sys.argv[1]) if line.strip()]; assert len(rows)==3 and {row[0] for row in rows}=={"bridge","host","none"} and all(len(row)==3 for row in rows); print("capacity-built-in-networks: verified")' '__EVIDENCE_DIR__/capacity-networks-before-__A__.txt'
   rtk shasum -a 256 '__EVIDENCE_DIR__/colima-list-before-__A__.jsonl' '__EVIDENCE_DIR__/capacity-colima-__A__.json' '__EVIDENCE_DIR__/docker-contexts-__A__.jsonl' '__EVIDENCE_DIR__/capacity-docker-context-__A__.txt' '__EVIDENCE_DIR__/capacity-docker-info-before-__A__.json' '__EVIDENCE_DIR__/capacity-containers-before-__A__.txt' '__EVIDENCE_DIR__/capacity-volumes-before-__A__.txt' '__EVIDENCE_DIR__/capacity-networks-before-__A__.txt'
   ```

   Expected: Docker reports exactly four CPUs, `linux/x86_64`, memory at most
   target; container and volume output is empty; networks are only `bridge`,
   `host` and `none`. Any other object means the supposedly new profile is not
   fresh: stop, verify task ownership, delete that profile, and restart Phase 4.
   Never weaken the rule or use the default profile.

5. Load A images and start a fresh stack with the known local env:

   ```bash
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ load -i /tmp/smallkhoj-audit-clean-a-amd64.tar
   rtk env SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:audit-clean-a SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:audit-clean-a SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:audit-clean-a docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ compose --env-file /tmp/smallkhoj-audit-local-prod.env -p smallkhoj-audit-capacity-final -f docker-compose.prod.yml up -d db backend frontend caddy
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ run --detach --name smallkhoj-audit-capacity-db-forward --network smallkhoj-audit-capacity-final_default --publish 127.0.0.1:55436:5432 alpine/socat TCP-LISTEN:5432,fork,reuseaddr TCP:db:5432
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ run --detach --name smallkhoj-audit-capacity-api-forward --network smallkhoj-audit-capacity-final_default --publish 127.0.0.1:38182:8000 alpine/socat TCP-LISTEN:8000,fork,reuseaddr TCP:backend:8000
   ```

   The environment file is only a Compose input; these commands do not read it.
   Expected topology: one db/backend/frontend/Caddy, two named loopback forwards,
   no worker, fresh volumes, Caddy on the env-defined local port.

6. Apply conservative per-container memory ceilings totaling 2,544 MiB, below
   the formal application-container envelope `2,673,438,720` bytes. The VM
   itself already limits aggregate CPU to four cores:

   ```bash
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ update --memory 768m --memory-swap 768m smallkhoj-audit-capacity-final-db-1
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ update --memory 1024m --memory-swap 1024m smallkhoj-audit-capacity-final-backend-1
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ update --memory 640m --memory-swap 640m smallkhoj-audit-capacity-final-frontend-1
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ update --memory 112m --memory-swap 112m smallkhoj-audit-capacity-final-caddy-1
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-cgroups-before-__A__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} container={{.Id}} memory={{.HostConfig.Memory}} memorySwap={{.HostConfig.MemorySwap}} image={{.Image}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' smallkhoj-audit-capacity-final-db-1 smallkhoj-audit-capacity-final-backend-1 smallkhoj-audit-capacity-final-frontend-1 smallkhoj-audit-capacity-final-caddy-1 > '__EVIDENCE_DIR__/capacity-cgroups-before-__A__.txt'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/capacity-cgroups-before-__A__.txt' ]]"
   rtk cat '__EVIDENCE_DIR__/capacity-cgroups-before-__A__.txt'
   rtk shasum -a 256 '__EVIDENCE_DIR__/capacity-cgroups-before-__A__.txt'
   ```

   Expected memory bytes: db `805306368`, backend `1073741824`, frontend
   `671088640`, Caddy `117440512`; memory-swap equals memory for each. App-image
   revisions equal A; all four are running with zero restart/OOM. The saved
   file and hash are part of the manual target-runner gate.

7. Smoke the fresh stack:

   ```bash
   rtk env -u PYTHONOPTIMIZE python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:38181 --allow-http --json --strict-warnings
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} container={{.Id}} image={{.Image}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' smallkhoj-audit-capacity-final-db-1 smallkhoj-audit-capacity-final-backend-1 smallkhoj-audit-capacity-final-frontend-1 smallkhoj-audit-capacity-final-caddy-1
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} {{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}{{json .NetworkSettings.Ports}}' smallkhoj-audit-capacity-db-forward smallkhoj-audit-capacity-api-forward
   ```

   Expected: zero failures/warnings; all four core services running; no worker.

## Phase 5 — Minimal clean-A authenticated integration and `./twd`

1. Prove the opaque E2E env points to the exact loopback endpoints owned by the
   capacity context without printing any URL credential. The E2E target does
   not start Docker; endpoint validation and Docker ownership are both required:

   ```bash
   rtk uv run --project backend --no-sync --env-file /tmp/smallkhoj-audit-local-prod.env rtk env -u PYTHONOPTIMIZE python3 -c 'import os; from urllib.parse import urlsplit; loop={"127.0.0.1","localhost"}; expected={"FRONTEND_BASE":38181,"BETTER_AUTH_URL":38181,"API_BASE":38182,"INTERNAL_API_BASE_URL":38182}; parsed={name:urlsplit(os.environ[name]) for name in expected}; assert all(item.scheme=="http" and item.hostname in loop and item.port==expected[name] for name,item in parsed.items()); db1=urlsplit(os.environ["DATABASE_URL"]); db2=urlsplit(os.environ["BETTER_AUTH_DATABASE_URL"]); assert db1.hostname in loop and db2.hostname in loop and db1.port==db2.port==55436 and db1.path==db2.path and db1.path not in {"","/"}; print("capacity-e2e-endpoints: verified")'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-endpoints-before-e2e-__A__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} {{range $name, $network := .NetworkSettings.Networks}}{{$name}} {{end}}{{json .NetworkSettings.Ports}}' smallkhoj-audit-capacity-db-forward smallkhoj-audit-capacity-api-forward > '__EVIDENCE_DIR__/capacity-endpoints-before-e2e-__A__.txt'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/capacity-endpoints-before-e2e-__A__.txt' ]]"
   rtk cat '__EVIDENCE_DIR__/capacity-endpoints-before-e2e-__A__.txt'
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} container={{.Id}} image={{.Image}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' smallkhoj-audit-capacity-final-db-1 smallkhoj-audit-capacity-final-backend-1 smallkhoj-audit-capacity-final-frontend-1 smallkhoj-audit-capacity-final-caddy-1
   rtk uv run --project backend --no-sync --env-file /tmp/smallkhoj-audit-local-prod.env rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__CAPACITY_DOCKER_CONTEXT__ make e2e-authenticated
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} container={{.Id}} image={{.Image}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' smallkhoj-audit-capacity-final-db-1 smallkhoj-audit-capacity-final-backend-1 smallkhoj-audit-capacity-final-frontend-1 smallkhoj-audit-capacity-final-caddy-1
   rtk shasum -a 256 '__EVIDENCE_DIR__/capacity-endpoints-before-e2e-__A__.txt'
   ```

   Expected: `1 passed`; signup creates a real Better Auth session and active
   Server on the disposable DB at `55436`; endpoint assertion exits 0; forward
   ports belong to the exact capacity network; the same A containers remain
   running with zero restart/OOM. Validator failure before Playwright is a STOP,
   not permission to bypass `bun run e2e` safety. `DOCKER_CONTEXT` alone would
   not bind this E2E because the target does not invoke Docker.

2. Create one dedicated loopback browser tab through the project wrapper. The
   operator supplies `__TWD_TRANSPORT_TAB_ID__` for a blank, approved connected
   transport tab; do not run a tab-listing command because it can expose URL or
   title metadata for an already-open old-cloud tab. Do not navigate or read
   the transport page. Record the newly created `result.data.id` as
   `__TWD_TAB_ID__`:

   ```bash
   rtk ./twd --compact ext --tab __TWD_TRANSPORT_TAB_ID__ '{"cmd":"tabs","method":"create","url":"http://127.0.0.1:38181/login","active":true}'
   rtk uv run --project backend --no-sync --env-file /tmp/smallkhoj-audit-local-prod.env rtk ./tools/twd-guard/twd-open --tab __TWD_TAB_ID__ /tasks
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'return {origin: location.origin, path: location.pathname, readyState: document.readyState, serverSwitcher: !!document.querySelector("[data-region=server-switcher]")}'
   ```

   Expected: the guard's tested exact-tab path never calls tab discovery or
   `--url-match`; cookie injection, navigation, login retry and final probe all
   use only `--tab __TWD_TAB_ID__`. Its returned `tabId` exactly equals
   `__TWD_TAB_ID__`, origin is `http://127.0.0.1:38181`, final path is `/tasks`,
   and the Server switcher exists. Any ID/origin mismatch is a STOP without
   operating either tab. Every remaining command uses exact `--tab`; never use
   Playwright for this UI acceptance and never call `twd.py` directly.

3. Install a fresh-tab fetch-SSE counter before reload, reload the exact tab,
   and assert the initial physical stream. The wrapper observes only requests
   whose path is `/api/v1/events/stream`. It returns the original `Response` and
   delegates the real reader operations unchanged, while observing reader
   creation, EOF, cancellation, release and read failure so a dead 200 stream
   cannot remain counted as active:

   ```bash
   rtk ./twd --compact cdp --tab __TWD_TAB_ID__ Page.addScriptToEvaluateOnNewDocument '{"source":"(()=>{const rawFetch=window.fetch.bind(window);const tracked=new WeakMap();const rawGetReader=ReadableStream.prototype.getReader;const probe={sseStarts:0,sseReaders:0,sseAborts:0,sseEofs:0,sseCancels:0,sseReleases:0,sseReadErrors:0,sseActive:0,sseResponses:0,sseStatuses:[],sseErrors:0,sseMaxActive:0};ReadableStream.prototype.getReader=function(...args){const reader=rawGetReader.apply(this,args);const close=tracked.get(this);if(!close)return reader;probe.sseReaders+=1;const rawRead=reader.read.bind(reader);const rawCancel=reader.cancel.bind(reader);const rawRelease=reader.releaseLock.bind(reader);reader.read=async(...readArgs)=>{try{const part=await rawRead(...readArgs);if(part.done)close(\"eof\");return part;}catch(error){close(\"read-error\");throw error;}};reader.cancel=async(reason)=>{close(\"cancel\");return rawCancel(reason);};reader.releaseLock=()=>{close(\"release\");return rawRelease();};return reader;};Object.defineProperty(window,\"__smallKhojSseProbe\",{value:probe});window.fetch=async function(input,init){const rawUrl=typeof input===\"string\"?input:(input instanceof URL?input.href:input.url);const isSse=new URL(rawUrl,location.href).pathname===\"/api/v1/events/stream\";if(!isSse)return rawFetch(input,init);probe.sseStarts+=1;probe.sseActive+=1;probe.sseMaxActive=Math.max(probe.sseMaxActive,probe.sseActive);let closed=false;const close=(kind)=>{if(closed)return;closed=true;probe.sseActive-=1;if(kind===\"abort\")probe.sseAborts+=1;else if(kind===\"eof\")probe.sseEofs+=1;else if(kind===\"cancel\")probe.sseCancels+=1;else if(kind===\"release\")probe.sseReleases+=1;else{probe.sseErrors+=1;if(kind===\"read-error\")probe.sseReadErrors+=1;}};const signal=init?.signal??(input instanceof Request?input.signal:undefined);signal?.addEventListener(\"abort\",()=>close(\"abort\"),{once:true});try{const response=await rawFetch(input,init);probe.sseResponses+=1;probe.sseStatuses.push(response.status);if(!response.ok)close(\"http-error\");else if(!response.body)close(\"read-error\");else tracked.set(response.body,close);return response;}catch(error){close(\"fetch-error\");throw error;}};})()"}'
   rtk ./twd --compact cdp --tab __TWD_TAB_ID__ Page.reload '{"ignoreCache":true}'
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'return await new Promise((resolve,reject)=>setTimeout(()=>{const p=window.__smallKhojSseProbe;const ok=location.origin==="http://127.0.0.1:38181"&&location.pathname==="/tasks"&&p&&p.sseStarts===1&&p.sseReaders===1&&p.sseAborts===0&&p.sseEofs===0&&p.sseCancels===0&&p.sseReleases===0&&p.sseReadErrors===0&&p.sseActive===1&&p.sseResponses===1&&p.sseStatuses.length===1&&p.sseStatuses[0]===200&&p.sseErrors===0&&p.sseMaxActive===1;if(!ok)return reject(new Error("initial SSE invariant failed: "+JSON.stringify(p)));resolve({...p,path:location.pathname});},5000))'
   ```

   Any missing probe, non-200 response, error, overlap, reconnect or count other
   than one is a STOP. This is the fresh clean-A one-physical-SSE assertion; old
   evidence is contextual support, not its substitute.

4. Create and visibly delete one marker Task through the real UI. Generate and
   record the exact output as `__UI_MARKER__`, then use the current page
   language's labels and the exact tab. First install a narrow fetch observer
   that records only the real Task DELETE response without consuming the
   response returned to the application:

   ```bash
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'if(window.__smallKhojDeleteProbe)throw new Error("delete probe already installed");const previous=window.fetch.bind(window);const probe={calls:[],errors:[]};Object.defineProperty(window,"__smallKhojDeleteProbe",{value:probe});window.fetch=async function(input,init){const url=new URL(typeof input==="string"?input:(input instanceof URL?input.href:input.url),location.href);const method=(init?.method??(input instanceof Request?input.method:"GET")).toUpperCase();const response=await previous(input,init);if(method==="DELETE"&&url.pathname.startsWith("/api/v1/tasks/")){let body=null;try{body=await response.clone().json();}catch(error){probe.errors.push(String(error));}probe.calls.push({method,path:url.pathname,status:response.status,ok:response.ok,body});}return response;};return {installed:true}'
   rtk date -u '+REAL_audit_clean_A-__A_SHORT__-%Y%m%dT%H%M%SZ'
   rtk ./twd click --tab __TWD_TAB_ID__ button --contains '创建任务'
   rtk ./twd input --tab __TWD_TAB_ID__ '#task-title' '__UI_MARKER__'
   rtk ./twd click --tab __TWD_TAB_ID__ 'button[type=submit]' --contains '创建'
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'return await new Promise((resolve,reject)=>{const deadline=Date.now()+15000;const poll=()=>{const link=[...document.querySelectorAll("[data-slot=task-board-root] a[href^=\"/tasks?\"]")].find((node)=>node.textContent?.includes("__UI_MARKER__"));const alerts=[...document.querySelectorAll("[role=alert]")].map((node)=>node.textContent);if(alerts.length)return reject(new Error(alerts.join(" | ")));if(link)return resolve({markerLinkPresent:true});if(Date.now()>deadline)return reject(new Error("marker Task did not appear"));setTimeout(poll,100);};poll();})'
   rtk ./twd click --tab __TWD_TAB_ID__ a --contains '__UI_MARKER__'
   rtk ./twd click --tab __TWD_TAB_ID__ button --contains '删除任务'
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'const target=document.querySelector("[data-slot=destructive-action-target]")?.textContent;const dialog=document.querySelector("[role=dialog]")?.innerText;if(!target?.includes("__UI_MARKER__"))throw new Error("delete confirmation target mismatch: "+JSON.stringify({target,dialog}));return {target,dialog,markerMatched:true}'
   rtk ./twd click --tab __TWD_TAB_ID__ '[role=dialog] button' --contains '删除'
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'return await new Promise((resolve,reject)=>{const deadline=Date.now()+16000;const poll=()=>{const board=document.querySelector("[data-slot=task-board-root]");const alerts=[...document.querySelectorAll("[role=alert]")].map((node)=>node.textContent);const probe=window.__smallKhojDeleteProbe;if(alerts.length)return reject(new Error(alerts.join(" | ")));if(!board)return reject(new Error("task board root disappeared after delete"));if(location.origin!=="http://127.0.0.1:38181"||location.pathname!=="/tasks")return reject(new Error("unexpected route after delete: "+location.href));if(!probe||probe.errors.length||probe.calls.length>1)return reject(new Error("invalid delete probe: "+JSON.stringify(probe)));const taskLinkPresent=[...board.querySelectorAll("a[href^=\"/tasks?\"]")].some((node)=>node.textContent?.includes("__UI_MARKER__"));const call=probe.calls[0];const responsePassed=call&&call.method==="DELETE"&&call.status===200&&call.ok===true&&call.body?.deleted===true&&typeof call.body?.taskId==="string"&&call.body.taskId.length>0&&Number.isInteger(call.body?.taskNumber);if(!taskLinkPresent&&responsePassed)return resolve({taskLinkPresent,boardRootPresent:true,path:location.pathname,deleteResponse:call,alerts});if(Date.now()>deadline)return reject(new Error("delete terminal invariant failed: "+JSON.stringify({taskLinkPresent,probe})));setTimeout(poll,100);};poll();})'
   ```

   If the UI is English, use `Create Task`, `Create`, `Delete task`, and
   `Delete`; selectors remain the same. Expected: confirmation target contains
   the exact unique marker; exactly one Task DELETE returns HTTP 200 with the
   validated `{deleted:true, taskId, taskNumber}` body, the exact Task link is
   absent, the task-board root is still mounted on the expected local `/tasks`
   route, and no error alert exists. The response/root/route assertions
   distinguish a real successful terminal state from a component crash or
   unrelated navigation. Do not inspect the whole body for the marker because
   the confirmation surface may retain the target name while it closes.

5. Assert the physical SSE invariant again after the route/create/delete flow,
   save exact-tab evidence, and recheck the A containers. Do not paste cookie
   values:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/one-sse-__A__.json' ]]"
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'return await new Promise((resolve,reject)=>setTimeout(()=>{const p=window.__smallKhojSseProbe;const alerts=[...document.querySelectorAll("[role=alert]")].map((node)=>node.textContent);const ok=location.origin==="http://127.0.0.1:38181"&&p&&p.sseStarts===1&&p.sseReaders===1&&p.sseAborts===0&&p.sseEofs===0&&p.sseCancels===0&&p.sseReleases===0&&p.sseReadErrors===0&&p.sseActive===1&&p.sseResponses===1&&p.sseStatuses.length===1&&p.sseStatuses[0]===200&&p.sseErrors===0&&p.sseMaxActive===1&&alerts.length===0;if(!ok)return reject(new Error("final SSE invariant failed: "+JSON.stringify({p,alerts})));resolve({...p,path:location.pathname,alerts});},3000))' > '__EVIDENCE_DIR__/one-sse-__A__.json'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/one-sse-__A__.json' ]]"
   rtk cat '__EVIDENCE_DIR__/one-sse-__A__.json'
   rtk ./twd snapshot --tab __TWD_TAB_ID__ --out '__EVIDENCE_DIR__/tasks-after-delete-__A__.snapshot.txt'
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} container={{.Id}} image={{.Image}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' smallkhoj-audit-capacity-final-db-1 smallkhoj-audit-capacity-final-backend-1 smallkhoj-audit-capacity-final-frontend-1 smallkhoj-audit-capacity-final-caddy-1
   rtk shasum -a 256 '__EVIDENCE_DIR__/one-sse-__A__.json' '__EVIDENCE_DIR__/tasks-after-delete-__A__.snapshot.txt'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/twd-sse-close-start-__A__.txt' ]]"
   rtk date -u '+%Y-%m-%dT%H:%M:%SZ' > '__EVIDENCE_DIR__/twd-sse-close-start-__A__.txt'
   rtk ./twd --compact cdp --tab __TWD_TAB_ID__ Page.navigate '{"url":"about:blank"}'
   rtk ./twd --compact eval --tab __TWD_TAB_ID__ 'if(location.href!=="about:blank")throw new Error("dedicated tab did not leave local app");return {href:location.href}'
   rtk sleep 3
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/backend-sse-after-twd-close-__A__.log' ]]"
   rtk zsh -c 'set -euo pipefail; since=$(<"__EVIDENCE_DIR__/twd-sse-close-start-__A__.txt"); rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ logs --since "$since" --timestamps smallkhoj-audit-capacity-final-backend-1 > "__EVIDENCE_DIR__/backend-sse-after-twd-close-__A__.log" 2>&1'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; lines=[line for line in open(sys.argv[1]) if "public event stream subscriber " in line]; assert lines and "disconnected count=0" in lines[-1], lines[-5:]; print("twd-sse-closed: verified",lines[-1].strip())' '__EVIDENCE_DIR__/backend-sse-after-twd-close-__A__.log'
   rtk chmod 400 '__EVIDENCE_DIR__/twd-sse-close-start-__A__.txt' '__EVIDENCE_DIR__/backend-sse-after-twd-close-__A__.log'
   rtk shasum -a 256 '__EVIDENCE_DIR__/twd-sse-close-start-__A__.txt' '__EVIDENCE_DIR__/backend-sse-after-twd-close-__A__.log'
   ```

   Expected: exactly one start, one real body reader and one still-active stream;
   zero abort/EOF/cancel/release/read errors, max active=1, the one response is
   200, zero errors/alerts, exact A container identities and zero restart/OOM. The
   bare `smallkhoj-trace summary` is deliberately not used: its defaults point
   to another local runtime and this four-service topology has no daemon. The
   dedicated tab must then navigate to `about:blank`; the last backend
   subscriber lifecycle record since that exact boundary must be
   `disconnected count=0`. This prevents the UI proof's one long-lived stream
   from contaminating formal capacity as an uncounted 301st/501st connection.

   Do not repeat the file-quarantine fault injection unless the reviewer
   specifically requests it: the same code path already has real-UI before/after
   evidence, API/DB evidence, and current automated component/integration
   regressions. If repeated, it remains in this disposable local stack and must
   show a localized `role=alert`; never inject storage faults into cloud.

6. Any UI/API/runtime defect requires a new commit A2, full Phase 3 rebuild,
   fresh UI and later full formal capacity. Do not continue on stale images.

## Phase 6 — Independent P1/P2 disposition before the long gate

Ask an independent reviewer who did not implement this overlay to read the
complete `__BASE_MAIN__...__A__` diff, this plan, the audit report, and the
latest automated/UI evidence plus hashes. The request names `__BASE_MAIN__`, A,
TREE_A and all evidence paths/hashes. The reviewer must return one of:

```text
APPROVED — zero open P1/P2
REVISE — list each P1/P2 with exact file/evidence
```

P3 and excluded architecture directions do not block. Any P1/P2 triggers the
TDD loop, a new A, and repetition from Phase 2. Formal capacity starts only
after `APPROVED`.

Persist the verdict as
`__EVIDENCE_DIR__/independent-review-__A__.json` with reviewer identity,
timestamp, exact base/A/TREE_A, `verdict`, evidence hashes and any findings.
The reviewer must inspect every startup migration, seed and backfill for forward
deployment safety. This release deliberately does not pre-authorize automatic
old-image rollback: any failed production rollout freezes application writers,
keeps PostgreSQL and the release lock in place, and requires a separate
maintainer-approved incident-recovery plan. Then bind the review to the current
candidate:

```bash
rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; from pathlib import Path; p=json.loads(Path(sys.argv[1]).read_text()); assert p["verdict"]=="APPROVED"; assert p["base"]==sys.argv[2] and p["candidate"]["head"]==sys.argv[3] and p["candidate"]["tree"]==sys.argv[4]; assert p.get("reviewer") and p.get("reviewedAt") and p.get("evidenceHashes"); assert p.get("openP1",[])==[] and p.get("openP2",[])==[]; assert p.get("reviewedStartupMigrationsAndBackfills") is True; assert p.get("automaticRollbackAuthorized") is False; print("independent-review: verified")' '__EVIDENCE_DIR__/independent-review-__A__.json' __BASE_MAIN__ __A__ __TREE_A__
rtk shasum -a 256 '__EVIDENCE_DIR__/independent-review-__A__.json'
```

An informal chat approval, the implementer's own review, or a verdict naming a
different candidate is not reusable evidence.

Then refetch main immediately before formal:

```bash
rtk git fetch origin main
rtk git rev-parse origin/main
rtk git merge-base --is-ancestor origin/main "$(rtk git rev-parse HEAD)"
rtk git status --porcelain=v1 --untracked-files=all
```

Expected: current `origin/main` still equals recorded `__BASE_MAIN__`, is an
ancestor of A, and status is empty. If base moved, stop and create/reverify a
new candidate; do not spend 30+ minutes on a tree that cannot squash to the
same root tree.

## Phase 7 — Formal `300/500/30` capacity as the final A-tree gate

1. Run the exact formal command. The env file is loaded only by `uv`; Docker
   subprocesses are pinned to the isolated x86_64 context. The output lives
   outside Git. Immediately before starting load, re-read subscriber lifecycle
   logs from the exact UI-close boundary and require the current global browser
   subscriber count to be zero:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/backend-sse-preformal-__A__.log' ]]"
   rtk zsh -c 'set -euo pipefail; since=$(<"__EVIDENCE_DIR__/twd-sse-close-start-__A__.txt"); rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ logs --since "$since" --timestamps smallkhoj-audit-capacity-final-backend-1 > "__EVIDENCE_DIR__/backend-sse-preformal-__A__.log" 2>&1'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; lines=[line for line in open(sys.argv[1]) if "public event stream subscriber " in line]; assert lines and "disconnected count=0" in lines[-1], lines[-5:]; print("preformal-external-sse-zero: verified",lines[-1].strip())' '__EVIDENCE_DIR__/backend-sse-preformal-__A__.log'
   rtk chmod 400 '__EVIDENCE_DIR__/backend-sse-preformal-__A__.log'
   rtk uv run --project backend --no-sync --env-file /tmp/smallkhoj-audit-local-prod.env rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__CAPACITY_DOCKER_CONTEXT__ python3 scripts/local_capacity_probe.py --profile formal-300-500-30-v1 --steady-sse 300 --spike-total-sse 500 --active-users 30 --active-cycle-seconds 5 --duration-seconds 1800 --ramp-seconds 60 --spike-at-seconds 590 --spike-ramp-seconds 10 --spike-duration-seconds 60 --cleanup-timeout-seconds 60 --connect-timeout-seconds 20 --request-timeout-seconds 20 --resource-sample-seconds 5 --fixture-concurrency 20 --sse-ready-p95-ms 2000 --read-p95-ms 500 --write-p95-ms 1000 --event-delivery-p95-ms 2000 --postgres-headroom 5 --output /tmp/smallkhoj-formal-capacity-v1.json
   ```

   Expected final stdout:

   ```text
   CAPACITY completed passed=True failures=none output=/tmp/smallkhoj-formal-capacity-v1.json
   ```

   Exit 1, 2 or 3 is always a STOP. Never rerun with weaker flags or change the
   profile to smoke.

2. Recompute the report and enforce the stricter cadence and literal 60-second
   observation rules:

   ```bash
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; from pathlib import Path; from scripts.local_capacity_probe import stored_capacity_report_failures; p=json.loads(Path(sys.argv[1]).read_text()); assert p["schemaVersion"]==5; assert p["config"]["profileId"]=="formal-300-500-30-v1"; assert p["acceptance"]=={"passed":True,"failures":[]}; assert stored_capacity_report_failures(p)==[]; assert p["containers"]["samplingOverruns"]==0; assert p["containers"]["maxSampleGapSeconds"]<=5.5; print("formal-capacity-report: verified")' /tmp/smallkhoj-formal-capacity-v1.json
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; from pathlib import Path; p=json.loads(Path(sys.argv[1]).read_text()); t=p["timeline"]; c=p["cleanup"]; cfg=p["config"]; peak=t["spikePeakEndedAtSeconds"]-t["spikePeakReadyAtSeconds"]; cleanup=t["cleanupEndedAtSeconds"]-t["cleanupStartedAtSeconds"]; assert cfg["spikeDurationSeconds"]==60 and t["spikePeakHoldSeconds"]>=60 and peak>=60 and abs(t["spikePeakHoldSeconds"]-peak)<=0.1; assert cfg["cleanupTimeoutSeconds"]==60 and c["observedSeconds"]>=60 and t["cleanupObservedSeconds"]>=60 and cleanup>=60; assert abs(c["observedSeconds"]-cleanup)<=0.1 and abs(t["cleanupObservedSeconds"]-cleanup)<=0.1 and abs(c["observedSeconds"]-t["cleanupObservedSeconds"])<=0.1; print("formal-capacity-duration-evidence: verified")' /tmp/smallkhoj-formal-capacity-v1.json
   rtk zsh -c 'set -euo pipefail; [[ ! -e "__EVIDENCE_DIR__/formal-capacity-__A__.json" && ! -e "__EVIDENCE_DIR__/formal-capacity-__A__.json.sha256" ]]'
   rtk install -m 400 /tmp/smallkhoj-formal-capacity-v1.json '__EVIDENCE_DIR__/formal-capacity-__A__.json'
   rtk zsh -c 'set -euo pipefail; cd "__EVIDENCE_DIR__"; rtk shasum -a 256 "formal-capacity-__A__.json" > "formal-capacity-__A__.json.sha256"; rtk chmod 400 "formal-capacity-__A__.json.sha256"'
   rtk zsh -c 'set -euo pipefail; cd "__EVIDENCE_DIR__"; rtk shasum -a 256 -c "formal-capacity-__A__.json.sha256"'
   rtk shasum -a 256 /tmp/smallkhoj-formal-capacity-v1.json '__EVIDENCE_DIR__/formal-capacity-__A__.json'
   rtk git status --porcelain=v1 --untracked-files=all
   rtk env -u PYTHONOPTIMIZE python3 scripts/production_image_transfer.py --check-source-only --source-revision "$(rtk git rev-parse HEAD)"
   ```

   Expected: both verifier messages; source/destination SHA-256 values are
   identical; the no-clobber assertion, empty Git status and source-only check
   all pass. This SHA-named immutable path is the only report path referenced by
   Phases 9–10; never use a generic `formal-capacity-A.json` or an older file.

3. The report must prove all of the following from raw evidence:

   ```text
   schemaVersion = 5
   candidate start = candidate finish = A/TREE_A/dirty=false
   backend/frontend/Caddy revisions = A
   300 steady ready, 500 peak ready, 30 active users
   at least 359 cycles per active user (>=10,770 reads/writes/scoped events)
   SSE ready p95 <=2,000 ms
   read p95 <=500 ms; write p95 <=1,000 ms; event p95 <=2,000 ms
   PostgreSQL max=100, peak<=95, cleanup<=baseline+2, deadlock delta=0
   exactly one listener in every raw sample; publishers<=2
   budget=48 and runtime env exactly 5/10/2/1/10/5
   zero Feishu worker containers
   four core container IDs/images stable, running, restart=0, OOM=false
   aggregate CPU <=320 percentage points per sample
   aggregate RAM <=2,673,438,720 bytes per sample
   samplingOverruns=0; maxSampleGapSeconds<=5.5
   client tasks=0 and ready streams=0 after >=60 seconds cleanup
   ```

4. Re-prove the runner shape and exact four containers after formal, then
   require byte-identical before/after identity/limit evidence:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-colima-after-__A__.json' ]]"
   rtk colima status --profile __CAPACITY_PROFILE__ --json > '__EVIDENCE_DIR__/capacity-colima-after-__A__.json'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/capacity-colima-after-__A__.json' ]]"
   rtk cat '__EVIDENCE_DIR__/capacity-colima-after-__A__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-docker-info-after-__A__.json' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ info --format '{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}},"architecture":{{json .Architecture}},"os":{{json .OSType}}}' > '__EVIDENCE_DIR__/capacity-docker-info-after-__A__.json'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/capacity-docker-info-after-__A__.json' ]]"
   rtk cat '__EVIDENCE_DIR__/capacity-docker-info-after-__A__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/capacity-cgroups-after-__A__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ inspect --format '{{.Name}} container={{.Id}} memory={{.HostConfig.Memory}} memorySwap={{.HostConfig.MemorySwap}} image={{.Image}} revision={{index .Config.Labels "org.opencontainers.image.revision"}} running={{.State.Running}} oom={{.State.OOMKilled}} restarts={{.RestartCount}}' smallkhoj-audit-capacity-final-db-1 smallkhoj-audit-capacity-final-backend-1 smallkhoj-audit-capacity-final-frontend-1 smallkhoj-audit-capacity-final-caddy-1 > '__EVIDENCE_DIR__/capacity-cgroups-after-__A__.txt'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/capacity-cgroups-after-__A__.txt' ]]"
   rtk cat '__EVIDENCE_DIR__/capacity-cgroups-after-__A__.txt'
   rtk cmp '__EVIDENCE_DIR__/capacity-docker-info-before-__A__.json' '__EVIDENCE_DIR__/capacity-docker-info-after-__A__.json'
   rtk cmp '__EVIDENCE_DIR__/capacity-cgroups-before-__A__.txt' '__EVIDENCE_DIR__/capacity-cgroups-after-__A__.txt'
   rtk shasum -a 256 '__EVIDENCE_DIR__/capacity-colima-after-__A__.json' '__EVIDENCE_DIR__/capacity-docker-info-after-__A__.json' '__EVIDENCE_DIR__/capacity-cgroups-after-__A__.txt' '__EVIDENCE_DIR__/formal-capacity-__A__.json' '__EVIDENCE_DIR__/formal-capacity-__A__.json.sha256'
   ```

   Expected: still x86_64/four CPUs/at most target memory; `cmp` exits 0, so
   container IDs, images, A revisions, limits, restart/OOM and Docker shape did
   not change. Record these hashes together in the repo-external release ledger.

5. Formal capacity is now frozen. Any repository edit or commit that changes
   the root tree, even one line of documentation, invalidates it. Equal-tree B
   is the only allowed later commit identity. Do not mark this plan DONE in Git.

6. After all hashes are durable, remove only the scoped local runtime and delete
   the A-scoped VM so no stale volume can survive a retry:

   ```bash
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ rm -f smallkhoj-audit-capacity-db-forward smallkhoj-audit-capacity-api-forward
   rtk env SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:audit-clean-a SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:audit-clean-a SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:audit-clean-a docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __CAPACITY_DOCKER_CONTEXT__ compose --env-file /tmp/smallkhoj-audit-local-prod.env -p smallkhoj-audit-capacity-final -f docker-compose.prod.yml down -v --remove-orphans
   rtk env -u DOCKER_HOST DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ colima delete --force --profile __CAPACITY_PROFILE__
   rtk colima list --json
   ```

   Expected: no profile named `__CAPACITY_PROFILE__` remains. Never stop or
   delete the default Colima profile or unknown containers.

## Phase 8 — PR, CI, squash merge and exact tree mapping

1. Confirm the base did not move after formal:

   ```bash
   rtk git fetch origin main
   rtk git rev-parse origin/main
   ```

   Expected: exact `__BASE_MAIN__`. If different, stop: update/rebase, create a
   new A, rerun the clean gate, rebuild and repeat formal capacity.

2. Push and create the PR:

   ```bash
   rtk git push --set-upstream origin feat/2026-07-audit-remediation
   rtk gh pr create --base main --head feat/2026-07-audit-remediation --fill
   ```

   Record the returned URL/number as `__PR__`.

3. Require every GitHub check to succeed:

   ```bash
   rtk gh pr checks __PR__ --watch --fail-fast
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/pr-checks-__A__.json' ]]"
   rtk gh pr checks __PR__ --json name,workflow,bucket > '__EVIDENCE_DIR__/pr-checks-__A__.json'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; from pathlib import Path; rows=json.loads(Path(sys.argv[1]).read_text()); required={"Source and delivery contracts","Backend, migrations, PostgreSQL and Ruff","Frontend locked install, tests, lint, types and production build","Authenticated disposable management integration"}; assert rows and all(row["bucket"]=="pass" for row in rows); present={row["name"] for row in rows if row["workflow"]=="CI"}; assert required<=present, f"missing canonical CI jobs: {sorted(required-present)}"; print("pr-checks: verified")' '__EVIDENCE_DIR__/pr-checks-__A__.json'
   rtk shasum -a 256 '__EVIDENCE_DIR__/pr-checks-__A__.json'
   ```

   Missing, cancelled, skipped or failed required jobs are not green. Any
   review-requested source change creates a new A and invalidates formal.

4. Immediately before merge, bind the PR base/head and the local ref again:

   ```bash
   rtk git fetch origin main
   rtk zsh -c 'set -euo pipefail; [[ "$(rtk git rev-parse origin/main)" == "__BASE_MAIN__" ]]'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/branch-protection-main-__A__.json' ]]"
   rtk gh api 'repos/{owner}/{repo}/branches/main/protection/required_status_checks' > '__EVIDENCE_DIR__/branch-protection-main-__A__.json'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); required={"Source and delivery contracts","Backend, migrations, PostgreSQL and Ruff","Frontend locked install, tests, lint, types and production build","Authenticated disposable management integration"}; configured=set(p.get("contexts") or [])|{row.get("context") for row in (p.get("checks") or [])}; assert p.get("strict") is True; assert None not in configured and required<=configured, f"canonical jobs not protected: {sorted(required-configured)}"; print("branch-protection: verified",sorted(required))' '__EVIDENCE_DIR__/branch-protection-main-__A__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/pr-checks-premerge-__A__.json' ]]"
   rtk gh pr checks __PR__ --json name,workflow,bucket > '__EVIDENCE_DIR__/pr-checks-premerge-__A__.json'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; rows=json.load(open(sys.argv[1])); required={"Source and delivery contracts","Backend, migrations, PostgreSQL and Ruff","Frontend locked install, tests, lint, types and production build","Authenticated disposable management integration"}; passed={row["name"] for row in rows if row.get("workflow")=="CI" and row.get("bucket")=="pass"}; assert rows and all(row.get("bucket")=="pass" for row in rows); assert required<=passed, f"canonical jobs not currently passing: {sorted(required-passed)}"; print("premerge-checks: verified")' '__EVIDENCE_DIR__/pr-checks-premerge-__A__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/pr-merge-gate-__A__.json' ]]"
   rtk gh pr view __PR__ --json state,isDraft,baseRefName,baseRefOid,headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup > '__EVIDENCE_DIR__/pr-merge-gate-__A__.json'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; from pathlib import Path; p=json.loads(Path(sys.argv[1]).read_text()); required={"Source and delivery contracts","Backend, migrations, PostgreSQL and Ruff","Frontend locked install, tests, lint, types and production build","Authenticated disposable management integration"}; assert p["state"]=="OPEN" and p["isDraft"] is False and p["baseRefName"]=="main"; assert p["baseRefOid"]==sys.argv[2] and p["headRefOid"]==sys.argv[3]; assert p["mergeStateStatus"]=="CLEAN" and p["reviewDecision"]=="APPROVED"; rollup=p.get("statusCheckRollup") or []; success={row.get("name") for row in rollup if row.get("conclusion")=="SUCCESS"}; assert required<=success, f"canonical rollup not successful: {sorted(required-success)}"; print("pr-merge-gate: verified")' '__EVIDENCE_DIR__/pr-merge-gate-__A__.json' __BASE_MAIN__ __A__
   rtk shasum -a 256 '__EVIDENCE_DIR__/branch-protection-main-__A__.json' '__EVIDENCE_DIR__/pr-checks-premerge-__A__.json' '__EVIDENCE_DIR__/pr-merge-gate-__A__.json'
   ```

   Machine/human expected values are: `state=OPEN`, `isDraft=false`,
   `baseRefName=main`, `baseRefOid=__BASE_MAIN__`, `headRefOid=__A__`, an
   approved review decision, mergeable/clean state, and the same passing checks.
   The repository must enforce an up-to-date base branch and require all four
   canonical CI jobs, or use a maintainer-managed merge queue. Merely observing
   `strict=true` with an empty/incomplete required-check set is not an atomic
   base guarantee. If protection is inaccessible/incomplete, STOP and request
   the queue rather than race main. The later tree check is a confirmation, not
   the first base-drift defense.

5. Squash merge only after checks, independent review and the bound merge gate
   are green. Bind the head in the merge command and do not ask `gh` to delete a
   branch still checked out by this worktree:

   ```bash
   rtk gh pr merge __PR__ --squash --match-head-commit __A__
   rtk gh pr view __PR__ --json state,mergedAt,mergeCommit,baseRefName
   rtk git fetch origin main
   ```

   Expected: state `MERGED`, base `main`; record merge commit as `__B__`.

6. Prove B is the exact merged main commit and equal tree before creating a
   clean detached checkout
   without touching the dirty primary worktree:

   ```bash
   rtk zsh -c 'set -euo pipefail; [[ "$(rtk git rev-parse origin/main)" == "__B__" && "$(rtk git rev-parse "__B__^{tree}")" == "__TREE_A__" ]]'
   rtk git rev-parse --short=12 __B__
   rtk git worktree add --detach /Users/code/project/smallkhoj-audit-release-__B_SHORT__ __B__
   ```

   Record the 12-character output as `__B_SHORT__` before substituting the
   worktree path. If main has already advanced or B's tree differs, do not
   deploy; create and fully reverify a new candidate from current main.

   In `/Users/code/project/smallkhoj-audit-release-__B_SHORT__`, run:

   ```bash
   rtk zsh -c 'set -euo pipefail; [[ "$(rtk git rev-parse HEAD)" == "__B__" && "$(rtk git rev-parse origin/main)" == "__B__" && "$(rtk git rev-parse "HEAD^{tree}")" == "__TREE_A__" ]]'
   rtk git rev-parse HEAD^{tree}
   rtk zsh -c 'set -euo pipefail; [[ -z "$(rtk git status --porcelain=v1 --untracked-files=all)" ]]'
   rtk env -u PYTHONOPTIMIZE python3 scripts/production_image_transfer.py --check-source-only --source-revision __B__
   ```

   Expected: every machine assertion exits 0, source-only exits 0, and recorded
   `__TREE_B__` is exactly `__TREE_A__`. If trees differ, do not build, upload
   or deploy and do not use the A capacity report.

## Phase 9 — Build and inspect B `linux/amd64` release artifacts locally

All Phase 9 commands run from the clean detached B worktree. No cloud access is
allowed yet.

1. Build the daemon and images. `__PRODUCTION_BUILD_ENV_FILE__` is supplied by
   the operator and is used only as an env-file input. Before its first load,
   validate only filesystem metadata: the path must be absolute and canonical,
   name an existing regular non-symlink file outside every Git worktree, belong
   to the current user and grant no group/other permissions. This validator
   does not read or enumerate the file; its single-assignment/content check
   remains an out-of-band operator responsibility. Re-read the build context
   metadata from the detached B checkout and require the same Phase-0 local
   Unix endpoint before the first B daemon call:

   ```bash
   rtk env -u PYTHONOPTIMIZE python3 -c 'import os,stat,subprocess,sys; from pathlib import Path; requested=Path(sys.argv[1]); assert requested.is_absolute() and not requested.is_symlink(); real=requested.resolve(strict=True); assert requested==real and real.is_file(); st=real.stat(); assert stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid() and st.st_mode & 0o077==0; roots=[Path(line.removeprefix("worktree ")).resolve() for line in subprocess.check_output(["git","worktree","list","--porcelain"],text=True).splitlines() if line.startswith("worktree ")]; assert roots and all(real!=root and root not in real.parents for root in roots); print("production-build-env-file-path: verified",real)' '__PRODUCTION_BUILD_ENV_FILE__'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt' ]]"
   rtk env -u PUBLIC_API_KEY uv run --project backend --no-sync --env-file __PRODUCTION_BUILD_ENV_FILE__ rtk env -u PYTHONOPTIMIZE python3 -c 'import hashlib,os; value=os.environ.get("PUBLIC_API_KEY"); assert isinstance(value,str) and value; print(hashlib.sha256(value.encode()).hexdigest())' > '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt' ]]"
   rtk chmod 400 '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__B__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ context inspect __LOCAL_BUILD_DOCKER_CONTEXT__ --format '{{.Endpoints.docker.Host}}' > '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__B__.txt'
   rtk cmp '__EVIDENCE_DIR__/local-build-docker-endpoint.txt' '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__B__.txt'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import os,stat,sys; endpoint=open(sys.argv[1]).read().strip(); assert endpoint.startswith("unix://") and "\n" not in endpoint; path=endpoint.removeprefix("unix://"); assert os.path.isabs(path) and stat.S_ISSOCK(os.stat(path).st_mode); print("local-build-docker-endpoint-before-b: verified",os.path.realpath(path))' '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__B__.txt'
   rtk shasum -a 256 '__EVIDENCE_DIR__/local-build-docker-endpoint-before-__B__.txt'
   rtk env -u PYTHONOPTIMIZE python3 scripts/build_daemon_distribution.py --root . --output-dir release-artifacts/smallkhoj-daemon --source-revision __B__ --clean-output-dir --json
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ build --platform linux/amd64 --label org.opencontainers.image.revision=__B__ -f backend/Dockerfile -t smallkhoj-backend:local-release .
   rtk env -u PUBLIC_API_KEY uv run --project backend --no-sync --env-file __PRODUCTION_BUILD_ENV_FILE__ rtk zsh -c 'set -euo pipefail; key_evidence="__EVIDENCE_DIR__/production-public-key-sha256-build-input-__B__.txt"; [[ ! -e "$key_evidence" ]]; rtk env -u PYTHONOPTIMIZE python3 -c "import hashlib,os; value=os.environ.get(\"PUBLIC_API_KEY\"); assert isinstance(value,str) and value; print(hashlib.sha256(value.encode()).hexdigest())" > "$key_evidence"; [[ -s "$key_evidence" ]]; rtk chmod 400 "$key_evidence"; rtk cmp "__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt" "$key_evidence"; rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__LOCAL_BUILD_DOCKER_CONTEXT__ docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ build --no-cache --platform linux/amd64 --label org.opencontainers.image.revision=__B__ --build-arg NEXT_PUBLIC_API_BASE_URL= --build-arg NEXT_PUBLIC_WS_BASE_URL= --build-arg NEXT_PUBLIC_DEPLOYMENT_ENV=production --secret id=public_api_key,env=PUBLIC_API_KEY -t smallkhoj-frontend:local-release ./frontend'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/production-public-key-sha256-after-build-__B__.txt' ]]"
   rtk env -u PUBLIC_API_KEY uv run --project backend --no-sync --env-file __PRODUCTION_BUILD_ENV_FILE__ rtk env -u PYTHONOPTIMIZE python3 -c 'import hashlib,os; value=os.environ.get("PUBLIC_API_KEY"); assert isinstance(value,str) and value; print(hashlib.sha256(value.encode()).hexdigest())' > '__EVIDENCE_DIR__/production-public-key-sha256-after-build-__B__.txt'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/production-public-key-sha256-after-build-__B__.txt' ]]"
   rtk chmod 400 '__EVIDENCE_DIR__/production-public-key-sha256-after-build-__B__.txt'
   rtk cmp '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-after-build-__B__.txt'
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ build --platform linux/amd64 --label org.opencontainers.image.revision=__B__ -t smallkhoj-caddy:local-release ./deploy/caddy
   ```

   The baseline is created before the frontend build. The build-input snapshot
   and Docker build execute in the same already-loaded env process, so the
   BuildKit secret cannot come from a later env-file load. The independent
   post-build load must remain byte-identical to the baseline. None of these
   commands emits the key itself; any missing/empty key, existing evidence file
   or digest mismatch is a STOP.

2. Inspect every artifact and recheck the tree:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-images-built-__B__.txt' ]]"
   rtk zsh -c 'set -euo pipefail; for tag in smallkhoj-backend:local-release smallkhoj-frontend:local-release smallkhoj-caddy:local-release; do rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ image inspect --format "$tag|{{.Id}}|{{index .Config.Labels \"org.opencontainers.image.revision\"}}|{{.Os}}/{{.Architecture}}|{{.Size}}" "$tag"; done' > '__EVIDENCE_DIR__/release-images-built-__B__.txt'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; from pathlib import Path; rows=[line.split("|") for line in Path(sys.argv[1]).read_text().splitlines() if line]; assert len(rows)==3 and all(len(row)==5 for row in rows); assert {row[0] for row in rows}=={"smallkhoj-backend:local-release","smallkhoj-frontend:local-release","smallkhoj-caddy:local-release"}; assert len({row[1] for row in rows})==3; assert all(row[2]==sys.argv[2] and row[3]=="linux/amd64" and row[4].isdigit() and int(row[4])>0 for row in rows); print("built-image-ledger: verified")' '__EVIDENCE_DIR__/release-images-built-__B__.txt' __B__
   rtk chmod 400 '__EVIDENCE_DIR__/release-images-built-__B__.txt'
   rtk shasum -a 256 '__EVIDENCE_DIR__/release-images-built-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-build-input-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-after-build-__B__.txt'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; from pathlib import Path; from scripts.production_image_transfer import validate_daemon_release_artifacts; validate_daemon_release_artifacts(Path("release-artifacts/smallkhoj-daemon"), sys.argv[1]); print("daemon-artifacts: verified")' __B__
   rtk git status --porcelain=v1 --untracked-files=all
   rtk env -u PYTHONOPTIMIZE python3 scripts/production_image_transfer.py --check-source-only --source-revision __B__
   ```

   Expected: the immutable keyed ledger has three distinct image IDs, every
   platform is `linux/amd64`, every revision is B, the daemon manifest is B,
   the worktree is clean and source-only exits 0. The release artifact
   directory must be ignored; if it dirties Git, stop.

3. Prevalidate the A report against B's equal tree without trusting its summary:

   ```bash
   rtk zsh -c 'set -euo pipefail; cd "__EVIDENCE_DIR__"; rtk shasum -a 256 -c "formal-capacity-__A__.json.sha256"'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; from pathlib import Path; from scripts.production_image_transfer import validate_capacity_report; e=validate_capacity_report(Path(sys.argv[1]),sys.argv[2]); assert e.profile_id=="formal-300-500-30-v1" and e.candidate_head==sys.argv[3] and e.candidate_tree==sys.argv[2]; print(e.profile_id,e.candidate_head,e.candidate_tree,e.report_sha256)' '__EVIDENCE_DIR__/formal-capacity-__A__.json' __TREE_B__ __A__
   ```

   Expected: profile `formal-300-500-30-v1`, candidate A, tree `TREE_A/TREE_B`,
   and the previously recorded report hash.

4. Run the exact B image IDs once locally before production. This is a short
   artifact/startup smoke, not a second formal capacity claim. Use a new
   B-scoped x86_64 Colima profile and the same target-shape VM settings; never
   run first-use smoke against cloud:

   ```bash
   rtk zsh -c 'set -euo pipefail; for port in 38184 38444; do rc=0; out=$(rtk lsof -nP -iTCP:$port -sTCP:LISTEN 2>&1) || rc=$?; if [[ $rc -eq 1 && -z "$out" ]]; then continue; fi; if [[ $rc -ne 0 ]]; then rtk printf "%s\n" "$out" >&2; exit $rc; fi; if [[ -n "$out" ]]; then rtk printf "listener-on-release-smoke-port=%s\n%s\n" "$port" "$out" >&2; exit 1; fi; done; rtk printf "release-smoke-ports-free=38184,38444\n"'
   rtk zsh -c "[[ ! -e '__B_DEPLOYMENT_BUNDLE__' ]]"
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import subprocess,sys; from pathlib import Path; bundle=Path(sys.argv[1]); assert bundle.is_absolute() and not bundle.exists() and not bundle.is_symlink(); parent=bundle.parent.resolve(strict=True); assert bundle.parent==parent; assert str(parent)!="/tmp" and not str(parent).startswith("/tmp/"); roots=[Path(line.removeprefix("worktree ")).resolve() for line in subprocess.check_output(["git","worktree","list","--porcelain"],text=True).splitlines() if line.startswith("worktree ")]; assert roots and all(parent!=root and root not in parent.parents for root in roots); print("b-deployment-bundle-path: verified",bundle)' '__B_DEPLOYMENT_BUNDLE__'
   rtk env -u PYTHONOPTIMIZE python3 scripts/make_deployment_bundle.py --root . --output '__B_DEPLOYMENT_BUNDLE__' --prefix smallkhoj-deploy-__B_SHORT__
   rtk zsh -c "[[ -s '__B_DEPLOYMENT_BUNDLE__' ]]"
   rtk chmod 400 '__B_DEPLOYMENT_BUNDLE__'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys,tarfile; from pathlib import Path; p=Path(sys.argv[1]); assert p.is_file() and p.stat().st_size>0; prefix=sys.argv[2]; t=tarfile.open(p,"r:gz"); names=t.getnames(); assert names and all(name==prefix or name.startswith(prefix+"/") for name in names); m=json.load(t.extractfile(prefix+"/manifest.json")); assert m["gitCommit"]==sys.argv[3]; print("deploy-bundle: verified")' '__B_DEPLOYMENT_BUNDLE__' smallkhoj-deploy-__B_SHORT__ __B_SHORT__
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-size-inputs-__B__.txt' ]]"
   rtk zsh -c "[[ ! -e '__B_IMAGE_ARCHIVE__' ]]"
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import subprocess,sys; from pathlib import Path; archive=Path(sys.argv[1]); assert archive.is_absolute() and not archive.exists() and not archive.is_symlink(); parent=archive.parent.resolve(strict=True); assert archive.parent==parent; assert str(parent)!="/tmp" and not str(parent).startswith("/tmp/"); roots=[Path(line.removeprefix("worktree ")).resolve() for line in subprocess.check_output(["git","worktree","list","--porcelain"],text=True).splitlines() if line.startswith("worktree ")]; assert roots and all(parent!=root and root not in parent.parents for root in roots); print("b-image-archive-path: verified",archive)' '__B_IMAGE_ARCHIVE__'
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __LOCAL_BUILD_DOCKER_CONTEXT__ save -o '__B_IMAGE_ARCHIVE__' smallkhoj-backend:local-release smallkhoj-frontend:local-release smallkhoj-caddy:local-release
   rtk zsh -c "[[ -s '__B_IMAGE_ARCHIVE__' ]]"
   rtk chmod 400 '__B_IMAGE_ARCHIVE__'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-image-archive-__B__.sha256' ]]"
   rtk zsh -c 'set -euo pipefail; rtk shasum -a 256 "__B_IMAGE_ARCHIVE__" > "__EVIDENCE_DIR__/release-image-archive-__B__.sha256"; rtk chmod 400 "__EVIDENCE_DIR__/release-image-archive-__B__.sha256"; rtk shasum -a 256 -c "__EVIDENCE_DIR__/release-image-archive-__B__.sha256"'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; from pathlib import Path; rows=[line.split("|") for line in Path(sys.argv[1]).read_text().splitlines() if line]; image_bytes=sum(int(row[4]) for row in rows); bundle_bytes=Path(sys.argv[2]).stat().st_size; archive_bytes=Path(sys.argv[3]).stat().st_size; assert image_bytes>0 and bundle_bytes>0 and archive_bytes>0; print(f"bImageVirtualBytes={image_bytes}"); print(f"bBundleArchiveBytes={bundle_bytes}"); print(f"bImageArchiveBytes={archive_bytes}")' '__EVIDENCE_DIR__/release-images-built-__B__.txt' '__B_DEPLOYMENT_BUNDLE__' '__B_IMAGE_ARCHIVE__' > '__EVIDENCE_DIR__/release-size-inputs-__B__.txt'
   rtk chmod 400 '__EVIDENCE_DIR__/release-size-inputs-__B__.txt'
   rtk zsh -c 'set -euo pipefail; ledger="__EVIDENCE_DIR__/release-bundle-__B__.sha256"; [[ ! -e "$ledger" ]]; rtk shasum -a 256 "__B_DEPLOYMENT_BUNDLE__" > "$ledger"; rtk chmod 400 "$ledger"; rtk shasum -a 256 -c "$ledger"'
   rtk shasum -a 256 '__EVIDENCE_DIR__/release-size-inputs-__B__.txt' '__EVIDENCE_DIR__/release-bundle-__B__.sha256' '__EVIDENCE_DIR__/release-image-archive-__B__.sha256'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-colima-list-__B__.jsonl' ]]"
   rtk colima list --json > '__EVIDENCE_DIR__/release-smoke-colima-list-__B__.jsonl'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; rows=[json.loads(line) for line in open(sys.argv[1]) if line.strip()]; assert all(row.get("name")!=sys.argv[2] for row in rows); print("release-smoke-profile-absent: verified",sys.argv[2])' '__EVIDENCE_DIR__/release-smoke-colima-list-__B__.jsonl' smallkhoj-release-smoke-__B_SHORT__
   rtk env -u DOCKER_HOST DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ colima start --profile smallkhoj-release-smoke-__B_SHORT__ --activate=false --vm-type qemu --arch x86_64 --cpu 4 --memory 3 --disk 30 --runtime docker
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-colima-__B__.json' ]]"
   rtk colima status --profile smallkhoj-release-smoke-__B_SHORT__ --json > '__EVIDENCE_DIR__/release-smoke-colima-__B__.json'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/release-smoke-colima-__B__.json' ]]"
   rtk cat '__EVIDENCE_DIR__/release-smoke-colima-__B__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-contexts-__B__.jsonl' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ context ls --format '{{json .}}' > '__EVIDENCE_DIR__/release-smoke-contexts-__B__.jsonl'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/release-smoke-contexts-__B__.jsonl' ]]"
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-context-__B__.txt' ]]"
   rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; status=json.load(open(sys.argv[1])); assert status["arch"]=="x86_64" and status["runtime"]=="docker" and status["cpu"]==4 and 0<int(status["memory"])<=3564584960; socket=status.get("docker_socket"); assert isinstance(socket,str) and socket.startswith("unix://"); rows=[json.loads(line) for line in open(sys.argv[2]) if line.strip()]; matches=[row["Name"] for row in rows if row.get("DockerEndpoint")==socket and not row.get("Error")]; assert len(matches)==1, matches; print(matches[0])' '__EVIDENCE_DIR__/release-smoke-colima-__B__.json' '__EVIDENCE_DIR__/release-smoke-contexts-__B__.jsonl' > '__EVIDENCE_DIR__/release-smoke-context-__B__.txt'
   rtk cat '__EVIDENCE_DIR__/release-smoke-context-__B__.txt'
   rtk zsh -c 'set -euo pipefail; [[ "$(<"__EVIDENCE_DIR__/release-smoke-context-__B__.txt")" == "__B_SMOKE_DOCKER_CONTEXT__" ]]'
   ```

   Match the reported Colima socket to the unique context endpoint and record
   that exact name as `__B_SMOKE_DOCKER_CONTEXT__`. Container/volume output must
   be empty and only built-in networks may exist:

   ```bash
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-docker-info-__B__.json' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ info --format '{"cpus":{{.NCPU}},"memoryBytes":{{.MemTotal}},"architecture":{{json .Architecture}},"os":{{json .OSType}}}' > '__EVIDENCE_DIR__/release-smoke-docker-info-__B__.json'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); assert p=={"cpus":4,"memoryBytes":p["memoryBytes"],"architecture":"x86_64","os":"linux"}; assert isinstance(p["memoryBytes"],int) and 0<p["memoryBytes"]<=3564584960; print("release-smoke-docker-shape: verified",p)' '__EVIDENCE_DIR__/release-smoke-docker-info-__B__.json'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-containers-before-__B__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ ps -aq > '__EVIDENCE_DIR__/release-smoke-containers-before-__B__.txt'
   rtk zsh -c "[[ ! -s '__EVIDENCE_DIR__/release-smoke-containers-before-__B__.txt' ]]"
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-volumes-before-__B__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ volume ls -q > '__EVIDENCE_DIR__/release-smoke-volumes-before-__B__.txt'
   rtk zsh -c "[[ ! -s '__EVIDENCE_DIR__/release-smoke-volumes-before-__B__.txt' ]]"
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-smoke-networks-before-__B__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ network ls --format '{{.Name}} {{.Driver}} {{.Scope}}' > '__EVIDENCE_DIR__/release-smoke-networks-before-__B__.txt'
   rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; rows=[line.split() for line in open(sys.argv[1]) if line.strip()]; assert len(rows)==3 and {row[0] for row in rows}=={"bridge","host","none"} and all(len(row)==3 for row in rows); print("release-smoke-built-in-networks: verified")' '__EVIDENCE_DIR__/release-smoke-networks-before-__B__.txt'
   rtk zsh -c 'set -euo pipefail; rtk shasum -a 256 -c "__EVIDENCE_DIR__/release-image-archive-__B__.sha256"'
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ load -i '__B_IMAGE_ARCHIVE__'
   rtk env -u PUBLIC_API_KEY uv run --project backend --no-sync --env-file __PRODUCTION_BUILD_ENV_FILE__ rtk zsh -c 'set -euo pipefail; key_evidence="__EVIDENCE_DIR__/production-public-key-sha256-smoke-input-__B__.txt"; [[ ! -e "$key_evidence" ]]; rtk env -u PYTHONOPTIMIZE python3 -c "import hashlib,os; value=os.environ.get(\"PUBLIC_API_KEY\"); assert isinstance(value,str) and value; print(hashlib.sha256(value.encode()).hexdigest())" > "$key_evidence"; [[ -s "$key_evidence" ]]; rtk chmod 400 "$key_evidence"; rtk cmp "__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt" "$key_evidence"; rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__B_SMOKE_DOCKER_CONTEXT__ SMALLKHOJ_HTTP_PORT=38184 SMALLKHOJ_HTTPS_PORT=38444 SMALLKHOJ_SITE_ADDRESS=:80 SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-release SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-release SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-release docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ compose --env-file /tmp/smallkhoj-audit-local-prod.env -p smallkhoj-release-smoke-__B_SHORT__ -f docker-compose.prod.yml up -d db backend frontend caddy'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/production-public-key-sha256-runtime-__B__.txt' ]]"
   rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ exec smallkhoj-release-smoke-__B_SHORT__-backend-1 env -u PYTHONOPTIMIZE python3 -c 'import hashlib,os; value=os.environ.get("PUBLIC_API_KEY"); assert isinstance(value,str) and value; print(hashlib.sha256(value.encode()).hexdigest())' > '__EVIDENCE_DIR__/production-public-key-sha256-runtime-__B__.txt'
   rtk zsh -c "[[ -s '__EVIDENCE_DIR__/production-public-key-sha256-runtime-__B__.txt' ]]"
   rtk chmod 400 '__EVIDENCE_DIR__/production-public-key-sha256-runtime-__B__.txt'
   rtk cmp '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-runtime-__B__.txt'
   rtk env -u PYTHONOPTIMIZE python3 scripts/post_deploy_smoke.py --base-url http://127.0.0.1:38184 --allow-http --json --strict-warnings
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/release-images-smoke-__B__.txt' ]]"
   rtk zsh -c 'set -euo pipefail; for item in backend:smallkhoj-backend\:local-release frontend:smallkhoj-frontend\:local-release caddy:smallkhoj-caddy\:local-release; do service=${item%%:*}; tag=${item#*:}; container="smallkhoj-release-smoke-__B_SHORT__-${service}-1"; image=$(rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ inspect --format "{{.Image}}" "$container"); identity=$(rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ image inspect --format "{{.Id}}|{{index .Config.Labels \"org.opencontainers.image.revision\"}}|{{.Os}}/{{.Architecture}}" "$image"); state=$(rtk docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ inspect --format "{{.State.Running}}|{{.State.OOMKilled}}|{{.RestartCount}}" "$container"); rtk printf "%s|%s|%s|%s\n" "$tag" "$identity" "$state"; done' > '__EVIDENCE_DIR__/release-images-smoke-__B__.txt'
   rtk uv run --project backend --no-sync rtk env -u PYTHONOPTIMIZE python3 -c 'import sys; from pathlib import Path; built=[line.split("|") for line in Path(sys.argv[1]).read_text().splitlines() if line]; smoke=[line.split("|") for line in Path(sys.argv[2]).read_text().splitlines() if line]; b={row[0]:row[1:4] for row in built}; s={row[0]:row[1:4] for row in smoke}; assert len(b)==len(s)==3 and b==s; assert all(len(row)==7 and tuple(row[4:])==("true","false","0") for row in smoke); print("local-smoke-image-chain: verified")' '__EVIDENCE_DIR__/release-images-built-__B__.txt' '__EVIDENCE_DIR__/release-images-smoke-__B__.txt'
   rtk chmod 400 '__EVIDENCE_DIR__/release-images-smoke-__B__.txt'
   rtk shasum -a 256 '__EVIDENCE_DIR__/release-smoke-colima-list-__B__.jsonl' '__EVIDENCE_DIR__/release-smoke-colima-__B__.json' '__EVIDENCE_DIR__/release-smoke-contexts-__B__.jsonl' '__EVIDENCE_DIR__/release-smoke-context-__B__.txt' '__EVIDENCE_DIR__/release-smoke-docker-info-__B__.json' '__EVIDENCE_DIR__/release-smoke-containers-before-__B__.txt' '__EVIDENCE_DIR__/release-smoke-volumes-before-__B__.txt' '__EVIDENCE_DIR__/release-smoke-networks-before-__B__.txt' '__EVIDENCE_DIR__/release-images-smoke-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-smoke-input-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-runtime-__B__.txt'
   ```

   Expected: zero smoke failures/warnings; the no-clobber bundle ledger binds
   the exact Phase-9 archive bytes and size before any cloud access; exact three release image IDs,
   revisions B, `linux/amd64`, running=true, OOM=false and restarts=0. The
   production public key remains opaque. The smoke-input digest is generated
   and compared in the same loaded env process that starts Compose. A targeted
   `docker exec` then reads only `PUBLIC_API_KEY` inside the running backend,
   emits only its SHA-256 digest and requires byte identity with the pre-build
   baseline; it never dumps the container environment. Together these prove
   the local backend runtime key matches the already-baked frontend key without
   printing either value. Then independently recheck the key in the same env
   process that stops the stack, bind every key-continuity snapshot in a
   no-clobber checksum ledger, and delete only this B-scoped profile:

   ```bash
   rtk env -u PUBLIC_API_KEY uv run --project backend --no-sync --env-file __PRODUCTION_BUILD_ENV_FILE__ rtk zsh -c 'set -euo pipefail; key_evidence="__EVIDENCE_DIR__/production-public-key-sha256-cleanup-input-__B__.txt"; [[ ! -e "$key_evidence" ]]; rtk env -u PYTHONOPTIMIZE python3 -c "import hashlib,os; value=os.environ.get(\"PUBLIC_API_KEY\"); assert isinstance(value,str) and value; print(hashlib.sha256(value.encode()).hexdigest())" > "$key_evidence"; [[ -s "$key_evidence" ]]; rtk chmod 400 "$key_evidence"; rtk cmp "__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt" "$key_evidence"; rtk env -u DOCKER_HOST -u PYTHONOPTIMIZE DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ DOCKER_CONTEXT=__B_SMOKE_DOCKER_CONTEXT__ SMALLKHOJ_HTTP_PORT=38184 SMALLKHOJ_HTTPS_PORT=38444 SMALLKHOJ_SITE_ADDRESS=:80 SMALLKHOJ_BACKEND_IMAGE=smallkhoj-backend:local-release SMALLKHOJ_FRONTEND_IMAGE=smallkhoj-frontend:local-release SMALLKHOJ_CADDY_IMAGE=smallkhoj-caddy:local-release docker --config __LOCAL_DOCKER_CONFIG_DIR__ --context __B_SMOKE_DOCKER_CONTEXT__ compose --env-file /tmp/smallkhoj-audit-local-prod.env -p smallkhoj-release-smoke-__B_SHORT__ -f docker-compose.prod.yml down -v --remove-orphans'
   rtk zsh -c "[[ ! -e '__EVIDENCE_DIR__/production-public-key-chain-__B__.sha256' ]]"
   rtk shasum -a 256 '__EVIDENCE_DIR__/production-public-key-sha256-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-build-input-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-after-build-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-smoke-input-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-runtime-__B__.txt' '__EVIDENCE_DIR__/production-public-key-sha256-cleanup-input-__B__.txt' > '__EVIDENCE_DIR__/production-public-key-chain-__B__.sha256'
   rtk chmod 400 '__EVIDENCE_DIR__/production-public-key-chain-__B__.sha256'
   rtk shasum -a 256 -c '__EVIDENCE_DIR__/production-public-key-chain-__B__.sha256'
   rtk env -u DOCKER_HOST DOCKER_CONFIG=__LOCAL_DOCKER_CONFIG_DIR__ colima delete --force --profile smallkhoj-release-smoke-__B_SHORT__
   rtk zsh -c 'set -euo pipefail; [[ -z "$(rtk git status --porcelain=v1 --untracked-files=all)" ]]'
   ```

## Phase 10 — Hard stop and post-merge production handoff

Plan 001 ends here. It does **not** authorize SSH, SCP, requests to the current
cloud URL, host probes, old-stack smoke tests, image transfer, Compose mutation,
database mutation, rollback, or cloud UI automation. The existing deployment is
known to run older code and remains untouched throughout Phases 0–9.

After Phase 9 is green, create a separate repo-external production runbook bound
to exact merge commit B, TREE_B, the accepted capacity-report digest, the three
B image IDs, the immutable B bundle digest, and the operator-approved target.
That runbook is a new production-stage review object, not an edit to candidate
A/B. At least two independent reviewers must return GO for the same runbook
digest before its first cloud command.

The production runbook must be executable for the current environment facts,
not a future domain shape:

- current target is IP-only HTTP at `http://124.222.40.40`, with
  `SMALLKHOJ_SITE_ADDRESS=:80`; every health, smoke and browser check binds
  directly to the approved server IP and uses `/api/health` plus
  `--allow-http`;
- the target is `linux/amd64`, four vCPUs and 3,564,584,960 guest-visible
  bytes, with PostgreSQL `max_connections=100`;
- no production write occurs before an owner-only, strict-schema release lock,
  canonical path/non-containment checks, disk/inode reserve, old image identity
  ledger, protected env/Compose copies, database backup and a successful
  collision-safe restore drill;
- the exact Phase-9 bundle and image archive are no-clobber inputs whose local,
  uploaded and in-band remote hashes must all agree; helper dry-runs may plan
  commands but may not silently regenerate or overwrite the measured bundle;
- a read-only zero-`feishu-worker` container gate runs before stopping any
  public/application service and is repeated after the stop; every failure path
  keeps all application writers and ingress stopped;
- application replacement is fail-fast and rechecks the full lock schema
  immediately before each mutation. The database remains running;
- this release does not authorize automatic old-image or database rollback.
  Failure freezes application writers, preserves PostgreSQL, the lock, logs,
  image/archive evidence and a fresh database-mutation marker, then waits for a
  separately reviewed maintainer incident-recovery plan;
- post-deploy acceptance proves running container image IDs and B revision,
  target-bound `/api/health`, `/login`, full smoke/foundation gates and a
  no-clobber ten-minute monitor run. Each monitor index executes exactly once
  and records both application HTTP health and container/PostgreSQL parity.

Production-runbook preparation does not block the local merge gate. Production
execution remains pending until B exists and the separate runbook passes its own
review. No local-only capacity result may be relabeled as WAN or cloud capacity
evidence.

## Plan 001 done criteria

Plan 001 is complete only when all of the following are true:

- [ ] The exact 145-path manifest, pinned 142-path core tree, plan-freeze file
      hashes and complete frozen candidate tree all agree.
- [ ] Candidate A is one clean local commit with no staged, unstaged or
      untracked release path.
- [ ] Full real-PostgreSQL backend/migration tests, script tests, Ruff, frontend
      tests/lint/typechecks/build, Compose validation and authenticated
      disposable E2E all pass on A.
- [ ] Local `./twd` evidence proves the expected task surface remains mounted,
      visible Task deletion succeeds, no error alert appears and exactly one
      live SSE body reader remains throughout the flow.
- [ ] An independent review bound to BASE_MAIN/A/TREE_A reports zero open P1/P2
      findings and explicitly reviews startup migrations, seeds and backfills.
- [ ] The immutable A tree passes `formal-300-500-30-v1`: 300 steady and 500
      peak SSE connections, 30 active users for 1,800 seconds, at least
      60 seconds at peak and at least 60 seconds cleanup observation inside the
      four-vCPU/3.32-GiB envelope.
- [ ] Required GitHub CI jobs and review are green, main-base synchronization is
      enforced, the squash merge produces B on `origin/main`, and
      `TREE_B == TREE_A`.
- [ ] Detached B builds three distinct `linux/amd64` images with revision B,
      validates the A capacity report against the equal tree, produces an
      immutable deployment bundle and passes a fresh local production-shape
      smoke using those exact image IDs.
- [ ] No cloud URL, SSH target or old deployment was accessed during Plan 001.
- [ ] Cloud deployment is explicitly recorded as pending the separate,
      digest-bound production runbook described in Phase 10.

## Unified local STOP conditions

Stop Plan 001 immediately if any of these occurs:

- the command would use port `55432`, the primary worktree, a shared/remote
  database, an unrelated browser tab, an implicit/default/unknown Docker
  context, a non-Unix Docker endpoint, or any old-cloud endpoint;
- live status differs from the literal manifest; the pinned core/full tree or a
  frozen file hash differs; the real Git index contains an unreviewed path;
- a required command, producer, assertion, parser, lint, type-check, test,
  build, E2E, UI, Docker identity or capacity invariant fails or is skipped;
- the candidate tree changes after evidence is recorded, the base branch moves,
  a required PR job is not actually required and passing, or merge
  synchronization cannot be proven;
- a reviewer reports an open P1/P2, a production credential would be printed or
  committed, or an unavailable tool is rewritten as a pass;
- any command before completion of Phase 9 would access or mutate the cloud.

A STOP is not permission to weaken a threshold, overwrite evidence, reuse an old
profile/report, bypass a parser, add a path merely to make an allowlist pass, or
continue to a later command. Fix the cause, create a new candidate identity when
the tree changed, and repeat every invalidated gate.

## Maintenance notes

- Keep the 142-path core-tree contract separate from the 145-path full-candidate
  contract. The external freeze ledger exists specifically to avoid a
  self-referential in-file SHA/tree assertion.
- Formal capacity is the last A-tree gate. Any later root-tree edit requires a
  new A and a complete rerun; only an equal-tree squash commit B may reuse it.
- The separate production runbook must not be committed by modifying B merely
  to record status. Store its digest, reviewer verdicts and execution evidence
  outside the repository or in a later normal documentation change after the
  deployment decision.
- Future HTTPS/domain rollout, multi-frontend topology, enabled Feishu worker
  load, larger active-user targets and automatic incident recovery require
  separate reviewed profiles/plans. They are not silently inferred from this
  release.
