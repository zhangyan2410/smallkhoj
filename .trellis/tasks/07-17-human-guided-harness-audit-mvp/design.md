# Human-Guided Single-Run Harness Audit MVP — Technical Design

## 1. Design Intent

Build the smallest mechanism that lets a human inspect the causal inputs and
outcome evidence of one coding-agent run. The system is a snapshot/report tool,
not a session database, telemetry daemon, replay UI, automatic reviewer, or
model evaluator.

The MVP treats four sources as independently meaningful:

```text
task contract       harness manifest       Claude session       Git/evidence
      \                    |                    |                    /
       +-------------------+--------------------+-------------------+
                                   |
                                   v
                         canonical audit bundle
                                   |
                         +---------+----------+
                         |                    |
                         v                    v
               deterministic report    human worksheet
```

## 2. Implementation Location and Runtime

```text
agent-audit
tools/agent-audit/
  package.json
  cli.mjs
  lib/
    arguments.mjs
    atomic-output.mjs
    audit-schema.mjs
    claude-adapter.mjs
    evidence.mjs
    git-snapshot.mjs
    harness-manifest.mjs
    hashing.mjs
    redaction.mjs
    report.mjs
    task-contract.mjs
    validate.mjs
  test/
  fixtures/
  README.md
```

The root wrapper resolves the repository-relative module and executes Node, like
the existing `smallkhoj-trace` wrapper. Product/runtime dependencies are zero.
Tests use `node:test` and temporary directories. The exact file split may be
consolidated when a module does not earn a separate boundary, but adapter,
redaction, Git, report, and schema responsibilities must remain testable.

The implementation does not live under `.trellis/scripts` because those files
are managed by Trellis updates. It does not live in the backend, frontend,
daemon, or unfinished `session-observer` because none is required for offline
collection.

## 3. CLI Contract

### 3.1 `collect`

```text
./agent-audit collect
  --repo PATH
  --task PATH
  --session SESSION_ID_OR_JSONL
  --harness PATH
  --base REVISION
  --head REVISION|worktree
  --out PATH
  [--home PATH]
  [--include-excerpts none|bounded]
  [--force-empty-out]
```

Rules:

- all primary paths are resolved before source content is read;
- `--home` allows a synthetic home/store during tests and defaults to the
  current user's home for explicit local runs;
- `--include-excerpts` defaults to `none`; `bounded` uses documented per-item
  and total budgets plus redaction;
- output must not be inside a scanned subject worktree unless explicitly
  excluded from the snapshot; the CLI computes this exclusion before Git
  collection;
- an existing non-empty output directory is rejected;
- collection builds in an adjacent temporary directory and renames/publishes
  only after validation succeeds;
- warnings do not imply success when a required identity is ambiguous.

### 3.2 `validate`

```text
./agent-audit validate AUDIT_DIRECTORY [--json]
```

Validation checks:

- required files and supported schema versions;
- JSON structure and cross-file audit identity;
- normalized evidence IDs and unique source locators;
- manifest input hashes available in the packet;
- report/worksheet generator compatibility;
- referenced bundle evidence IDs;
- no accidental raw record payload section;
- warning/error summary.

Validation cannot prove that an external source still has the same content
unless an optional source recheck is explicitly added later.

## 4. Input Resolution

### 4.1 Repository and task

- Canonicalize `--repo` without following paths outside expected input reads.
- Verify `git rev-parse --show-toplevel` and record the actual worktree root.
- Resolve `--task` either relative to the worktree or as an explicit absolute
  path; record whether it is inside the audited worktree.
- Require `prd.md`; optionally include `design.md`, `implement.md`, `research.md`,
  `task.json`, and declared requirement-change artifacts.
- Hash raw bytes and store bounded metadata, not complete copies, in
  `manifest.json`. `audit.json` stores extracted requirement text only when it
  passes redaction/size rules; otherwise it stores hashes and locators.

### 4.2 Claude session

If `--session` is an existing file, use that file after extension/readability
checks. Otherwise treat it as an exact native session ID:

1. inspect the configured Claude project store under `--home`;
2. find exact filename/session-ID matches only;
3. inspect safe metadata needed to associate candidate sessions with the
   requested workspace;
4. fail with candidate identities on zero/ambiguous matches without printing
   prompt contents;
5. record the selected path identity in the manifest, redacting the home prefix
   from human-facing output.

No "latest session" fallback is allowed in the MVP.

### 4.3 Harness manifest

Proposed minimum schema:

