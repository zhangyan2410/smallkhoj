# Thinking Guides

> **Purpose**: Expand your thinking to catch things you might not have considered.

---

## Why Thinking Guides?

**Most bugs and tech debt come from "didn't think of that"**, not from lack of skill:

- Didn't think about what happens at layer boundaries → cross-layer bugs
- Didn't think about code patterns repeating → duplicated code everywhere
- Didn't think about edge cases → runtime errors
- Didn't think about future maintainers → unreadable code

These guides help you **ask the right questions before coding**.

---

## Available Guides

| Guide | Purpose | When to Use |
|-------|---------|-------------|
| [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md) | Identify patterns and reduce duplication | When you notice repeated patterns |
| [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md) | Think through data flow across layers | Features spanning multiple layers |
| [Reference Projects Guide](./reference-projects.md) | Check local/reference repos before inventing MCP, skill, channel, or platform surfaces | MCP/skill visibility, agent platform, channel/runtime, self-hosting work |
| [Runtime Debugging SOP](./runtime-debugging-sop.md) | Diagnose runtime/daemon/provider stuck states | Agent/runtime delivery issues |

---

## Quick Reference: Thinking Triggers

### When to Think About Cross-Layer Issues

- [ ] Feature touches 3+ layers (API, Service, Component, Database)
- [ ] Data format changes between layers
- [ ] Multiple consumers need the same data
- [ ] You're not sure where to put some logic
- [ ] A backend event, activity, or runtime state might be consumed by multiple surfaces

→ Read [Cross-Layer Thinking Guide](./cross-layer-thinking-guide.md)

### When to Think About Runtime/Event Delivery

- [ ] You're changing `ActivityLog`, `EventRecord`, daemon WS/SSE/polling, or event aliases
- [ ] A new event might reach an agent runtime
- [ ] A runtime could receive its own activity/message back
- [ ] Token usage could grow because telemetry is delivered as prompt text

→ Read [Runtime Debugging SOP](./runtime-debugging-sop.md) and `.trellis/spec/backend/event-delivery-contracts.md`

### When to Think About Code Reuse

- [ ] You're writing similar code to something that exists
- [ ] You see the same pattern repeated 3+ times
- [ ] You're adding a new field to multiple places
- [ ] **You're modifying any constant or config**
- [ ] **You're creating a new utility/helper function** ← Search first!

→ Read [Code Reuse Thinking Guide](./code-reuse-thinking-guide.md)

### When to Check Reference Projects

- [ ] You're designing MCP server/tool/resource visibility
- [ ] You're designing skill visibility, skill source models, or skill registry behavior
- [ ] You're changing agent platform, channel/runtime, daemon, self-hosting, or supervisor-facing surfaces
- [ ] You're tempted to invent a new convention that may already exist in a nearby repo

→ Read [Reference Projects Guide](./reference-projects.md)

---

## Pre-Modification Rule (CRITICAL)

> **Before changing ANY value, ALWAYS search first!**

```bash
# Search for the value you're about to change
grep -r "value_to_change" .
```

This single habit prevents most "forgot to update X" bugs.

---

## How to Use This Directory

1. **Before coding**: Skim the relevant thinking guide
2. **During coding**: If something feels repetitive or complex, check the guides
3. **After bugs**: Add new insights to the relevant guide (learn from mistakes)

---

## Contributing

Found a new "didn't think of that" moment? Add it to the relevant guide.

---

**Core Principle**: 30 minutes of thinking saves 3 hours of debugging.
