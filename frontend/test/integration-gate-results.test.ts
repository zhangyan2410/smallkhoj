import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  INTEGRATION_GATE_MODES,
  readIntegrationGateResult,
  readIntegrationGateResults,
  resolveIntegrationGateResultRoot,
} from "../lib/integration-gate-results"

const MODES = [
  "foundation-only",
  "chat-reply-channel-base",
  "chat-reply-channel-group",
  "chat-reply-dm",
  "collab-channel-v1",
  "collab-channel-v2",
  "collab-channel-v3",
]

function withResultRoot(run: (root: string) => void) {
  const root = mkdtempSync(path.join(tmpdir(), "smallkhoj-gate-results-"))
  mkdirSync(path.join(root, "latest"), { recursive: true })
  try {
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeReport(root: string, mode: string, report: Record<string, unknown>) {
  writeFileSync(path.join(root, "latest", `${mode}.json`), JSON.stringify(report), "utf8")
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    mode: "foundation-only",
    runId: "foundation-only-test-run",
    ok: true,
    startedAt: "2026-07-29T01:00:00.000Z",
    completedAt: "2026-07-29T01:00:04.000Z",
    target: { serverId: "server-1", apiBase: "http://localhost:8000" },
    summary: { passed: 2, total: 2, failed: 0 },
    steps: [
      { id: "frontend", label: "Frontend ready", status: "pass", evidence: { online: true } },
      { id: "backend", label: "Backend ready", status: "pass", evidence: { online: true } },
    ],
    ...overrides,
  }
}

test("integration gate reader exposes exactly the seven supported modes", () => {
  assert.deepEqual([...INTEGRATION_GATE_MODES], MODES)

  withResultRoot((root) => {
    const results = readIntegrationGateResults({ root, now: new Date("2026-07-29T01:01:00.000Z") })
    assert.deepEqual(results.map((item) => item.mode), MODES)
  })
})

test("default result root stays outside the frontend source tree", () => {
  assert.equal(
    resolveIntegrationGateResultRoot({ cwd: "/work/smallkhoj/frontend", env: {} }),
    "/work/smallkhoj/.runtime/integration-gate",
  )
  assert.equal(
    resolveIntegrationGateResultRoot({
      cwd: "/work/smallkhoj/frontend",
      env: { SMALLKHOJ_GATE_RESULT_DIR: "/var/run/smallkhoj/gates" },
    }),
    "/var/run/smallkhoj/gates",
  )
})

test("valid latest report is projected into a bounded display model", () => {
  withResultRoot((root) => {
    writeReport(root, "foundation-only", report())
    const result = readIntegrationGateResult("foundation-only", {
      root,
      now: new Date("2026-07-29T01:01:00.000Z"),
    })

    assert.equal(result.state, "passed")
    assert.equal(result.summary?.passed, 2)
    assert.equal(result.summary?.total, 2)
    assert.equal(result.durationMs, 4_000)
    assert.equal(result.target?.serverId, "server-1")
    assert.equal(result.steps.length, 2)
  })
})

test("an unfinished persisted report is labeled running", () => {
  withResultRoot((root) => {
    writeReport(root, "foundation-only", report({
      ok: undefined,
      status: "running",
      completedAt: null,
      summary: { passed: 1, total: 2, failed: 0 },
    }))
    const result = readIntegrationGateResult("foundation-only", { root })
    assert.equal(result.state, "running")
    assert.equal(result.outcome, "running")
  })
})

test("missing, malformed, oversized, and stale reports are explicit states", () => {
  withResultRoot((root) => {
    assert.equal(readIntegrationGateResult("foundation-only", { root }).state, "missing")

    writeFileSync(path.join(root, "latest", "foundation-only.json"), "{bad-json", "utf8")
    assert.equal(readIntegrationGateResult("foundation-only", { root }).state, "invalid")

    writeFileSync(path.join(root, "latest", "foundation-only.json"), "x".repeat(2_048), "utf8")
    assert.equal(
      readIntegrationGateResult("foundation-only", { root, maxBytes: 1_024 }).reason,
      "REPORT_TOO_LARGE",
    )

    writeReport(root, "foundation-only", report())
    const stale = readIntegrationGateResult("foundation-only", {
      root,
      now: new Date("2026-07-30T01:00:00.000Z"),
      staleAfterMs: 60_000,
    })
    assert.equal(stale.state, "stale")
    assert.equal(stale.outcome, "passed")
  })
})

test("unknown modes and traversal input are rejected before filesystem access", () => {
  assert.throws(() => readIntegrationGateResult("../../secrets" as never), /Unsupported integration gate mode/)
  assert.throws(() => readIntegrationGateResult("foundation-only.json" as never), /Unsupported integration gate mode/)
})

test("untrusted evidence and failure text cannot expose credential-shaped values", () => {
  withResultRoot((root) => {
    writeReport(root, "foundation-only", report({
      ok: false,
      target: {
        serverId: "server-1",
        authorization: "Bearer top-secret",
        accountToken: "sk_account_should-not-render",
      },
      summary: { passed: 0, total: 1, failed: 1 },
      failure: {
        category: "auth",
        code: "LOGIN_FAILED",
        message: "Bearer top-secret sk_public_should-not-render",
      },
      steps: [{
        id: "login",
        label: "Login",
        status: "failed",
        evidence: { authorization: "Bearer top-secret", cookie: "session=secret" },
      }],
    }))

    const result = readIntegrationGateResult("foundation-only", { root })
    const visible = JSON.stringify(result)
    assert.doesNotMatch(visible, /top-secret|should-not-render|session=secret/)
    assert.match(visible, /\[REDACTED\]/)
  })
})

test("gate control route composes ProductShell and preserves the existing integration console", () => {
  const route = readFileSync(path.join(process.cwd(), "app/(app)/control/gates/page.tsx"), "utf8")
  const consoleComponent = readFileSync(path.join(process.cwd(), "components/integration-gate-console.tsx"), "utf8")
  const existingControl = readFileSync(path.join(process.cwd(), "app/(app)/control/integration/page.tsx"), "utf8")

  assert.match(route, /<ProductShell/)
  assert.match(route, /readIntegrationGateResults/)
  assert.match(consoleComponent, /data-region="integration-gate-summary"/)
  assert.match(consoleComponent, /data-region="integration-gate-modes"/)
  assert.match(route, /href="\/control\/integration"/)
  assert.match(existingControl, /TaskRun 时间线/)
})

test("gate control copy is complete in English and Chinese", () => {
  for (const locale of ["en", "zh-CN"]) {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8"))
    const copy = messages.integrationGate
    assert.equal(typeof copy.title, "string", locale)
    assert.equal(typeof copy.sidebar.safeExample, "string", locale)
    assert.equal(Object.keys(copy.modes).length, 7, locale)
    assert.deepEqual(Object.keys(copy.states).sort(), ["failed", "invalid", "missing", "passed", "running", "stale"], locale)
  }
})
