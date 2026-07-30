import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  RealtimeTransportOwner,
  projectRealtimeEvent,
  type RealtimeTransportFactory,
} from "../lib/realtime-owner"
import type { PublicEventEnvelope } from "../lib/realtime-events"

function event(overrides: Partial<PublicEventEnvelope> = {}): PublicEventEnvelope {
  return {
    id: "evt-1",
    type: "task.updated",
    scope: { kind: "task", id: "task-1" },
    seq: 1,
    epoch: "epoch-a",
    payload: {},
    ...overrides,
  }
}

test("one realtime owner shares one physical transport across subscribers", () => {
  const transports: Array<{
    signal: AbortSignal
    emit: (value: PublicEventEnvelope) => void
    stopped: boolean
  }> = []
  const factory: RealtimeTransportFactory = ({ signal, onEvent }) => {
    const transport = { signal, emit: onEvent, stopped: false }
    transports.push(transport)
    return () => { transport.stopped = true }
  }
  const owner = new RealtimeTransportOwner(factory)
  owner.setScope({ key: "account-a:server-a", headers: { "X-Server-Id": "server-a" } })

  const firstEvents: string[] = []
  const secondEvents: string[] = []
  const unsubscribeFirst = owner.subscribe(({ event: value }) => firstEvents.push(value.id))
  const unsubscribeSecond = owner.subscribe(({ event: value }) => secondEvents.push(value.id))

  assert.equal(transports.length, 1)
  transports[0].emit(event())
  transports[0].emit(event())
  assert.deepEqual(firstEvents, ["evt-1"])
  assert.deepEqual(secondEvents, ["evt-1"])

  unsubscribeFirst()
  assert.equal(transports[0].stopped, false)
  assert.equal(transports[0].signal.aborted, false)
  unsubscribeSecond()
  assert.equal(transports[0].stopped, true)
  assert.equal(transports[0].signal.aborted, true)
})

test("scope switch closes the old generation and rejects stale callbacks", () => {
  const transports: Array<{
    signal: AbortSignal
    emit: (value: PublicEventEnvelope) => void
    stopped: boolean
  }> = []
  const factory: RealtimeTransportFactory = ({ signal, onEvent }) => {
    const transport = { signal, emit: onEvent, stopped: false }
    transports.push(transport)
    return () => { transport.stopped = true }
  }
  const owner = new RealtimeTransportOwner(factory)
  const received: string[] = []
  owner.setScope({ key: "account-a:server-a", headers: { "X-Server-Id": "server-a" } })
  const unsubscribe = owner.subscribe(({ event: value }) => received.push(value.id))
  assert.equal(transports.length, 1)

  owner.setScope({ key: "account-a:server-b", headers: { "X-Server-Id": "server-b" } })
  assert.equal(transports.length, 2)
  assert.equal(transports[0].stopped, true)
  assert.equal(transports[0].signal.aborted, true)

  transports[0].emit(event({ id: "stale" }))
  transports[1].emit(event({ id: "current" }))
  assert.deepEqual(received, ["current"])

  unsubscribe()
  owner.dispose()
  assert.equal(transports[1].stopped, true)
  assert.equal(transports[1].signal.aborted, true)
})

test("realtime projection targets task invalidation and ignores unrelated events", () => {
  const accepted = new Set(["task.updated", "member.updated"])

  assert.equal(projectRealtimeEvent(event(), accepted), "tasks")
  assert.equal(
    projectRealtimeEvent(event({ type: "member.updated", scope: { kind: "member", id: "member-1" } }), accepted),
    "route",
  )
  assert.equal(
    projectRealtimeEvent(event({ type: "message.created", scope: { kind: "channel", id: "channel-1" } }), accepted),
    "ignore",
  )
})

test("only the shell provider creates a physical realtime transport", () => {
  const frontendRoot = process.cwd()
  const sourceRoots = ["app", "components"]
  const transportCallers: string[] = []

  const scan = (relativeDirectory: string) => {
    for (const entry of readdirSync(path.join(frontendRoot, relativeDirectory), { withFileTypes: true })) {
      const relativePath = path.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) {
        scan(relativePath)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      const source = readFileSync(path.join(frontendRoot, relativePath), "utf8")
      if (/connectRealtimeEvents\(\{/.test(source)) transportCallers.push(relativePath)
    }
  }

  for (const sourceRoot of sourceRoots) scan(sourceRoot)
  assert.deepEqual(transportCallers, ["components/realtime-provider.tsx"])

  const shellSource = readFileSync(path.join(frontendRoot, "components/product-shell.tsx"), "utf8")
  assert.match(shellSource, /<RealtimeProvider serverId=\{session\?\.server\.id\}>/)
})
