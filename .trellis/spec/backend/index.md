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
| [Quality Guidelines](./quality-guidelines.md) | Code standards, release gates, and runtime-profile Integration Gate contracts | Active |
| [Logging Guidelines](./logging-guidelines.md) | Structured logging, log levels | To fill |
| [Release Pipeline](./release-pipeline.md) | End-to-end verify -> squash merge -> registry-free cloud deploy -> schema-aware rollback overview | Active |
| [Deployment Environment Contracts](./deployment-environment-contracts.md) | local-dev/local-prod/cloud-prod evidence, Caddy routes, direct image archive deployment | Active |
| [Daemon Release and Lease Contracts](./daemon-release-and-lease-contracts.md) | Aura release pointers, installer recovery, explicit rollback, and lease-aware Connect/Reconnect | Active |
| [Runtime Slock Integration](./runtime-slock-integration.md) | Managed runtime identity, Slock CLI, local proxy, providers, and ACP compatibility contracts | Active |
| [Event Delivery Contracts](./event-delivery-contracts.md) | Activity/event filtering, daemon delivery, and runtime token-safety contracts | Active |
| [Threading Contracts](./threading-contracts.md) | Single-level thread APIs, summary metadata, DM display, and daemon thread events | Active |
| [Memory Contracts](./memory-contracts.md) | Server-owned scoped memory, proposal audit, selective context manifests, and task recovery contracts | Active |
| [Stable Member Identity and Channel Context](./member-identity-channel-contracts.md) | Immutable Names, one-home-Server identity, Channel references, membership events, mentions, tombstones, and daemon context | Active |

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
