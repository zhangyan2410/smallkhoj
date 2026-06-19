---
topics: [codegraph, code-map, agent-context]
doc_kind: guide
created: 2026-06-19
updated: 2026-06-19
---

# CodeGraph Agent Guide

CodeGraph is the current-code map for SmallKhoj. Use it before broad `rg`/Bash filtering when the question is about code structure, symbols, call paths, or impact. It does not replace product intent, Trellis task context, real tests, or human decisions.

## First Checks

```bash
codegraph status
codegraph files
```

Use `codegraph status` to confirm the index is current. Use `codegraph files` for a generated module map of the repo.

## High-Frequency Queries

Project/code overview:

```bash
codegraph files
codegraph explore backend frontend daemon task channel runtime
```

Daemon/runtime work:

```bash
codegraph explore daemon runtime session workspace slock
codegraph query DaemonCore
codegraph node DaemonCore
codegraph node AgentWorkspace
```

Backend/API work:

```bash
codegraph explore backend router service model activity event
codegraph query DaemonControlHub
codegraph node DaemonControlHub
codegraph node ActivityLog
```

Frontend/product work:

```bash
codegraph explore frontend task channel member daemon
codegraph query TaskBoard
codegraph query ProductShell
```

Before changing a symbol:

```bash
codegraph impact <symbol>
codegraph callers <symbol>
codegraph callees <symbol>
```

For one focused symbol or file:

```bash
codegraph node <symbol>
codegraph node <path>
```

## How Agents Should Use It

1. Start with CodeGraph for structure and candidate entry points.
2. Read the actual files it surfaces before editing.
3. Use `rg` for exact strings, literals, config keys, and validation after CodeGraph has narrowed the area.
4. Use Trellis/spec docs for task rules and product intent.
5. Use `./smallkhoj-trace` and `./twd` for real behavior verification.

## Current Caveat

The existing index is useful and much stronger than Graphify for this repo, but it was built by an earlier CodeGraph engine. If results look stale or incomplete, run:

```bash
codegraph sync
```

For a full rebuild:

```bash
codegraph index -f
```
