# Daemon Codex Runtime Integration

## Superseded

This older PRD is superseded by `.trellis/tasks/07-01-codex-acp-product-path-cleanup/prd.md`.

The original direction described a native Codex CLI daemon runtime. That direction is no longer the product plan. Product Codex must use the ACP integration path because ACP is the correct resident interaction model, while native CLI launches frequent short-lived processes and should not be exposed as a supported product runtime.

## Current Direction

- Product-facing Codex runtime is `codex`.
- The daemon implementation for product Codex is Codex ACP.
- Historical native Codex CLI code, tests, docs, and runtime options should be removed, gated as internal-only, or clearly labeled as legacy during migration.
- Windows failures such as `spawn npx ENOENT` should be fixed by making ACP launcher resolution reliable, not by restoring native CLI as a product path.

## Follow-Up

Use `.trellis/tasks/07-01-codex-acp-product-path-cleanup/prd.md` as the active requirements source.