```json
{
  "schemaVersion": 1,
  "runId": "REAL_example",
  "subject": {
    "codingTool": "claude-code",
    "toolVersion": "unknown",
    "provider": "MiniMax",
    "model": "MiniMax-M3",
    "mode": "default"
  },
  "workspace": {
    "path": "/path/to/worktree",
    "baseRevision": "<git-revision>"
  },
  "contextSources": [
    {"id": "agents", "path": "AGENTS.md", "exposure": "automatic"}
  ],
  "tools": [
    {
      "id": "project-webdriver",
      "capabilities": ["browser-verification"],
      "exposure": "project-instruction",
      "permission": "allowed"
    }
  ],
  "skills": [],
  "environment": {
    "sandbox": "workspace-write",
    "network": "restricted",
    "browser": "project-webdriver",
    "quota": "unknown"
  },
  "interventions": [],
  "outcomeEvidence": []
}
```

Free-form metadata is allowed only under namespaced extensions. Unknown enum
values are preserved as warnings when safe, not coerced into known categories.
The manifest is a declaration; successful/failed observed actions may confirm
or contradict it.

## 5. Claude JSONL Adapter

### 5.1 Streaming parser

- Read with `readline` from a read-only file descriptor.
- Maintain physical line number, byte/line hash, native record type, timestamp,
  UUID/parent UUID/session ID when present, and parse status.
- Cap a single input line before JSON parsing. Oversized lines become a warning
  evidence item with hash and size, not retained content.
- Continue after malformed complete lines; treat a malformed final line as a
  distinct likely-truncation warning.
- Never execute or shell-evaluate record content.

### 5.2 Normalized observations

Supported initial evidence kinds:

```text
session.metadata
human.message
agent.message
agent.claim
tool.call
tool.result
context.access
permission.decision
session.compaction
usage.native
session.result
source.warning
```

Tool use/result relationships preserve native IDs. Recognizers can derive
`context.access` only from explicit supported tool-call shapes; prose mentions
remain messages/claims. The initial recognizers cover common Claude tools such
as Read, Grep, Glob, Bash, Edit/Write, task/subagent tools, and project-specific
Slock/WebDriver calls when their invocation shape is unambiguous.

The adapter does not expose hidden reasoning. If a native record includes a
thinking block, the MVP records only presence/size/type metadata unless an
explicit privacy-safe need is later approved.

### 5.3 Claims

The adapter may tag bounded assistant/user-visible statements as claim
candidates only when deterministic phrases are explicit, for example a final
result marker or direct "blocked because" statement. It must not perform
semantic causal classification. Full text remains omitted by default; source
locator, hash, message role/type, and bounded redacted excerpt policy are used.

## 6. Task Contract Model

The parser is intentionally conservative:

- Markdown headings define sections.
- Explicit identifiers such as `R1`, `AC1`, or checkbox labels are preserved.
- Other requirement/AC bullets receive a deterministic ID derived from artifact
  path, section heading, and normalized bullet position/content hash.
- Nested bullets remain children of the owning item.
- Checked/unchecked state is recorded as task-document state, not outcome truth.
- Original line locator and artifact hash are retained.
- Duplicate explicit IDs are errors because evidence linking would be ambiguous.

Design/implementation notes may be indexed as contract context but do not become
product requirements unless the PRD explicitly references them.

## 7. Git Outcome Model

### 7.1 Revision head

Use non-mutating `git` commands to resolve base/head objects, name-status, stats,
and patch bytes. Store:

- base/head object IDs;
- merge-base warning when base is not an ancestor;
- changed path, status, old/new object IDs when available;
- patch hash and size;
- bounded diff statistics;
- submodule/symlink/type-change warnings.

Raw patch bodies are not included in `report.md` or fixtures by default.

### 7.2 Dirty worktree head

Capture:

- HEAD object ID;
- tracked staged and unstaged status separately;
- untracked path identities and content hashes subject to size/safety limits;
- deterministic aggregate snapshot hash;
- ignored files excluded by default;
- the output/temp directory explicitly excluded.

The collector must compare `git status --porcelain` or equivalent before and
after collection and fail if its own operation changes subject state.

## 8. Outcome Evidence Inventory

The harness manifest may declare artifacts:

```json
{
  "id": "focused-tests",
  "kind": "command-result",
  "path": "evidence/focused-tests.json",
  "claims": ["AC9"],
  "revision": "<object-or-snapshot-id>"
}
```

The MVP verifies path, size, hash, readability, optional revision identity, and
declared claim links. It does not parse every possible test framework. A small
documented command-result JSON shape may expose command, cwd, start/end, exit
code, and bounded output summary; arbitrary transcript commands are never run.

Image/browser artifacts record dimensions and hashes when deterministically
available, but semantic claims such as "narrow viewport is correct" remain for
human review unless separately proven by structured metadata.

## 9. Evidence and Bundle Schema

Every evidence item contains:

```text
id
kind
authority: observed | declared | claimed | reviewed | inferred
sourceType
sourceId
locator
observedAt? / sequence?
subjectRefs[]
summary
details (bounded, kind-specific)
contentHash?
warnings[]
extensions?
```

Evidence IDs are deterministic within normalized inputs. Locators use an
adapter-specific scheme, for example:

```text
task:prd.md#line=84
claude:<session-id>#line=1234&record=<uuid>
git:<snapshot-id>#path=tools/example.mjs
artifact:<artifact-id>#sha256=<hash>
```

Locators are display strings plus structured fields; parsers must not depend on
string splitting alone.

## 10. Deterministic Report

The renderer orders facts by stable domain order and event sequence rather than
object insertion order. Volatile generation time/audit ID appear only in the
header/manifest and are ignored by semantic snapshot tests.

High-signal timeline selection is rule-based:

- task/human requirement changes;
- first reads of declared context;
- material edit/write operations;
- validation/browser/review actions;
- permission denials or failed required capabilities;
- compaction/reset/interruption evidence;
- explicit block/completion/result claims;
- session terminal result.

Routine repeated reads or streaming fragments are aggregated with counts and
locators, not replayed individually.

## 11. Human Worksheet

The worksheet starts with an evidence-reading guide and a blank finding
template. It does not preselect categories. A finding uses stable evidence IDs
so the reviewer can later convert completed Markdown into a structured reviewed
finding in a future stage.

The final section asks for no more than three next-run interventions and one
smallest experiment per intervention. "Need observation X first" is a valid
intervention.

## 12. Redaction and Limits

Default limits are design constants with CLI documentation and tests. Initial
values may be tuned during implementation, but must cover:

- maximum JSONL line bytes;
- maximum parsed string/payload summary bytes;
- maximum excerpt bytes per evidence item;
- maximum total excerpt bytes per report;
- maximum artifact size to hash/read directly;
- maximum untracked file size for content hashing;
- maximum warning samples per unknown record kind.

Redaction matches structured secret keys first, then known token/header patterns
and configured secret paths. The report shows redaction counts without echoing
the secret. Hashing a secret value is avoided when it could enable trivial
dictionary matching; source record/line hashes cover integrity instead.

## 13. Error and Atomicity Model

Errors are categorized:

- usage/configuration;
- required source missing/ambiguous;
- invalid harness/task contract;
- unsupported schema/version;
- source changed during collection;
- privacy/limit violation;
- output publication failure;
- bundle validation failure.

The process exits non-zero on required errors. Warnings appear in all bundle
views. A generated temporary directory is removed on ordinary failure, while a
debug-preservation option is out of scope for the MVP.

## 14. Testing Strategy

### Unit fixtures

- contract headings, checkboxes, duplicate IDs, Unicode, nested bullets;
- manifest valid/invalid/unknown/missing fields;
- Claude metadata/user/assistant/tool call/tool result/compaction/result records;
- malformed, final-truncated, unknown, and oversized records;
- MiniMax native/provider usage conflict;
- secret-bearing structured and unstructured payloads;
- deterministic evidence IDs, locators, ordering, and rendering.

### Integration fixtures

- synthetic home with multiple workspace sessions and ambiguity cases;
- temporary Git repositories with revision, staged, unstaged, untracked,
  symlink, and excluded-output states;
- task plus artifact evidence with matching/mismatched revisions;
- read-only permission/source-state checks;
- failure before atomic publication and existing-output safety;
- collect followed by validate and deterministic rerender.

### Real MiniMax validation

1. identify the archived MiniMax source locally without printing content;
2. generate a private temporary packet and record only safe audit metadata and
   reviewer findings in task evidence;
3. run a fresh MiniMax-M3 subject task in a separate worktree with an explicit
   harness manifest captured before start;
4. collect after completion or a stable terminal checkpoint;
5. complete the human worksheet;
6. verify the diagnosis identifies evidence, counter-evidence, unknowns, and a
   next experiment rather than a model score.

## 15. Security and Privacy Threats

- JSONL content attempting Markdown/terminal injection is rendered as escaped,
  bounded data, never executed.
- Paths from records do not become filesystem reads unless they originate from
  an explicit audited input contract and pass root/safety checks.
- Symlinks in task/evidence/output paths are resolved and constrained before
  reads/writes.
- The CLI never follows a transcript instruction to read another file.
- Output Markdown treats HTML/script-like content as inert code/escaped text.
- Native source and Git source descriptors are opened/read without writes;
  tests compare state before/after.

## 16. Known MVP Limits

- Declared harness manifests can be incomplete or inaccurate; contradictions
  are shown but the CLI cannot discover every hidden runtime capability.
- Claude JSONL does not necessarily record every automatically injected context
  source or full available-tool definition.
- Natural-language requirement satisfaction and screenshot semantics require
  human judgment.
- Decisions not stated or observable cannot be reconstructed.
- Human findings are Markdown, not yet parsed into a database or automated
  training/evaluation corpus.
- Only Claude Code is supported; MiniMax is the model/provider calibration, not
  a separate adapter.

## 17. Rollback

The feature has no migrations or service state. Rollback removes the root
wrapper and `tools/agent-audit/`. Generated audit directories are explicit user
artifacts and are never deleted automatically. Native session/task/Git sources
remain unchanged.

