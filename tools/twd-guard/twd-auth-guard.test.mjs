import test from "node:test"
import assert from "node:assert/strict"

import * as authGuard from "./twd-auth-guard.mjs"
import {
  assertTargetResult,
  config,
  normalizeTarget,
  parsePortCandidates,
  parseLastJson,
  selectLocalTab,
  urlMatchForTarget,
} from "./twd-auth-guard.mjs"

function bridgeAccountSession(options) {
  assert.equal(typeof authGuard.bridgeAccountSession, "function")
  return authGuard.bridgeAccountSession(options)
}

test("trusted bridge auth fails closed before fetch when AUTH_BRIDGE_SECRET is absent", async () => {
  let fetched = false

  await assert.rejects(
    bridgeAccountSession({
      accountName: "reviewer",
      apiBase: "http://localhost:8000",
      publicKey: "public-test-key",
      authBridgeSecret: null,
      fetchImpl: async () => {
        fetched = true
        throw new Error("must not fetch")
      },
    }),
    /AUTH_BRIDGE_SECRET is required/,
  )

  assert.equal(fetched, false)
})

test("trusted bridge auth sends the secret only in the bridge header", async () => {
  const secret = "bridge-secret-must-not-leak"
  let captured

  const token = await bridgeAccountSession({
    accountName: "reviewer",
    apiBase: "http://localhost:8000",
    publicKey: "public-test-key",
    authBridgeSecret: secret,
    fetchImpl: async (url, options) => {
      captured = { url, options }
      return {
        ok: true,
        async json() {
          return { sessionToken: "sk_session_from_bridge" }
        },
      }
    },
  })

  assert.equal(token, "sk_session_from_bridge")
  assert.equal(captured.url, "http://localhost:8000/api/v1/auth/better-auth/bridge")
  assert.equal(captured.options.headers["X-Auth-Bridge-Secret"], secret)
  assert.equal(captured.options.headers["X-Public-Key"], "public-test-key")
  assert.deepEqual(JSON.parse(captured.options.body), {
    userId: "twd:reviewer",
    name: "reviewer",
  })
  assert.equal(captured.url.includes(secret), false)
  assert.equal(captured.options.body.includes(secret), false)
})

test("trusted bridge auth can return the current Server context for cookie isolation", async () => {
  const context = await bridgeAccountSession({
    accountName: "reviewer",
    apiBase: "http://localhost:8000",
    publicKey: "public-test-key",
    authBridgeSecret: "bridge-test-secret",
    includeContext: true,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          sessionToken: "sk_session_from_bridge",
          server: { id: "server-current" },
        }
      },
    }),
  })

  assert.deepEqual(context, {
    sessionToken: "sk_session_from_bridge",
    serverId: "server-current",
  })
})

test("trusted bridge auth errors never echo a secret-bearing response", async () => {
  const secret = "bridge-secret-must-not-leak"

  await assert.rejects(
    bridgeAccountSession({
      accountName: "reviewer",
      apiBase: "http://localhost:8000",
      publicKey: "public-test-key",
      authBridgeSecret: secret,
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        async text() {
          return `unexpected echo ${secret}`
        },
      }),
    }),
    (error) => {
      assert.match(error.message, /HTTP 401/)
      assert.equal(error.message.includes(secret), false)
      return true
    },
  )
})

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

test("selectLocalTab resolves a target tab once and returns an exact-tab selection", () => {
  const selection = selectLocalTab({
    tabs: [
      { id: "1", url: "http://127.0.0.1:3000/login" },
      { id: "2", url: "http://127.0.0.1:3000/tasks" },
    ],
    frontendBase: "http://127.0.0.1:3000",
    targetUrl: normalizeTarget("/tasks", "http://127.0.0.1:3000"),
  })

  assert.deepEqual(selection.args, ["--tab", "2"])
  assert.equal(selection.tabId, "2")
})

test("selectLocalTab uses login when target is absent", () => {
  const selection = selectLocalTab({
    tabs: [{ id: "1", url: "http://127.0.0.1:3000/login" }],
    frontendBase: "http://127.0.0.1:3000",
    targetUrl: normalizeTarget("/tasks", "http://127.0.0.1:3000"),
  })

  assert.deepEqual(selection.args, ["--tab", "1"])
})

