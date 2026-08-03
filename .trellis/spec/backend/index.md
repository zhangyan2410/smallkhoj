# Backend Development Guidelines

> Best practices for backend development in this project.

---

## Overview

This directory contains guidelines for backend development. Fill in each file with your project's specific conventions.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization and file layout | To fill |
| [Database Guidelines](./database-guidelines.md) | ORM patterns, queries, migrations, read-only marker observation | Active |
| [Error Handling](./error-handling.md) | Error types, handling strategies | To fill |
| [Quality Guidelines](./quality-guidelines.md) | Code standards, forbidden patterns | To fill |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |
| [Release Pipeline](./release-pipeline.md) | End-to-end verify -> squash merge -> registry-free cloud deploy -> schema-aware rollback overview | Active |
| [Deployment Environment Contracts](./deployment-environment-contracts.md) | local-dev/local-prod/cloud-prod evidence, Caddy routes, direct image archive deployment | Active |
| [Runtime Slock Integration](./runtime-slock-integration.md) | Claude runtime, slock CLI, local proxy, and MCP compatibility contracts | Active |
| [Event Delivery Contracts](./event-delivery-contracts.md) | Activity/event filtering, daemon delivery, and runtime token-safety contracts | Active |
| [Threading Contracts](./threading-contracts.md) | Single-level thread APIs, summary metadata, DM display, and daemon thread events | Active |
| [Memory Contracts](./memory-contracts.md) | Server-owned scoped memory, proposal audit, selective context manifests, and task recovery contracts | Active |

---

## How to Fill These Guidelines

For each guideline file:

1. Document your project's **actual conventions** (not ideals)
2. Include **code examples** from your codebase
3. List **forbidden patterns** and why
4. Add **common mistakes** your team has made

The goal is to help AI assistants and new team members understand how YOUR project works.

---

**Language**: All documentation should be written in **English**.
