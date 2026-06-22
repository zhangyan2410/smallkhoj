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
const SESSION_COOKIE = "smallkhoj_session"

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return null
}

function config() {
  return {
    frontendBase: envValue("FRONTEND_BASE", "SMALLKHOJ_FRONTEND") ?? DEFAULT_FRONTEND_BASE,
    apiBase: envValue("API_BASE", "SMALLKHOJ_API", "NEXT_PUBLIC_API_BASE_URL") ?? DEFAULT_API_BASE,
    publicKey: envValue("PUBLIC_KEY", "NEXT_PUBLIC_API_KEY") ?? DEFAULT_PUBLIC_KEY,
    accountName: envValue("TWD_ACCOUNT", "SMALLKHOJ_TWD_ACCOUNT") ?? DEFAULT_ACCOUNT,
    twdWait: envValue("TWD_WAIT") ?? DEFAULT_TWD_WAIT,
    twdPort: Number(envValue("TWD_PORT") ?? "18765"),
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
  if (await isPortOpen(cfg.twdPort)) return

  const child = spawn(TWD, ["serve"], {
    cwd: ROOT,
    detached: true,
    stdio: "ignore",
  })
  child.unref()
  await waitForPort(cfg.twdPort, Number(cfg.twdWait) * 1000)
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

async function loginAccount({ accountName, apiBase, publicKey }) {
  const response = await fetch(`${apiBase}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Public-Key": publicKey,
    },
    body: JSON.stringify({ name: accountName, displayName: accountName }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Login failed: HTTP ${response.status}${text ? ` ${text}` : ""}`)
  }

  const data = await response.json()
  if (!data?.sessionToken) {
    throw new Error(`Login response did not include sessionToken: ${JSON.stringify(data)}`)
  }
  return data.sessionToken
}

function injectCookie(selection, sessionToken, twdWait) {
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
  const payload = runTwd(["--compact", "eval", ...selection.args, "--wait", twdWait, script])
  if (!payload.result?.hasCookie) {
    throw new Error(`Session cookie injection failed on ${payload.tabUrl ?? payload.result?.href ?? "unknown tab"}`)
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
  const token = await loginAccount(cfg)
  const injected = injectCookie(selection, token, cfg.twdWait)
  return { token, injected }
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

function usage() {
  return `Usage:
  tools/twd-guard/twd-auth [account-name]
  tools/twd-guard/twd-open <path-or-url>
  tools/twd-guard/twd-eval <path-or-url> <javascript>

Environment:
  FRONTEND_BASE=http://127.0.0.1:3000
  API_BASE=http://localhost:8000
  PUBLIC_KEY=sk_public_local
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
    console.log(JSON.stringify(await openTarget(args[0])))
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