test("selectLocalTab uses the current URL instead of a fixed tab id for a single local tab", () => {
  const selection = selectLocalTab({
    tabs: [{ id: "1", url: "http://127.0.0.1:3000/chat/all" }],
    frontendBase: "http://127.0.0.1:3000",
    targetUrl: normalizeTarget("/tasks", "http://127.0.0.1:3000"),
  })

  assert.deepEqual(selection.args, ["--tab", "1"])
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

  assert.throws(() => assertTargetResult({ pathname: "/login", search: "" }, target), /Expected .*\/tasks/)
})

test("assertTargetResult rejects a matching path on the wrong origin", () => {
  const target = normalizeTarget("/members", "http://127.0.0.1:3000")

  assert.throws(
    () => assertTargetResult({ href: "http://124.222.40.40/members" }, target),
    /127\.0\.0\.1:3000\/members/,
  )
})

test("assertTargetResult rejects unexpected query and hash components", () => {
  const target = normalizeTarget("/members", "http://127.0.0.1:3000")

  assert.throws(
    () => assertTargetResult({ href: "http://127.0.0.1:3000/members?stale=1" }, target),
    /stale=1/,
  )
  assert.throws(
    () => assertTargetResult({ href: "http://127.0.0.1:3000/members#stale" }, target),
    /#stale/,
  )
})

test("exact-tab open polls stale navigation state until the target is ready", async () => {
  const exactTabId = "approved-local-tab"
  const calls = []
  let probeCount = 0

  const result = await authGuard.openTargetOnExactTab("/tasks", exactTabId, {
    frontendBase: "http://127.0.0.1:38181",
    twdWait: "1",
    navigationTimeoutMs: 50,
    navigationPollIntervalMs: 0,
    sleepImpl: async () => {},
    ensureTwdServeImpl: async () => {},
    bridgeAccountSessionImpl: async () => "session-from-bridge",
    runTwdImpl(args) {
      calls.push(args)
      const command = args[1]
      const script = args.at(-1)
      if (command === "goto") return { ok: true, tabId: exactTabId }
      if (command === "eval" && script.includes("const cookieName")) {
        return { ok: true, tabId: exactTabId, result: { hasCookie: true } }
      }
      probeCount += 1
      const path = probeCount < 3 ? "/members" : "/tasks"
      return {
        ok: true,
        tabId: exactTabId,
        result: {
          href: `http://127.0.0.1:38181${path}`,
          origin: "http://127.0.0.1:38181",
          pathname: path,
          search: "",
          hash: "",
          readyState: "complete",
        },
      }
    },
  })

  assert.equal(result.result.pathname, "/tasks")
  assert.equal(probeCount, 3)
  assert.ok(calls.every((args) => args.includes("--tab") && args.includes(exactTabId)))
})

test("exact-tab open rejects a stale same-origin page after the bounded poll", async () => {
  const exactTabId = "approved-local-tab"
  const calls = []
  let probeCount = 0

  await assert.rejects(
    authGuard.openTargetOnExactTab("/tasks", exactTabId, {
      frontendBase: "http://127.0.0.1:38181",
      twdWait: "1",
      navigationTimeoutMs: 20,
      navigationPollIntervalMs: 1,
      sleepImpl: async () => new Promise((resolve) => setTimeout(resolve, 5)),
      ensureTwdServeImpl: async () => {},
      bridgeAccountSessionImpl: async () => "session-from-bridge",
      runTwdImpl(args) {
        calls.push(args)
        const command = args[1]
        const script = args.at(-1)
        if (command === "goto") return { ok: true, tabId: exactTabId }
        if (command === "eval" && script.includes("const cookieName")) {
          return { ok: true, tabId: exactTabId, result: { hasCookie: true } }
        }
        probeCount += 1
        return {
          ok: true,
          tabId: exactTabId,
          result: {
            href: "http://127.0.0.1:38181/members",
            origin: "http://127.0.0.1:38181",
            pathname: "/members",
            search: "",
            hash: "",
            readyState: "complete",
          },
        }
      },
    }),
    /browser is at http:\/\/127\.0\.0\.1:38181\/members/,
  )

  assert.ok(probeCount >= 2)
  assert.ok(calls.every((args) => args.includes("--tab") && args.includes(exactTabId)))
  assert.ok(calls.every((args) => !args.includes("tabs") && !args.includes("--url-match")))
})

