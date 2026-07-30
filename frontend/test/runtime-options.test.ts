import assert from "node:assert/strict"
import test from "node:test"

import { detectedProviderOptions, runtimeOptionsFromDetected, unavailableProviderOptions } from "../lib/runtime-options"
import type { Computer } from "../lib/control-plane"

const computers = [{
  id: "local",
  name: "local",
  status: "online",
  detectedRuntimes: [
    {
      type: "claude_code",
      provider: "Kimi",
      runtimeProvider: "Kimi",
      model: "kimi-for-coding",
      status: "available",
      source: "cc-switch",
    },
    {
      type: "codex",
      provider: "krill",
      runtimeProvider: "codex-krill",
      model: "gpt-5.3-codex",
      status: "available",
      source: "cc-switch",
    },
  ],
  agentWorkspaces: [],
}] satisfies Computer[]

test("detectedProviderOptions filters providers by selected public runtime", () => {
  assert.deepEqual(
    detectedProviderOptions(computers, { runtime: "codex" }),
    [{ value: "codex-krill", label: "krill / available / gpt-5.3-codex" }],
  )
  assert.deepEqual(
    detectedProviderOptions(computers, { runtime: "claude_code" }),
    [{ value: "Kimi", label: "Kimi / available / kimi-for-coding" }],
  )
})

test("unavailableProviderOptions reports only the selected runtime family", () => {
  assert.deepEqual(
    unavailableProviderOptions([], { runtime: "codex" }),
    [{ value: "Codex", label: "Codex (not detected on selected computer)" }],
  )
  assert.deepEqual(
    unavailableProviderOptions([{ value: "Kimi", label: "Kimi / available / kimi-for-coding" }], { runtime: "claude_code" }),
    [],
  )
})

test("runtimeOptionsFromDetected marks codex unavailable when not detected", () => {
  // 本机只检测到 claude_code，没装 codex
  const onlyClaude: Computer[] = [{
    id: "c1",
    name: "c1",
    status: "online",
    detectedRuntimes: [{ type: "claude_code", status: "available" }],
    agentWorkspaces: [],
  }]
  const opts = runtimeOptionsFromDetected(onlyClaude)
  const codex = opts.find((o) => o.value === "codex")
  const claude = opts.find((o) => o.value === "claude_code")
  assert.equal(codex?.available, false, "codex 未检测到应不可选")
  assert.equal(claude?.available, true, "claude_code 检测到应可选")
})

test("runtimeOptionsFromDetected always offers bundled Pi with bundled flag", () => {
  // 本机什么都没装
  const empty: Computer[] = [{
    id: "c1",
    name: "c1",
    status: "online",
    detectedRuntimes: [],
    agentWorkspaces: [],
  }]
  const opts = runtimeOptionsFromDetected(empty)
  const pi = opts.find((o) => o.value === "pi")
  assert.equal(pi?.available, true, "bundled Pi 恒可选")
  assert.equal(pi?.bundled, true, "bundled Pi 应带 bundled 标识")
})

test("runtimeOptionsFromDetected reflects detected bundled Pi and keeps others grey", () => {
  // daemon 上报了 bundled Pi
  const withPi: Computer[] = [{
    id: "c1",
    name: "c1",
    status: "online",
    detectedRuntimes: [{ type: "pi", status: "available", source: "bundled", version: "0.73.1" }],
    agentWorkspaces: [],
  }]
  const opts = runtimeOptionsFromDetected(withPi)
  const pi = opts.find((o) => o.value === "pi")
  assert.equal(pi?.bundled, true)
  assert.equal(pi?.available, true)
  // codex 仍然不可选
  assert.equal(opts.find((o) => o.value === "codex")?.available, false)
})

test("runtimeOptionsFromDetected respects computerId filter", () => {
  const two: Computer[] = [
    { id: "a", name: "a", status: "online", detectedRuntimes: [{ type: "codex", status: "available" }], agentWorkspaces: [] },
    { id: "b", name: "b", status: "online", detectedRuntimes: [], agentWorkspaces: [] },
  ]
  // 只看 computer a：codex 可选
  const fromA = runtimeOptionsFromDetected(two, { computerId: "a" })
  assert.equal(fromA.find((o) => o.value === "codex")?.available, true)
  // 只看 computer b：codex 不可选
  const fromB = runtimeOptionsFromDetected(two, { computerId: "b" })
  assert.equal(fromB.find((o) => o.value === "codex")?.available, false)
})
