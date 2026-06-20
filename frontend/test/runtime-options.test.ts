import assert from "node:assert/strict"
import test from "node:test"

import { detectedProviderOptions, unavailableProviderOptions } from "../lib/runtime-options"
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