test("exact-tab open recovers a browser error page before cookie injection", async () => {
  const exactTabId = "approved-local-tab"
  const calls = []
  const navigatedTargets = []
  let cookieAttempt = 0
  let currentHref = "chrome-error://chromewebdata/"
  let currentOrigin = "null"
  let currentPath = "/"

  const result = await authGuard.openTargetOnExactTab("/tasks", exactTabId, {
    frontendBase: "http://127.0.0.1:38181",
    twdWait: "1",
    navigationTimeoutMs: 20,
    navigationPollIntervalMs: 0,
    sleepImpl: async () => {},
    ensureTwdServeImpl: async () => {},
    bridgeAccountSessionImpl: async () => "session-from-bridge",
    runTwdImpl(args) {
      calls.push(args)
      const command = args[1]
      const script = args.at(-1)
      if (command === "goto") {
        const target = new URL(script)
        currentHref = target.href
        currentOrigin = target.origin
        currentPath = target.pathname
        navigatedTargets.push(target.href)
        return { ok: true, tabId: exactTabId, tabUrl: target.href }
      }
      if (command === "eval" && script.includes("const cookieName")) {
        cookieAttempt += 1
        if (currentOrigin !== "http://127.0.0.1:38181") {
          return {
            ok: true,
            tabId: exactTabId,
            tabUrl: currentHref,
            result: {
              href: currentHref,
              origin: currentOrigin,
              hasCookie: false,
              needsFrontendNavigation: true,
            },
          }
        }
        return { ok: true, tabId: exactTabId, result: { hasCookie: true } }
      }
      if (command === "eval") {
        return {
          ok: true,
          tabId: exactTabId,
          result: {
            href: currentHref,
            origin: currentOrigin,
            pathname: currentPath,
            search: "",
            hash: "",
            readyState: "complete",
          },
        }
      }
      throw new Error(`Unexpected mock command: ${args.join(" ")}`)
    },
  })

  assert.equal(result.result.pathname, "/tasks")
  assert.equal(cookieAttempt, 1)
  assert.deepEqual(navigatedTargets, [
    "http://127.0.0.1:38181/login",
    "http://127.0.0.1:38181/tasks",
  ])
  assert.ok(calls.every((args) => args.includes("--tab") && args.includes(exactTabId)))
})

test("foreign-origin login never triggers a trusted re-auth retry", async () => {
  let bridgeCount = 0

  await assert.rejects(
    authGuard.openTargetOnExactTab("/tasks", "approved-local-tab", {
      frontendBase: "http://127.0.0.1:38181",
      twdWait: "1",
      navigationTimeoutMs: 0,
      navigationPollIntervalMs: 0,
      sleepImpl: async () => {},
      ensureTwdServeImpl: async () => {},
      bridgeAccountSessionImpl: async () => {
        bridgeCount += 1
        return "session-from-bridge"
      },
      runTwdImpl(args) {
        const command = args[1]
        const script = args.at(-1)
        if (command === "goto") return { ok: true, tabId: "approved-local-tab" }
        if (command === "eval" && script.includes("const cookieName")) {
          return { ok: true, tabId: "approved-local-tab", result: { hasCookie: true } }
        }
        return {
          ok: true,
          tabId: "approved-local-tab",
          result: {
            href: "http://124.222.40.40/login",
            origin: "http://124.222.40.40",
            pathname: "/login",
            search: "",
            hash: "",
            readyState: "complete",
          },
        }
      },
    }),
    /browser is at http:\/\/124\.222\.40\.40\/login/,
  )

  assert.equal(bridgeCount, 0)
})

