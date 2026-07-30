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

function loginMatch(frontendBase) {
  const loginUrl = normalizeTarget("/login", frontendBase)
  return urlMatchForTarget(loginUrl)
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

  const args = cfg.twdPort ? ["--port", String(cfg.twdPort), "serve"] : ["serve"]
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

export function selectLocalTab({ tabs, frontendBase = DEFAULT_FRONTEND_BASE, targetUrl }) {
  const frontendUrl = normalizeTarget("/", frontendBase)
  const targetMatch = urlMatchForTarget(targetUrl)
  const loginUrlMatch = loginMatch(frontendBase)
  const localTabs = tabs.filter((tab) => asUrl(tab.url)?.origin === frontendUrl.origin)
  const targetTabs = localTabs.filter((tab) => String(tab.url ?? "").includes(targetMatch))
  const loginTabs = localTabs.filter((tab) => String(tab.url ?? "").includes(loginUrlMatch))

  if (targetTabs.length > 0) {
    return { args: ["--url-match", targetMatch], reason: "target" }
  }

  if (loginTabs.length > 0) {
    return { args: ["--url-match", loginUrlMatch], reason: "login" }
  }

  if (localTabs.length === 1) {
    const currentUrl = asUrl(localTabs[0].url)
    return { args: ["--url-match", urlMatchForTarget(currentUrl)], reason: "single-local-tab" }
  }

  const active = uniqueActive(localTabs)
  if (active) {
    const currentUrl = asUrl(active.url)
    return { args: ["--url-match", urlMatchForTarget(currentUrl)], reason: "active-local-tab" }
  }

  if (localTabs.length === 0) {
    throw new Error(
      `No connected local frontend tab for ${frontendUrl.origin}. Open the SmallKhoj frontend in the browser and ensure ./twd can see it.`,
    )
  }

  throw new Error(`Ambiguous local frontend tabs; use or close one before guarded verification:\n${tabListMessage(localTabs)}`)
}

export function assertTargetResult(result, targetUrl) {
  const expectedPath = targetUrl.pathname
  const actualPath = result?.pathname
  const expectedSearch = targetUrl.search
  const actualSearch = result?.search ?? ""

  if (actualPath !== expectedPath || (expectedSearch && actualSearch !== expectedSearch)) {
    const expected = `${expectedPath}${expectedSearch}`
    const actual = `${actualPath ?? "<unknown>"}${actualSearch}`
    throw new Error(`Expected ${expected}, but browser is at ${actual}`)
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
  return data.sessionToken
}

function injectCookie(selection, sessionToken, twdWait, runTwdImpl = runTwd) {
  const script = `
const cookieName = ${JSON.stringify(SESSION_COOKIE)};
const token = ${JSON.stringify(sessionToken)};
document.cookie = cookieName + "=" + encodeURIComponent(token) + "; path=/; max-age=2592000; SameSite=Lax";
return {
  href: location.href,
  pathname: location.pathname,
  search: location.search,
  hasCookie: document.cookie.split("; ").some((item) => item.startsWith(cookieName + "=")),
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
  return "return {href: location.href, pathname: location.pathname, search: location.search, title: document.title}"
}

function probeFinalPage({ tabId, frontendBase, targetUrl, twdWait }) {
  const attempts = []
  attempts.push(["--url-match", urlMatchForTarget(targetUrl)])
  attempts.push(["--url-match", loginMatch(frontendBase)])
  if (tabId) attempts.push(["--tab", String(tabId)])

  let lastError = null
  for (const args of attempts) {
    try {
      return runTwd(["--compact", "eval", ...args, "--wait", twdWait, probeScript()])
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error("Unable to probe final browser page")
}

async function ensureAuthOnSelection(selection, cfg) {
  const token = await bridgeAccountSession(cfg)
  const injected = injectCookie(selection, token, cfg.twdWait)
  return { token, injected }
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

export async function openTargetOnExactTab(target, tabId, options = {}) {
  const {
    runTwdImpl = runTwd,
    ensureTwdServeImpl = ensureTwdServe,
    bridgeAccountSessionImpl = bridgeAccountSession,
    ...configOverrides
  } = options
  const cfg = { ...config(), ...configOverrides }
  const selection = exactTabSelection(tabId)
  await ensureTwdServeImpl(cfg)
  const targetUrl = normalizeTarget(target, cfg.frontendBase)

  const authenticate = async () => {
    const token = await bridgeAccountSessionImpl(cfg)
    const injected = injectCookie(selection, token, cfg.twdWait, runTwdImpl)
    assertExactTabPayload(injected, selection.tabId, "cookie injection")
  }
  const navigateAndProbe = () => {
    const opened = runTwdImpl([
      "--compact",
      "goto",
      ...selection.args,
      "--wait",
      cfg.twdWait,
      targetUrl.href,
    ])
    assertExactTabPayload(opened, selection.tabId, "navigation")
    const probe = runTwdImpl([
      "--compact",
      "eval",
      ...selection.args,
      "--wait",
      cfg.twdWait,
      probeScript(),
    ])
    assertExactTabPayload(probe, selection.tabId, "final probe")
    return { opened, probe }
  }

  await authenticate()
  let { opened, probe } = navigateAndProbe()
  if (probe.result?.pathname === "/login") {
    await authenticate()
    const retried = navigateAndProbe()
    opened = retried.opened
    probe = retried.probe
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
  const cfg = { ...config(), ...options }
  await ensureTwdServe(cfg)
  const targetUrl = normalizeTarget(target, cfg.frontendBase)
  const tabs = getTabs(cfg.twdWait)
  let selection = selectLocalTab({ tabs, frontendBase: cfg.frontendBase, targetUrl })
  await ensureAuthOnSelection(selection, cfg)

  let opened = runTwd(["--compact", "goto", ...selection.args, "--wait", cfg.twdWait, targetUrl.href])
  let probe = probeFinalPage({ tabId: opened.tabId, frontendBase: cfg.frontendBase, targetUrl, twdWait: cfg.twdWait })

  if (probe.result?.pathname === "/login") {
    const retryTabs = getTabs(cfg.twdWait)
    selection = selectLocalTab({ tabs: retryTabs, frontendBase: cfg.frontendBase, targetUrl })
    await ensureAuthOnSelection(selection, cfg)
    opened = runTwd(["--compact", "goto", ...selection.args, "--wait", cfg.twdWait, targetUrl.href])
    probe = probeFinalPage({ tabId: opened.tabId, frontendBase: cfg.frontendBase, targetUrl, twdWait: cfg.twdWait })
  }

  assertTargetResult(probe.result, targetUrl)
  return {
    ok: true,
    target: `${targetUrl.pathname}${targetUrl.search}`,
    tabId: probe.tabId ?? opened.tabId,
    tabUrl: probe.tabUrl ?? probe.result?.href,
    result: probe.result,
  }
}

export async function authOnly(accountName) {
  const cfg = { ...config(), accountName: accountName || config().accountName }
  await ensureTwdServe(cfg)
  const targetUrl = normalizeTarget("/login", cfg.frontendBase)
  const tabs = getTabs(cfg.twdWait)
  const selection = selectLocalTab({ tabs, frontendBase: cfg.frontendBase, targetUrl })
  const { injected } = await ensureAuthOnSelection(selection, cfg)
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
  const cfg = { ...config(), ...options }
  await ensureTwdServe(cfg)
  const targetUrl = normalizeTarget(target, cfg.frontendBase)
  const opened = await openTarget(target, cfg)
  const payload = runTwd(["--compact", "eval", "--url-match", urlMatchForTarget(targetUrl), "--wait", cfg.twdWait, script])
  const probe = runTwd(["--compact", "eval", "--url-match", urlMatchForTarget(targetUrl), "--wait", cfg.twdWait, probeScript()])
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
