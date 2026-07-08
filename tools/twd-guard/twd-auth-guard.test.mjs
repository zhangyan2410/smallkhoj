import test from "node:test"
import assert from "node:assert/strict"

import {
  assertTargetResult,
  config,
  normalizeTarget,
  parsePortCandidates,
  parseLastJson,
  selectLocalTab,
  urlMatchForTarget,
} from "./twd-auth-guard.mjs"

test("normalizeTarget accepts local paths", () => {
  const url = normalizeTarget("/tasks?view=board", "http://127.0.0.1:3000")

  assert.equal(url.href, "http://127.0.0.1:3000/tasks?view=board")
})

test("urlMatchForTarget narrows to host plus pathname", () => {
  const url = normalizeTarget("/chat/all?thread=abc", "http://127.0.0.1:3000")

  assert.equal(urlMatchForTarget(url), "127.0.0.1:3000/chat/all?thread=abc")
})

test("urlMatchForTarget preserves encoded dynamic route suffixes", () => {
  const url = normalizeTarget(
    "/chat/dm%3A1b5c6c75-cd6e-4257-9bdb-ee59168ab097-784c1903-7a22-4e01-b5d8-044a92730ff7",
    "http://127.0.0.1:3000",
  )

  assert.equal(
    urlMatchForTarget(url),
    "127.0.0.1:3000/chat/dm%3A1b5c6c75-cd6e-4257-9bdb-ee59168ab097-784c1903-7a22-4e01-b5d8-044a92730ff7",
  )
})

test("parseLastJson ignores WebDriver connection logs", () => {
  const parsed = parseLastJson("New tab connected: http://127.0.0.1:3000/login\n{\"ok\":true,\"count\":1}\n")

  assert.deepEqual(parsed, { ok: true, count: 1 })
})

test("config leaves twdPort unset so ./twd can auto-discover", () => {
  const oldPort = process.env.TWD_PORT
  const oldCandidates = process.env.TWD_PORT_CANDIDATES
  delete process.env.TWD_PORT
  delete process.env.TWD_PORT_CANDIDATES
  try {
    assert.equal(config().twdPort, null)
    assert.deepEqual(config().twdPortCandidates, [28765, 18765])
  } finally {
    if (oldPort === undefined) delete process.env.TWD_PORT
    else process.env.TWD_PORT = oldPort
    if (oldCandidates === undefined) delete process.env.TWD_PORT_CANDIDATES
    else process.env.TWD_PORT_CANDIDATES = oldCandidates
  }
})

test("config allows TWD_PORT override", () => {
  const oldPort = process.env.TWD_PORT
  process.env.TWD_PORT = "18765"
  try {
    assert.equal(config().twdPort, 18765)
  } finally {
    if (oldPort === undefined) delete process.env.TWD_PORT
    else process.env.TWD_PORT = oldPort
  }
})

test("parsePortCandidates accepts comma separated discovery order", () => {
  assert.deepEqual(parsePortCandidates("39000, 39010"), [39000, 39010])
})

test("selectLocalTab prefers a target tab when present", () => {
  const selection = selectLocalTab({
    tabs: [
      { id: "1", url: "http://127.0.0.1:3000/login" },
      { id: "2", url: "http://127.0.0.1:3000/tasks" },
    ],
    frontendBase: "http://127.0.0.1:3000",
    targetUrl: normalizeTarget("/tasks", "http://127.0.0.1:3000"),
  })

  assert.deepEqual(selection.args, ["--url-match", "127.0.0.1:3000/tasks"])
})

test("selectLocalTab uses login when target is absent", () => {
  const selection = selectLocalTab({
    tabs: [{ id: "1", url: "http://127.0.0.1:3000/login" }],
    frontendBase: "http://127.0.0.1:3000",
    targetUrl: normalizeTarget("/tasks", "http://127.0.0.1:3000"),
  })

  assert.deepEqual(selection.args, ["--url-match", "127.0.0.1:3000/login"])
})

test("selectLocalTab uses the current URL instead of a fixed tab id for a single local tab", () => {
  const selection = selectLocalTab({
    tabs: [{ id: "1", url: "http://127.0.0.1:3000/chat/all" }],
    frontendBase: "http://127.0.0.1:3000",
    targetUrl: normalizeTarget("/tasks", "http://127.0.0.1:3000"),
  })

  assert.deepEqual(selection.args, ["--url-match", "127.0.0.1:3000/chat/all"])
})

test("selectLocalTab rejects ambiguous local tabs", () => {
  assert.throws(
    () =>
      selectLocalTab({
        tabs: [
          { id: "1", url: "http://127.0.0.1:3000/computers" },
          { id: "2", url: "http://127.0.0.1:3000/members" },
        ],
        frontendBase: "http://127.0.0.1:3000",
        targetUrl: normalizeTarget("/tasks", "http://127.0.0.1:3000"),
      }),
    /Ambiguous local frontend tabs/,
  )
})

test("assertTargetResult rejects login redirects", () => {
  const target = normalizeTarget("/tasks", "http://127.0.0.1:3000")

  assert.throws(() => assertTargetResult({ pathname: "/login", search: "" }, target), /Expected \/tasks/)
})