test("exact-tab open never enumerates or URL-matches tabs, including login retry", async () => {
  assert.equal(typeof authGuard.openTargetOnExactTab, "function")

  const exactTabId = "approved-local-tab"
  const calls = []
  let probeCount = 0
  let bridgeCount = 0

  const result = await authGuard.openTargetOnExactTab("/tasks", exactTabId, {
    frontendBase: "http://127.0.0.1:38181",
    apiBase: "http://127.0.0.1:38182",
    publicKey: "public-test-key",
    authBridgeSecret: "bridge-test-secret",
    accountName: "reviewer",
    twdWait: "1",
    ensureTwdServeImpl: async () => {},
    bridgeAccountSessionImpl: async () => {
      bridgeCount += 1
      return { sessionToken: "session-from-bridge", serverId: "server-current" }
    },
    runTwdImpl(args) {
      calls.push(args)
      assert.equal(args.includes("tabs"), false)
      assert.equal(args.includes("--url-match"), false)
      assert.deepEqual(args.slice(args.indexOf("--tab"), args.indexOf("--tab") + 2), ["--tab", exactTabId])

      const command = args[1]
      const script = args.at(-1)
      if (command === "goto") return { ok: true, tabId: exactTabId, tabUrl: "http://127.0.0.1:38181/tasks" }
      if (command === "eval" && script.includes("const cookieName")) {
        assert.equal(script.includes("smallkhoj_active_server"), true)
        assert.equal(script.includes("server-current"), true)
        return {
          ok: true,
          tabId: exactTabId,
          tabUrl: "http://127.0.0.1:38181/login",
          result: { hasCookie: true, pathname: "/login", search: "" },
        }
      }
      if (command === "eval") {
        probeCount += 1
        const pathname = probeCount < 4 ? "/login" : "/tasks"
        return {
          ok: true,
          tabId: exactTabId,
          tabUrl: `http://127.0.0.1:38181${pathname}`,
          result: { href: `http://127.0.0.1:38181${pathname}`, pathname, search: "", title: "SmallKhoj" },
        }
      }
      throw new Error(`Unexpected mock command: ${args.join(" ")}`)
    },
  })

  assert.equal(result.tabId, exactTabId)
  assert.equal(result.result.pathname, "/tasks")
  assert.equal(bridgeCount, 2)
  assert.equal(probeCount, 4)
  assert.equal(calls.filter((args) => args[1] === "goto").length, 2)
  assert.ok(calls.length > 0)
  assert.ok(calls.every((args) => args.includes("--tab") && args.includes(exactTabId)))
})

test("legacy open discovers once then pins every operation to the selected exact tab", async () => {
  const exactTabId = "legacy-selected-tab"
  let discoveryCount = 0
  const calls = []

  const result = await authGuard.openTarget("/tasks", {
    frontendBase: "http://127.0.0.1:38181",
    twdWait: "1",
    ensureTwdServeImpl: async () => {},
    getTabsImpl() {
      discoveryCount += 1
      return [{ id: exactTabId, url: "http://127.0.0.1:38181/members" }]
    },
    bridgeAccountSessionImpl: async () => "session-from-bridge",
    runTwdImpl(args) {
      calls.push(args)
      assert.equal(args.includes("tabs"), false)
      assert.equal(args.includes("--url-match"), false)
      assert.deepEqual(args.slice(args.indexOf("--tab"), args.indexOf("--tab") + 2), ["--tab", exactTabId])
      const command = args[1]
      const script = args.at(-1)
      if (command === "goto") return { ok: true, tabId: exactTabId }
      if (command === "eval" && script.includes("const cookieName")) {
        return { ok: true, tabId: exactTabId, result: { hasCookie: true } }
      }
      return {
        ok: true,
        tabId: exactTabId,
        result: {
          href: "http://127.0.0.1:38181/tasks",
          origin: "http://127.0.0.1:38181",
          pathname: "/tasks",
          search: "",
          hash: "",
          readyState: "complete",
        },
      }
    },
  })

  assert.equal(result.tabId, exactTabId)
  assert.equal(discoveryCount, 1)
  assert.ok(calls.length >= 3)
})

test("guard CLI extracts one exact tab option before the open target", () => {
  assert.equal(typeof authGuard.parseGuardTabOption, "function")
  assert.deepEqual(authGuard.parseGuardTabOption(["--tab", "approved-local-tab", "/tasks"]), {
    tabId: "approved-local-tab",
    positionals: ["/tasks"],
  })
  assert.throws(() => authGuard.parseGuardTabOption(["--tab", "", "/tasks"]), /non-empty value/)
  assert.throws(
    () => authGuard.parseGuardTabOption(["--tab", "one", "--tab", "two", "/tasks"]),
    /only be supplied once/,
  )
})

test("exact-tab open rejects a WebDriver response from another tab", async () => {
  await assert.rejects(
    authGuard.openTargetOnExactTab("/tasks", "approved-local-tab", {
      frontendBase: "http://127.0.0.1:38181",
      twdWait: "1",
      ensureTwdServeImpl: async () => {},
      bridgeAccountSessionImpl: async () => "session-from-bridge",
      runTwdImpl(args) {
        const script = args.at(-1)
        if (!script.includes("const cookieName")) {
          return {
            ok: true,
            tabId: "approved-local-tab",
            result: {
              href: "http://127.0.0.1:38181/login",
              origin: "http://127.0.0.1:38181",
              pathname: "/login",
              search: "",
              hash: "",
              readyState: "complete",
            },
          }
        }
        return {
          ok: true,
          tabId: "unexpected-tab",
          result: { hasCookie: true, pathname: "/login", search: "" },
        }
      },
    }),
    /cookie injection returned unexpected-tab; expected approved-local-tab/,
  )
})

