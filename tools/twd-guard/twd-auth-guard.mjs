#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import net from "node:net"
import { dirname, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../..")
const TWD = resolve(ROOT, "twd")

const DEFAULT_FRONTEND_BASE = "http://127.0.0.1:3000"
const DEFAULT_API_BASE = "http://localhost:8000"
const DEFAULT_PUBLIC_KEY = "sk_public_local"
const DEFAULT_ACCOUNT = "zy-ean"
const DEFAULT_TWD_WAIT = "5"
const DEFAULT_TWD_PORT_CANDIDATES = Object.freeze([28765, 18765])
const SESSION_COOKIE = "smallkhoj_session"
const ACTIVE_SERVER_COOKIE = "smallkhoj_active_server"

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return null
}

export function parsePortCandidates(value) {
  const ports = String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))

  if (ports.length === 0 || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`Invalid TWD_PORT_CANDIDATES: ${value}`)
  }

  return Array.from(new Set(ports))
}

export function config() {
  const explicitTwdPort = envValue("TWD_PORT")
  return {
    frontendBase: envValue("FRONTEND_BASE", "SMALLKHOJ_FRONTEND") ?? DEFAULT_FRONTEND_BASE,
    apiBase: envValue("API_BASE", "SMALLKHOJ_API", "NEXT_PUBLIC_API_BASE_URL") ?? DEFAULT_API_BASE,
    publicKey: envValue("PUBLIC_KEY", "NEXT_PUBLIC_API_KEY") ?? DEFAULT_PUBLIC_KEY,
    authBridgeSecret: envValue("TWD_AUTH_BRIDGE_SECRET", "AUTH_BRIDGE_SECRET"),
    accountName: envValue("TWD_ACCOUNT", "SMALLKHOJ_TWD_ACCOUNT") ?? DEFAULT_ACCOUNT,
    twdWait: envValue("TWD_WAIT") ?? DEFAULT_TWD_WAIT,
    twdPort: explicitTwdPort ? Number(explicitTwdPort) : null,
    twdPortCandidates: process.env.TWD_PORT_CANDIDATES
      ? parsePortCandidates(process.env.TWD_PORT_CANDIDATES)
      : [...DEFAULT_TWD_PORT_CANDIDATES],
  }
}

export function normalizeTarget(target, frontendBase = DEFAULT_FRONTEND_BASE) {
  if (!target) throw new Error("Target path is required")
  return new URL(target, frontendBase.endsWith("/") ? frontendBase : `${frontendBase}/`)
}

export function urlMatchForTarget(targetUrl) {
  return `${targetUrl.host}${targetUrl.pathname}${targetUrl.search}`
}

export function parseLastJson(output) {
  const lines = String(output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!line.startsWith("{") && !line.startsWith("[")) continue
    try {
      return JSON.parse(line)
    } catch {
      // Keep scanning older lines; WebDriver may print connection logs first.
    }
  }

  throw new Error(`No JSON object found in command output:\n${output}`)
}

function formatCommand(args) {
  return ["./twd", ...args].join(" ")
}

function runTwd(args) {
  const result = spawnSync(TWD, args, {
    cwd: ROOT,
    encoding: "utf8",
  })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`

  if (result.status !== 0) {
    throw new Error(`${formatCommand(args)} failed with exit ${result.status}:\n${output.trim()}`)
  }

  const payload = parseLastJson(result.stdout)
  if (payload?.ok === false) {
    throw new Error(`${formatCommand(args)} returned ok=false:\n${JSON.stringify(payload, null, 2)}`)
  }
  return payload
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function isPortOpen(port) {
  return new Promise((resolveOpen) => {
    const socket = net.createConnection({ host: "127.0.0.1", port })
    socket.once("connect", () => {
      socket.destroy()
      resolveOpen(true)
    })
    socket.once("error", () => resolveOpen(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolveOpen(false)
    })
  })
}

async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) return
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ./twd serve on port ${port}`)
}

async function ensureTwdServe(cfg) {
  const wsPort = cfg.twdPort ?? cfg.twdPortCandidates[0]
  const controlPort = wsPort + 1
  if (await isPortOpen(controlPort)) return

  const args = ["--port", String(wsPort), "serve"]
  const child = spawn(TWD, args, {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  })
  child.unref()
  await waitForPort(controlPort, Number(cfg.twdWait) * 1000)
}

