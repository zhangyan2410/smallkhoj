# Design: Inkframe Selector Driven TWD Proof Runner

## Proposed Shape

Implement a small project-local runner rather than another markdown-only
checklist.

Candidate location:

```text
tools/twd-guard/twd-inkframe-proof
```

or, if the guard tools are not script-friendly:

```text
scripts/twd_inkframe_proof.py
```

Prefer the existing `tools/twd-guard` convention if it exists and is readable.

## Data Model

```ts
type ProofStatus =
  | "passed"
  | "blocked_no_tab"
  | "failed_selector"
  | "failed_route"
  | "failed_twd"
  | "unsupported";

type SelectorCheck = {
  group: string;
  label: string;
  selector: string;
  minCount: number;
  maxCount?: number;
  route: string;
  viewport?: "desktop" | "mobile";
};

type ProofEvidence = {
  status: ProofStatus;
  timestamp: string;
  tabsResult: unknown;
  checks: Array<SelectorCheck & {
    actualCount?: number;
    status: "passed" | "failed" | "skipped";
    error?: string;
  }>;
  notes: string[];
};
```

The concrete implementation may be shell or Python, but the output must preserve
this shape conceptually.

## Selector Groups

Required groups:

- `product-shell`
- `chat-desktop`
- `chat-mobile`
- `chat-unread`
- `task-desktop`
- `task-mobile`
- `material-state`

Selectors come from:

```text
.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/evidence/twd-proof-checklist.md
```

## Command Flow

1. Run `./twd --compact tabs`.
2. If no tabs, write blocked evidence and exit with a documented non-zero code
   or status marker.
3. Authenticate/open routes through `tools/twd-guard` if present.
4. For each route, run DOM selector count assertions.
5. If mobile viewport commands exist, repeat mobile selectors at 390px width.
6. Write JSON + Markdown summary evidence.

## Test Strategy

Tests should not require a live browser. They should exercise:

- selector manifest completeness;
- no-tab parsing;
- evidence output classification;
- command strings forbid Playwright;
- evidence path stays under the task directory.

Real browser execution remains gated on a connected `./twd` tab.
