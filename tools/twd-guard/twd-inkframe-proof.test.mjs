import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  INKFRAME_SELECTOR_CHECKS,
  PRODUCT_SHELL_PROOF_ROUTES,
  REQUIRED_SELECTOR_GROUPS,
  buildDomCountScript,
  buildTwdTabsCommand,
  classifyTabsResult,
  parseTwdTabsCommandResult,
  resolveEvidencePaths,
} from "./twd-inkframe-proof.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../..")

test("classifyTabsResult marks an empty compact tabs payload as blocked_no_tab", () => {
  assert.equal(classifyTabsResult({ ok: true, tabs: [], count: 0 }), "blocked_no_tab")
})

test("classifyTabsResult preserves explicit twd no-tab errors as blocked_no_tab", () => {
  assert.equal(classifyTabsResult({ ok: false, code: "NO_TAB", error: "No connected tab" }), "blocked_no_tab")
})

test("classifyTabsResult distinguishes connected tabs from failed twd payloads", () => {
  assert.equal(classifyTabsResult({ ok: true, tabs: [{ id: 1, url: "http://127.0.0.1:3000/chat" }] }), "ready")
  assert.equal(classifyTabsResult({ ok: false, error: "bridge unavailable" }), "failed_twd")
})

test("parseTwdTabsCommandResult preserves no-tab payloads even when ./twd exits nonzero", () => {
  const parsed = parseTwdTabsCommandResult({
    status: 2,
    stdout: '{"ok": true, "tabs": [], "count": 0}\n',
    stderr: "",
  })

  assert.deepEqual(parsed, { ok: true, tabs: [], count: 0 })
  assert.equal(classifyTabsResult(parsed), "blocked_no_tab")
})

test("parseTwdTabsCommandResult preserves pretty no-tab error payloads", () => {
  const parsed = parseTwdTabsCommandResult({
    status: 1,
    stdout: '{\n  "ok": false,\n  "code": "NO_TAB",\n  "message": "No connected tab"\n}\n',
    stderr: "",
  })

  assert.deepEqual(parsed, { ok: false, code: "NO_TAB", message: "No connected tab" })
  assert.equal(classifyTabsResult(parsed), "blocked_no_tab")
})

test("selector manifest covers every required Inkframe proof group", () => {
  const groups = new Set(INKFRAME_SELECTOR_CHECKS.map((check) => check.group))

  assert.deepEqual([...REQUIRED_SELECTOR_GROUPS].sort(), [
    "chat-desktop",
    "chat-mobile",
    "chat-unread",
    "material-state",
    "product-shell",
    "task-desktop",
    "task-mobile",
  ])

  for (const group of REQUIRED_SELECTOR_GROUPS) {
    assert.equal(groups.has(group), true, `missing selector group: ${group}`)
  }
})

test("product shell proof routes cover the user-facing Inkframe shell pages", () => {
  assert.deepEqual([...PRODUCT_SHELL_PROOF_ROUTES].sort(), [
    "/chat",
    "/computers",
    "/members",
    "/settings",
    "/tasks",
  ])
})

test("product shell proof routes assert background owner, tint, and pointer contract", () => {
  const requiredSelectors = [
    ['[data-inkframe-surface="app-background"]', "shell background"],
    ['[data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]', "shell owner"],
    ['[data-inkframe-region="app-background"][data-inkframe-tint="desk"]', "desk tint"],
    ['[data-inkframe-surface="app-background"][data-inkframe-pointer-capture="false"]', "default pointer capture"],
    [
      '[data-inkframe-surface="app-background"][data-inkframe-background-source-mode="none"]',
      "default background source mode",
    ],
    [
      '[data-inkframe-contrast-owner="workbench-header"][data-inkframe-foreground-surface="header-paper"]',
      "header foreground contrast",
    ],
    [
      '[data-inkframe-contrast-owner="main-panel"][data-inkframe-foreground-surface="paper-field"]',
      "main foreground contrast",
    ],
    [
      '[data-inkframe-surface="material"][data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]',
      "inner material owner",
    ],
    [
      '[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-tint="desk"]',
      "inner material tint",
    ],
    [
      '[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-mode="static"]',
      "inner material static mode",
    ],
    [
      '[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-pointer-capture="false"]',
      "inner material pointer capture",
    ],
  ]

  for (const route of PRODUCT_SHELL_PROOF_ROUTES) {
    const routeChecks = INKFRAME_SELECTOR_CHECKS.filter((check) => check.group === "product-shell" && check.route === route)

    for (const [selector, label] of requiredSelectors) {
      const check = routeChecks.find((candidate) => candidate.selector === selector)
      assert.ok(check, `${route} must check ${label}`)
      assert.equal(check.minCount, 1, `${route} ${label} must require a visible DOM match`)
    }
  }
})

test("selector manifest uses stable data-inkframe contracts rather than class names", () => {
  for (const check of INKFRAME_SELECTOR_CHECKS) {
    assert.match(check.selector, /\[data-inkframe-/)
    assert.equal(check.selector.includes("."), false, `${check.label} should not use class selectors`)
    assert.equal(check.selector.includes("#"), false, `${check.label} should not use id selectors`)
    assert.ok(
      check.route === "/chat" || check.route === "/tasks" || PRODUCT_SHELL_PROOF_ROUTES.includes(check.route),
      `${check.label} route must be product proof route`,
    )
  }
})

test("resolveEvidencePaths keeps generated proof files under the task evidence directory", () => {
  const taskDir = resolve(ROOT, ".trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner")
  const paths = resolveEvidencePaths(taskDir)

  assert.equal(relative(taskDir, paths.evidenceDir).startsWith(".."), false)
  assert.equal(relative(taskDir, paths.jsonPath).startsWith(".."), false)
  assert.equal(relative(taskDir, paths.markdownPath).startsWith(".."), false)
  assert.equal(paths.jsonPath.endsWith("evidence/twd-inkframe-proof.json"), true)
  assert.equal(paths.markdownPath.endsWith("evidence/twd-inkframe-proof.md"), true)
})

test("buildTwdTabsCommand uses the project twd wrapper", () => {
  assert.deepEqual(buildTwdTabsCommand(), ["./twd", "--compact", "tabs"])
})

test("DOM count script returns selector counts without external browser frameworks", () => {
  const script = buildDomCountScript([
    {
      group: "product-shell",
      label: "background",
      selector: '[data-inkframe-surface="app-background"]',
      minCount: 1,
      route: "/chat",
    },
  ])

  assert.match(script, /querySelectorAll/)
  assert.match(script, /scrollWidth/)
  assert.doesNotMatch(script, /playwright/i)
})

test("runner source does not call forbidden browser launch or external e2e tools", () => {
  const source = [
    readFileSync(resolve(HERE, "twd-inkframe-proof.mjs"), "utf8"),
    readFileSync(resolve(HERE, "twd-auth-guard.mjs"), "utf8"),
  ].join("\n")
  const forbidden = new RegExp(["play", "wright"].join(""), "i")

  assert.doesNotMatch(source, forbidden)
  assert.doesNotMatch(source, /\bchrome\b.*\b(open|launch|start)/i)
  assert.doesNotMatch(source, /\bopen\b.*\b-a\b.*\bChrome\b/i)
})