function asUrl(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function tabListMessage(tabs) {
  return tabs.map((tab) => `${tab.id ?? "?"} ${tab.url ?? ""}`).join("\n")
}

function uniqueActive(tabs) {
  const active = tabs.filter((tab) => tab.active === true)
  return active.length === 1 ? active[0] : null
}

function exactTabSelectionFrom(tab, reason) {
  const tabId = String(tab?.id ?? "").trim()
  if (!tabId) throw new Error(`Selected ${reason} tab did not include an ID`)
  return { args: ["--tab", tabId], reason, tabId }
}

function chooseExactTab(tabs, reason) {
  if (tabs.length === 1) return exactTabSelectionFrom(tabs[0], reason)
  const active = uniqueActive(tabs)
  if (active) return exactTabSelectionFrom(active, reason)
  throw new Error(`Ambiguous ${reason} tabs; choose an exact tab before guarded verification:\n${tabListMessage(tabs)}`)
}

function locationFromResult(result) {
  const hrefUrl = asUrl(result?.href)
  return {
    href: hrefUrl?.href ?? result?.href ?? null,
    origin: result?.origin ?? hrefUrl?.origin ?? null,
    pathname: result?.pathname ?? hrefUrl?.pathname ?? null,
    search: result?.search ?? hrefUrl?.search ?? "",
    hash: result?.hash ?? hrefUrl?.hash ?? "",
    readyState: result?.readyState ?? null,
  }
}

function tabMatchesUrl(tab, targetUrl) {
  const current = asUrl(tab?.url)
  return Boolean(
    current
      && current.origin === targetUrl.origin
      && current.pathname === targetUrl.pathname
      && current.search === targetUrl.search
      && current.hash === targetUrl.hash,
  )
}

export function selectLocalTab({ tabs, frontendBase = DEFAULT_FRONTEND_BASE, targetUrl }) {
  const frontendUrl = normalizeTarget("/", frontendBase)
  const localTabs = tabs.filter((tab) => asUrl(tab.url)?.origin === frontendUrl.origin)
  const targetTabs = localTabs.filter((tab) => tabMatchesUrl(tab, targetUrl))
  const loginUrl = normalizeTarget("/login", frontendBase)
  const loginTabs = localTabs.filter((tab) => tabMatchesUrl(tab, loginUrl))

  if (targetTabs.length > 0) {
    return chooseExactTab(targetTabs, "target")
  }

  if (loginTabs.length > 0) {
    return chooseExactTab(loginTabs, "login")
  }

  if (localTabs.length === 1) {
    return exactTabSelectionFrom(localTabs[0], "single-local-tab")
  }

  const active = uniqueActive(localTabs)
  if (active) {
    return exactTabSelectionFrom(active, "active-local-tab")
  }

  if (localTabs.length === 0) {
    throw new Error(
      `No connected local frontend tab for ${frontendUrl.origin}. Open the SmallKhoj frontend in the browser and ensure ./twd can see it.`,
    )
  }

  throw new Error(`Ambiguous local frontend tabs; use or close one before guarded verification:\n${tabListMessage(localTabs)}`)
}

export function assertTargetResult(result, targetUrl) {
  const actual = locationFromResult(result)
  if (
    actual.origin !== targetUrl.origin
    || actual.pathname !== targetUrl.pathname
    || actual.search !== targetUrl.search
    || actual.hash !== targetUrl.hash
  ) {
    const actualLocation = actual.href
      ?? `${actual.origin ?? "<unknown-origin>"}${actual.pathname ?? "<unknown-path>"}${actual.search}${actual.hash}`
    throw new Error(`Expected ${targetUrl.href}, but browser is at ${actualLocation}`)
  }
}

function getTabs(twdWait = config().twdWait) {
  const payload = runTwd(["--compact", "tabs", "--wait", twdWait])
  return payload.tabs ?? []
}

export async function bridgeAccountSession({
  accountName,
  apiBase,
  publicKey,
  authBridgeSecret,
  includeContext = false,
  fetchImpl = fetch,
}) {
  if (!authBridgeSecret) {
    throw new Error("AUTH_BRIDGE_SECRET is required for trusted TWD authentication")
  }
  const normalizedAccountName = String(accountName ?? "").trim()
  if (!normalizedAccountName) {
    throw new Error("TWD_ACCOUNT is required for trusted TWD authentication")
  }
  const normalizedApiBase = String(apiBase ?? "").replace(/\/+$/, "")
  const response = await fetchImpl(`${normalizedApiBase}/api/v1/auth/better-auth/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Public-Key": publicKey,
      "X-Auth-Bridge-Secret": authBridgeSecret,
    },
    body: JSON.stringify({
      userId: `twd:${normalizedAccountName}`,
      name: normalizedAccountName,
    }),
  })

  if (!response.ok) {
    throw new Error(`Trusted auth bridge failed: HTTP ${response.status}`)
  }

  const data = await response.json()
  if (!data?.sessionToken) {
    throw new Error("Trusted auth bridge response did not include sessionToken")
  }
  if (includeContext) {
    return {
      sessionToken: data.sessionToken,
      serverId: data.server?.id ?? null,
    }
  }
  return data.sessionToken
}

function authContext(value) {
  if (typeof value === "string") return { sessionToken: value, serverId: null }
  return {
    sessionToken: value?.sessionToken,
    serverId: value?.serverId ?? null,
  }
}

function injectCookie(selection, sessionToken, twdWait, runTwdImpl = runTwd, serverId = null) {
  const script = `
const cookieName = ${JSON.stringify(SESSION_COOKIE)};
const activeServerCookieName = ${JSON.stringify(ACTIVE_SERVER_COOKIE)};
const token = ${JSON.stringify(sessionToken)};
const serverId = ${JSON.stringify(serverId)};
document.cookie = cookieName + "=" + encodeURIComponent(token) + "; path=/; max-age=2592000; SameSite=Lax";
document.cookie = activeServerCookieName + "=; path=/; max-age=0; SameSite=Lax";
if (serverId) {
  document.cookie = activeServerCookieName + "=" + encodeURIComponent(serverId) + "; path=/; max-age=2592000; SameSite=Lax";
}
return {
  href: location.href,
  pathname: location.pathname,
  search: location.search,
  hasCookie: document.cookie.split("; ").some((item) => item.startsWith(cookieName + "=")),
  activeServerId: document.cookie.split("; ").find((item) => item.startsWith(activeServerCookieName + "="))?.slice(activeServerCookieName.length + 1) ?? null,
};
`
  let payload
  try {
    payload = runTwdImpl(["--compact", "eval", ...selection.args, "--wait", twdWait, script])
  } catch {
    // The eval script contains the reusable session token. Do not retain the
    // command/error as a cause: runTwd diagnostics include the complete argv.
    throw new Error("Session cookie injection command failed")
  }
  if (!payload.result?.hasCookie) {
    throw new Error("Session cookie injection verification failed")
  }
  return payload
}

function probeScript() {
  return "return {href: location.href, origin: location.origin, pathname: location.pathname, search: location.search, hash: location.hash, readyState: document.readyState, title: document.title}"
}

async function ensureAuthOnSelection(selection, cfg) {
  await ensureFrontendOrigin({
    selection,
    cfg,
    runTwdImpl: runTwd,
    sleepImpl: sleep,
  })
  const context = authContext(await bridgeAccountSession({ ...cfg, includeContext: true }))
  if (!context.sessionToken) throw new Error("Trusted auth bridge did not return a session token")
  const injected = injectCookie(selection, context.sessionToken, cfg.twdWait, runTwd, context.serverId)
  return { token: context.sessionToken, serverId: context.serverId, injected }
}

function exactTabSelection(tabId) {
  const normalized = String(tabId ?? "").trim()
  if (!normalized) throw new Error("Exact tab ID is required")
  return { args: ["--tab", normalized], reason: "exact-tab", tabId: normalized }
}

function assertExactTabPayload(payload, tabId, operation) {
  if (String(payload?.tabId ?? "") !== tabId) {
    throw new Error(
      `Exact-tab ${operation} returned ${payload?.tabId ?? "<unknown>"}; expected ${tabId}`,
    )
  }
}

function isReadyForAcceptance(result) {
  const readyState = locationFromResult(result).readyState
  return readyState === null || readyState === "interactive" || readyState === "complete"
}

function isExactTarget(result, targetUrl) {
  try {
    assertTargetResult(result, targetUrl)
    return true
  } catch {
    return false
  }
}

function isFrontendLogin(result, frontendBase) {
  const actual = locationFromResult(result)
  const frontend = normalizeTarget("/", frontendBase)
  return actual.origin === frontend.origin && actual.pathname === "/login"
}

async function pollExactTabLocation({
  selection,
  targetUrl,
  frontendBase,
  twdWait,
  runTwdImpl,
  sleepImpl,
  timeoutMs,
  intervalMs,
}) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  let lastProbe = null
  while (true) {
    const probe = runTwdImpl([
      "--compact",
      "eval",
      ...selection.args,
      "--wait",
      twdWait,
      probeScript(),
    ])
    assertExactTabPayload(probe, selection.tabId, "final probe")
    lastProbe = probe
    if (isReadyForAcceptance(probe.result) && isExactTarget(probe.result, targetUrl)) {
      return { state: "target", probe }
    }
    if (isReadyForAcceptance(probe.result) && isFrontendLogin(probe.result, frontendBase)) {
      return { state: "login", probe }
    }
    if (Date.now() >= deadline) {
      assertTargetResult(lastProbe.result, targetUrl)
      throw new Error("Browser navigation did not reach a stable target")
    }
    await sleepImpl(Math.max(0, intervalMs))
  }
}

async function ensureFrontendOrigin({ selection, cfg, runTwdImpl, sleepImpl }) {
  const frontendUrl = normalizeTarget("/", cfg.frontendBase)
  const current = runTwdImpl([
    "--compact",
    "eval",
    ...selection.args,
    "--wait",
    cfg.twdWait,
    probeScript(),
  ])
  assertExactTabPayload(current, selection.tabId, "authentication origin probe")
  if (locationFromResult(current.result).origin === frontendUrl.origin) return current

  const loginUrl = normalizeTarget("/login", cfg.frontendBase)
  const opened = runTwdImpl([
    "--compact",
    "goto",
    ...selection.args,
    "--wait",
    cfg.twdWait,
    loginUrl.href,
  ])
  assertExactTabPayload(opened, selection.tabId, "authentication origin navigation")
  const polled = await pollExactTabLocation({
    selection,
    targetUrl: loginUrl,
    frontendBase: cfg.frontendBase,
    twdWait: cfg.twdWait,
    runTwdImpl,
    sleepImpl,
    timeoutMs: Number(cfg.navigationTimeoutMs ?? Number(cfg.twdWait) * 1000),
    intervalMs: Number(cfg.navigationPollIntervalMs ?? 200),
  })
  assertTargetResult(polled.probe.result, loginUrl)
  return polled.probe
}

export async function openTargetOnExactTab(target, tabId, options = {}) {
  const {
    runTwdImpl = runTwd,
    ensureTwdServeImpl = ensureTwdServe,
    bridgeAccountSessionImpl = bridgeAccountSession,
    sleepImpl = sleep,
    ...configOverrides
  } = options
  const cfg = { ...config(), ...configOverrides }
  const selection = exactTabSelection(tabId)
  await ensureTwdServeImpl(cfg)
  const targetUrl = normalizeTarget(target, cfg.frontendBase)

  const authenticate = async () => {
    await ensureFrontendOrigin({ selection, cfg, runTwdImpl, sleepImpl })
    const context = authContext(await bridgeAccountSessionImpl({ ...cfg, includeContext: true }))
    if (!context.sessionToken) throw new Error("Trusted auth bridge did not return a session token")
    const injected = injectCookie(
      selection,
      context.sessionToken,
      cfg.twdWait,
      runTwdImpl,
      context.serverId,
    )
    assertExactTabPayload(injected, selection.tabId, "cookie injection")
  }
  const navigateAndProbe = async () => {
    const opened = runTwdImpl([
      "--compact",
      "goto",
      ...selection.args,
      "--wait",
      cfg.twdWait,
      targetUrl.href,
    ])
    assertExactTabPayload(opened, selection.tabId, "navigation")
    const polled = await pollExactTabLocation({
      selection,
      targetUrl,
      frontendBase: cfg.frontendBase,
      twdWait: cfg.twdWait,
      runTwdImpl,
      sleepImpl,
      timeoutMs: Number(cfg.navigationTimeoutMs ?? Number(cfg.twdWait) * 1000),
      intervalMs: Number(cfg.navigationPollIntervalMs ?? 200),
    })
    return { opened, ...polled }
  }

  await authenticate()
  let { opened, probe, state } = await navigateAndProbe()
  if (state === "login") {
    await authenticate()
    const retried = await navigateAndProbe()
    opened = retried.opened
    probe = retried.probe
    state = retried.state
  }

  assertTargetResult(probe.result, targetUrl)
  return {
    ok: true,
    target: `${targetUrl.pathname}${targetUrl.search}`,
    tabId: selection.tabId,
    tabUrl: probe.tabUrl ?? probe.result?.href ?? opened.tabUrl,
    result: probe.result,
  }
}

export async function openTarget(target, options = {}) {
  const {
    ensureTwdServeImpl = ensureTwdServe,
    getTabsImpl = getTabs,
    ...configOverrides
  } = options
  const cfg = { ...config(), ...configOverrides }
  await ensureTwdServeImpl(cfg)
  const targetUrl = normalizeTarget(target, cfg.frontendBase)
  const tabs = getTabsImpl(cfg.twdWait)
  const selection = selectLocalTab({ tabs, frontendBase: cfg.frontendBase, targetUrl })
  return openTargetOnExactTab(target, selection.tabId, {
    ...configOverrides,
    ensureTwdServeImpl: async () => {},
  })
}

export async function authOnly(accountName, options = {}) {
  const {
    ensureTwdServeImpl = ensureTwdServe,
    getTabsImpl = getTabs,
    ensureAuthOnSelectionImpl = ensureAuthOnSelection,
    ...configOverrides
  } = options
  const cfg = {
    ...config(),
    ...configOverrides,
    accountName: accountName || configOverrides.accountName || config().accountName,
  }
  await ensureTwdServeImpl(cfg)
  const targetUrl = normalizeTarget("/login", cfg.frontendBase)
  const tabs = getTabsImpl(cfg.twdWait)
  const selection = selectLocalTab({ tabs, frontendBase: cfg.frontendBase, targetUrl })
  const { injected } = await ensureAuthOnSelectionImpl(selection, cfg)
  assertExactTabPayload(injected, selection.tabId, "cookie injection")
  return {
    ok: true,
    accountName: cfg.accountName,
    tabId: injected.tabId,
    tabUrl: injected.tabUrl ?? injected.result?.href,
    result: injected.result,
  }
}

export async function evalOnTarget(target, script, options = {}) {
  if (!script) throw new Error("JavaScript script is required")
  const {
    ensureTwdServeImpl = ensureTwdServe,
    openTargetImpl = openTarget,
    runTwdImpl = runTwd,
    ...configOverrides
  } = options
  const cfg = { ...config(), ...configOverrides }
  await ensureTwdServeImpl(cfg)
  const targetUrl = normalizeTarget(target, cfg.frontendBase)
  const opened = await openTargetImpl(target, cfg)
  const exactTabId = String(opened.tabId)
  const exactArgs = ["--tab", exactTabId]
  const payload = runTwdImpl(["--compact", "eval", ...exactArgs, "--wait", cfg.twdWait, script])
  assertExactTabPayload(payload, exactTabId, "guarded eval")
  const probe = runTwdImpl(["--compact", "eval", ...exactArgs, "--wait", cfg.twdWait, probeScript()])
  assertExactTabPayload(probe, exactTabId, "final probe")
  assertTargetResult(probe.result, targetUrl)
  return {
    ok: true,
    target: opened.target,
    tabId: payload.tabId,
    tabUrl: payload.tabUrl,
    result: payload.result,
    guard: {
      tabUrl: probe.tabUrl,
      pathname: probe.result?.pathname,
      search: probe.result?.search,
    },
  }
}

export function parseGuardTabOption(args) {
  let tabId = null
  const positionals = []

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]
    if (value !== "--tab") {
      positionals.push(value)
      continue
    }
    if (tabId !== null) throw new Error("--tab may only be supplied once")
    const candidate = String(args[index + 1] ?? "").trim()
    if (!candidate) throw new Error("--tab requires a non-empty value")
    tabId = candidate
    index += 1
  }

  return { tabId, positionals }
}

function usage() {
  return `Usage:
  tools/twd-guard/twd-auth [account-name]
  tools/twd-guard/twd-open [--tab <exact-tab-id>] <path-or-url>
  tools/twd-guard/twd-eval <path-or-url> <javascript>

Environment:
  FRONTEND_BASE=http://127.0.0.1:3000
  API_BASE=http://localhost:8000
  PUBLIC_KEY=sk_public_local
  AUTH_BRIDGE_SECRET=<trusted-local-bridge-secret>
  TWD_ACCOUNT=zy-ean
  TWD_WAIT=5`
}

async function main(argv) {
  const [command, ...args] = argv
  if (!command || command === "-h" || command === "--help") {
    console.log(usage())
    return
  }

  if (command === "auth") {
    console.log(JSON.stringify(await authOnly(args[0])))
    return
  }

  if (command === "open") {
    const { tabId, positionals } = parseGuardTabOption(args)
    if (positionals.length !== 1) throw new Error(`open requires exactly one target\n${usage()}`)
    const result = tabId
      ? await openTargetOnExactTab(positionals[0], tabId)
      : await openTarget(positionals[0])
    console.log(JSON.stringify(result))
    return
  }

  if (command === "eval") {
    const [target, ...scriptParts] = args
    console.log(JSON.stringify(await evalOnTarget(target, scriptParts.join(" "))))
    return
  }

  throw new Error(`Unknown command: ${command}\n${usage()}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
