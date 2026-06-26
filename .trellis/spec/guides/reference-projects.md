# Reference Projects Guide

> Purpose: remember which sibling/reference repositories should be checked before designing or implementing adjacent platform capabilities.

## Core Memory

SmallKhoj has reference projects available locally. They are reference projects, not GA itself, and must not be conflated with a GA codebase.

Use these references before designing MCP visibility, skill visibility, channel/runtime orchestration, agent workspaces, or similar platform surfaces:

| Reference | Local Path | Remote / Identity | Use For |
| --- | --- | --- | --- |
| agent-platform | `/Users/code/project/agent-platform` | `https://github.com/neutree-ai/agent-platform.git` | Agent platform architecture, skills/content service, control plane, browser/service boundaries, self-hosting layout |
| clowder-ai | `/Users/code/project/clowder-ai` | `https://github.com/zts212653/clowder-ai` | Cat Cafe skills, multi-agent workflow conventions, memory/evidence systems, review/merge lifecycle skills |
| multica | `/Users/code/project/multica` | `https://github.com/multica-ai/multica.git` (`multica-ai/multica`) | MCP/agent product patterns, self-hosting docs, daemon/server layout, app/package organization, skills lock/config patterns |

## When To Check Them

- Before adding a new MCP inventory, skill inventory, tool/resource visibility, or capability explorer surface.
- Before introducing new channel/runtime orchestration concepts in SmallKhoj.
- Before inventing a new local skill layout, skill registry, or skill-source model.
- Before designing UX that exposes agent/MCP/skill internals to developers or supervisors.
- Before changing self-hosting, daemon, control-plane, or agent workspace boundaries.

## How To Use

1. Inspect the relevant reference project first, then decide whether SmallKhoj should reuse the pattern, adapt it, or explicitly reject it.
2. Record the decision in the active Trellis task, ADR, or implementation notes.
3. Do not copy code blindly. Treat references as prior art for contracts, boundaries, terminology, and UX, not as mandatory source.
4. If a reference conflicts with SmallKhoj's existing specs, prefer SmallKhoj's specs unless the task explicitly updates them.

## Wrong vs Correct

### Wrong

"Build MCP/skill visibility from scratch without checking the reference projects."

### Correct

"Check `agent-platform`, `clowder-ai`, and `multica-ai/multica` first, summarize applicable patterns, then implement the SmallKhoj version that fits our current Trellis specs."