test("auth-only rejects a cookie injection response from another tab", async () => {
  const exactTabId = "approved-local-tab"

  await assert.rejects(
    authGuard.authOnly("reviewer", {
      frontendBase: "http://127.0.0.1:38181",
      twdWait: "1",
      ensureTwdServeImpl: async () => {},
      getTabsImpl: () => [{ id: exactTabId, url: "http://127.0.0.1:38181/login" }],
      ensureAuthOnSelectionImpl: async (selection) => {
        assert.equal(selection.tabId, exactTabId)
        return {
          injected: {
            ok: true,
            tabId: "unexpected-tab",
            result: { hasCookie: true, pathname: "/login", search: "" },
          },
        }
      },
    }),
    /cookie injection returned unexpected-tab; expected approved-local-tab/,
  )
})

test("guarded eval rejects an action response from another tab", async () => {
  const exactTabId = "approved-local-tab"
  let evalCount = 0

  await assert.rejects(
    authGuard.evalOnTarget("/tasks", "return document.title", {
      frontendBase: "http://127.0.0.1:38181",
      twdWait: "1",
      ensureTwdServeImpl: async () => {},
      openTargetImpl: async () => ({ ok: true, target: "/tasks", tabId: exactTabId }),
      runTwdImpl() {
        evalCount += 1
        if (evalCount === 1) {
          return { ok: true, tabId: "unexpected-tab", result: "foreign result" }
        }
        return {
          ok: true,
          tabId: exactTabId,
          result: {
            href: "http://127.0.0.1:38181/tasks",
            origin: "http://127.0.0.1:38181",
            pathname: "/tasks",
            search: "",
            hash: "",
            readyState: "complete",
          },
        }
      },
    }),
    /guarded eval returned unexpected-tab; expected approved-local-tab/,
  )
})

test("guarded eval rejects a final probe response from another tab", async () => {
  const exactTabId = "approved-local-tab"
  let evalCount = 0

  await assert.rejects(
    authGuard.evalOnTarget("/tasks", "return document.title", {
      frontendBase: "http://127.0.0.1:38181",
      twdWait: "1",
      ensureTwdServeImpl: async () => {},
      openTargetImpl: async () => ({ ok: true, target: "/tasks", tabId: exactTabId }),
      runTwdImpl() {
        evalCount += 1
        if (evalCount === 1) {
          return { ok: true, tabId: exactTabId, result: "SmallKhoj" }
        }
        return {
          ok: true,
          tabId: "unexpected-tab",
          result: {
            href: "http://127.0.0.1:38181/tasks",
            origin: "http://127.0.0.1:38181",
            pathname: "/tasks",
            search: "",
            hash: "",
            readyState: "complete",
          },
        }
      },
    }),
    /final probe returned unexpected-tab; expected approved-local-tab/,
  )
})

test("cookie injection command failures never echo the session token", async () => {
  const sessionToken = "sk_session_red_cookie_command_must_not_leak"
  let receivedSensitiveEval = false

  await assert.rejects(
    authGuard.openTargetOnExactTab("/tasks", "approved-local-tab", {
      frontendBase: "http://127.0.0.1:38181",
      twdWait: "1",
      ensureTwdServeImpl: async () => {},
      bridgeAccountSessionImpl: async () => sessionToken,
      runTwdImpl(args) {
        const renderedCommand = args.join("\n")
        assert.equal(args[1], "eval")
        if (!renderedCommand.includes("const cookieName")) {
          return {
            ok: true,
            tabId: "approved-local-tab",
            result: {
              href: "http://127.0.0.1:38181/login",
              origin: "http://127.0.0.1:38181",
              pathname: "/login",
              search: "",
              hash: "",
              readyState: "complete",
            },
          }
        }
        assert.equal(renderedCommand.includes(sessionToken), true)
        receivedSensitiveEval = true
        throw new Error(`raw WebDriver failure:\n${renderedCommand}`)
      },
    }),
    (error) => {
      assert.match(error.message, /Session cookie injection command failed/)
      assert.equal(error.message.includes(sessionToken), false)
      assert.equal(String(error.cause?.message ?? "").includes(sessionToken), false)
      return true
    },
  )

  assert.equal(receivedSensitiveEval, true)
})
