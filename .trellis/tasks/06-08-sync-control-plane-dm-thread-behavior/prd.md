# Sync Slock Control Plane With DM and Thread Behavior

## Problem

The product has added richer DM and single-level thread behavior, but Slock Control Plane surfaces have not been fully synchronized with those contracts. Some control-plane views and actions still treat chat primarily as channels/top-level messages, making DM/thread behavior harder to inspect, control, and verify.

## Goals

- Audit Slock Control Plane pages and APIs for DM/thread awareness.
- Ensure DM channels display peer-facing names and useful routing metadata where needed.
- Ensure thread roots and replies are distinguishable in control-plane views.
- Surface event/runtime routing fields that matter for agent delivery: `target`, `channel`, `channelId`, `parentId`, `threadId`, `shortId`, `agentId`, and `targetAgentId`.
- Add or update controls needed to inspect and debug agent DM/thread delivery without direct database queries.
- Verify the changes with WebDriver against the running local app, not only automated E2E.

## Non-Goals

- Redesign the main chat UI.
- Change the DM/thread storage model.
- Add nested threads.

## Acceptance Criteria

- Control Plane exposes enough DM/thread information to explain where an agent message was delivered and where its reply should appear.
- Existing channel, DM, and thread contracts remain single-level and compatible with agent/runtime APIs.
- WebDriver acceptance uses a unique marker and verifies both visible DOM state and backing API/DB fields.
- Automated regression coverage is added where useful, but WebDriver behavior is treated as the stronger acceptance gate for user-visible behavior.
