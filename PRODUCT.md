# Product

## Register

product

## Users

SmallKhoj control surfaces are used by the product owner, local operators, and agents supervising integration gates. They are opened during development and validation to see whether daemon, runtime, channel, chat, task, and TaskRun behavior is real and stable.

## Product Purpose

SmallKhoj provides a local human-agent collaboration workbench with channels, tasks, daemon-managed runtimes, and control-plane evidence. The management/control UI exists to make runtime and integration behavior inspectable at a glance before deeper logs or traces are needed.

## Brand Personality

Calm, operational, precise. The interface should feel like a trustworthy control room, not a marketing surface or raw debug console.

## Anti-references

Avoid product-side polish that hides control facts. Avoid dumping long IDs, tokens, session strings, or raw JSON as the primary UI because operators cannot quickly judge behavior from those strings. Avoid Slock's black-border/brutalist/pink-heavy styling for SmallKhoj surfaces.

## Design Principles

- Show human-readable state first: phase, owner, readiness, duration, risk, output, and failure reason.
- Keep raw identifiers available but secondary: short labels, copy affordances, and expandable detail instead of dominant strings.
- Separate control UI from product UI; `/control/*` surfaces can be dense and operational without becoming user-facing product flows.
- Treat activity, daemon, runtime, and TaskRun evidence as observability, not chat content or runtime work.
- Prefer stable, scannable layouts that help compare several agents/runs quickly.

## Accessibility & Inclusion

Target readable product contrast, keyboard-accessible controls, and reduced-motion-safe state transitions. Do not rely on color alone for status or gate failures.
