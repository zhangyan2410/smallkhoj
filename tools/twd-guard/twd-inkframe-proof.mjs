#!/usr/bin/env node
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { evalOnTarget, parseLastJson } from "./twd-auth-guard.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../..")
const DEFAULT_TASK_DIR = ".trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner"
const BLOCKED_EXIT_CODE = 2

export const REQUIRED_SELECTOR_GROUPS = [
  "product-shell",
  "chat-desktop",
  "chat-mobile",
  "chat-unread",
  "task-desktop",
  "task-mobile",
  "material-state",
]

export const PRODUCT_SHELL_PROOF_ROUTES = ["/chat", "/tasks", "/members", "/computers", "/settings"]

function routeLabel(route) {
  return route === "/" ? "home" : route.slice(1).replaceAll("/", " ")
}

function buildProductShellChecks(routes = PRODUCT_SHELL_PROOF_ROUTES) {
  return routes.flatMap((route) => {
    const label = routeLabel(route)
    return [
      {
        group: "product-shell",
        label: `${label} shell background surface`,
        selector: '[data-inkframe-surface="app-background"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} shell background owner`,
        selector: '[data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} dry desk tint`,
        selector: '[data-inkframe-region="app-background"][data-inkframe-tint="desk"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} shell background does not capture pointer by default`,
        selector: '[data-inkframe-surface="app-background"][data-inkframe-pointer-capture="false"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} shell background starts without an imported source image`,
        selector: '[data-inkframe-surface="app-background"][data-inkframe-background-source-mode="none"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} workbench header owns foreground contrast`,
        selector:
          '[data-inkframe-contrast-owner="workbench-header"][data-inkframe-foreground-surface="header-paper"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} main panel owns foreground contrast`,
        selector: '[data-inkframe-contrast-owner="main-panel"][data-inkframe-foreground-surface="paper-field"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} app background material owner`,
        selector:
          '[data-inkframe-surface="material"][data-inkframe-owner-kind="app-background"][data-inkframe-owner-id="global-desk"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} app background material desk tint`,
        selector: '[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-tint="desk"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} app background material starts static`,
        selector: '[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-mode="static"]',
        minCount: 1,
        route,
      },
      {
        group: "product-shell",
        label: `${label} app background material does not capture pointer by default`,
        selector:
          '[data-inkframe-surface="material"][data-inkframe-region="app-background"][data-inkframe-pointer-capture="false"]',
        minCount: 1,
        route,
      },
    ]
  })
}

export const INKFRAME_SELECTOR_CHECKS = [
  ...buildProductShellChecks(),
  {
    group: "chat-desktop",
    label: "chat workspace",
    selector: '[data-inkframe-mobile-role="chat-workspace"]',
    minCount: 1,
    route: "/chat",
    viewport: "desktop",
  },
  {
    group: "chat-desktop",
    label: "chat sidebar drawer collapsed state marker",
    selector: '[data-inkframe-mobile-role="sidebar-drawer"][data-inkframe-state="collapsed"]',
    minCount: 0,
    route: "/chat",
    viewport: "desktop",
  },
  {
    group: "chat-desktop",
    label: "chat message list",
    selector: '[data-inkframe-mobile-role="chat-message-list"]',
    minCount: 1,
    route: "/chat",
    viewport: "desktop",
  },
  {
    group: "chat-desktop",
    label: "chat composer",
    selector: '[data-inkframe-mobile-role="chat-composer"]',
    minCount: 1,
    route: "/chat",
    viewport: "desktop",
  },
  {
    group: "chat-desktop",
    label: "chat messages",
    selector: '[data-inkframe-object="message"]',
    minCount: 0,
    route: "/chat",
    viewport: "desktop",
  },
  {
    group: "chat-desktop",
    label: "chat message actions default hidden",
    selector: '[data-inkframe-object="message-actions"][data-inkframe-state="toolbar-hidden"]',
    minCount: 0,
    route: "/chat",
    viewport: "desktop",
  },
  {
    group: "chat-desktop",
    label: "chat message material surfaces",
    selector: '[data-inkframe-surface="material"][data-inkframe-owner-kind="message"]',
    minCount: 0,
    route: "/chat",
    viewport: "desktop",
  },
  {
    group: "chat-mobile",
    label: "chat mobile workspace marker",
    selector: '[data-inkframe-mobile-role="chat-workspace"]',
    minCount: 1,
    route: "/chat",
    viewport: "mobile",
  },
  {
    group: "chat-mobile",
    label: "chat mobile message list marker",
    selector: '[data-inkframe-mobile-role="chat-message-list"]',
    minCount: 1,
    route: "/chat",
    viewport: "mobile",
  },
  {
    group: "chat-mobile",
    label: "chat mobile composer marker",
    selector: '[data-inkframe-mobile-role="chat-composer"]',
    minCount: 1,
    route: "/chat",
    viewport: "mobile",
  },
  {
    group: "chat-unread",
    label: "sidebar entities carry unread contract",
    selector: '[data-inkframe-object="sidebar-entity"][data-inkframe-unread]',
    minCount: 0,
    route: "/chat",
  },
  {
    group: "chat-unread",
    label: "active unread event badges",
    selector: '[data-inkframe-object="event-badge"][data-inkframe-unread="true"]',
    minCount: 0,
    route: "/chat",
  },
  {
    group: "task-desktop",
    label: "task workspace",
    selector: '[data-inkframe-mobile-role="task-workspace"]',
    minCount: 1,
    route: "/tasks",
    viewport: "desktop",
  },
  {
    group: "task-desktop",
    label: "task controls",
    selector: '[data-inkframe-mobile-role="task-controls"]',
    minCount: 1,
    route: "/tasks",
    viewport: "desktop",
  },
  {
    group: "task-desktop",
    label: "task board",
    selector: '[data-inkframe-mobile-role="task-board"]',
    minCount: 1,
    route: "/tasks",
    viewport: "desktop",
  },
  {
    group: "task-desktop",
    label: "task tickets",
    selector: '[data-inkframe-object="task-ticket"]',
    minCount: 1,
    route: "/tasks",
    viewport: "desktop",
  },
  {
    group: "task-desktop",
    label: "task evidence objects",
    selector: '[data-inkframe-object="evidence"]',
    minCount: 0,
    route: "/tasks",
    viewport: "desktop",
  },
  {
    group: "task-desktop",
    label: "task review objects",
    selector: '[data-inkframe-object="review"]',
    minCount: 0,
    route: "/tasks",
    viewport: "desktop",
  },
  {
    group: "task-mobile",
    label: "task mobile workspace marker",
    selector: '[data-inkframe-mobile-role="task-workspace"]',
    minCount: 1,
    route: "/tasks",
    viewport: "mobile",
  },
  {
    group: "task-mobile",
    label: "task mobile controls marker",
    selector: '[data-inkframe-mobile-role="task-controls"]',
    minCount: 1,
    route: "/tasks",
    viewport: "mobile",
  },
  {
    group: "task-mobile",
    label: "task mobile board marker",
    selector: '[data-inkframe-mobile-role="task-board"]',
    minCount: 1,
    route: "/tasks",
    viewport: "mobile",
  },
  {
    group: "task-mobile",
    label: "task detail marker",
    selector: '[data-inkframe-mobile-role="task-detail"]',
    minCount: 0,
    route: "/tasks",
    viewport: "mobile",
  },
  {
    group: "task-mobile",
    label: "task evidence marker",
    selector: '[data-inkframe-mobile-role="task-evidence"]',
    minCount: 0,
    route: "/tasks",
    viewport: "mobile",
  },
  {
    group: "task-mobile",
    label: "task review marker",
    selector: '[data-inkframe-mobile-role="task-review"]',
    minCount: 0,
    route: "/tasks",
    viewport: "mobile",
  },
  {
    group: "material-state",
    label: "static material surfaces",
    selector: '[data-inkframe-surface="material"][data-inkframe-mode="static"]',
    minCount: 0,
    route: "/chat",
  },
  {
    group: "material-state",
    label: "static material surfaces do not capture pointer",
    selector: '[data-inkframe-surface="material"][data-inkframe-pointer-capture="false"]',
    minCount: 0,
    route: "/chat",
  },
  {
    group: "material-state",
    label: "task static material surfaces",
    selector: '[data-inkframe-surface="material"][data-inkframe-mode="static"]',
    minCount: 0,
    route: "/tasks",
  },
]

export function classifyTabsResult(payload) {
  if (!payload) return "failed_twd"
  if (payload.ok === false && payload.code === "NO_TAB") return "blocked_no_tab"
  if (payload.ok === false) return "failed_twd"
  const tabs = Array.isArray(payload.tabs) ? payload.tabs : []
  if (tabs.length === 0 || payload.count === 0) return "blocked_no_tab"
  return "ready"
}

export function buildTwdTabsCommand() {
  return ["./twd", "--compact", "tabs"]
}

export function resolveEvidencePaths(taskDir) {
  if (!taskDir) throw new Error("taskDir is required")
  const resolvedTaskDir = resolve(ROOT, taskDir)
  const evidenceDir = resolve(resolvedTaskDir, "evidence")
  const jsonPath = resolve(evidenceDir, "twd-inkframe-proof.json")
  const markdownPath = resolve(evidenceDir, "twd-inkframe-proof.md")

  for (const candidate of [evidenceDir, jsonPath, markdownPath]) {
    if (relative(resolvedTaskDir, candidate).startsWith("..")) {
      throw new Error(`Evidence path escapes task directory: ${candidate}`)
    }
  }

  return { taskDir: resolvedTaskDir, evidenceDir, jsonPath, markdownPath }
}

export function buildDomCountScript(selectors) {
  const checksJson = JSON.stringify(
    selectors.map(({ group, label, selector, minCount, maxCount, route, viewport }) => ({
      group,
      label,
      selector,
      minCount,
      maxCount,
      route,
      viewport,
    })),
  )

  return `
const checks = ${checksJson};
const counts = checks.map((check) => ({
  ...check,
  actualCount: document.querySelectorAll(check.selector).length,
}));
return {
  href: location.href,
  pathname: location.pathname,
  viewport: {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  },
  counts,
};
`.trim()
}

function groupByRoute(checks) {
  const groups = new Map()
  for (const check of checks) {
    const routeChecks = groups.get(check.route) ?? []
    routeChecks.push(check)
    groups.set(check.route, routeChecks)
  }
  return groups
}

function runTwdTabs() {
  const command = buildTwdTabsCommand()
  const result = spawnSync(command[0], command.slice(1), {
    cwd: ROOT,
    encoding: "utf8",
  })
  return parseTwdTabsCommandResult(result, command)
}

function parseTwdPayload(output) {
  const raw = String(output ?? "")
  try {
    return parseLastJson(raw)
  } catch {
    return JSON.parse(raw.trim())
  }
}

export function parseTwdTabsCommandResult(result, command = buildTwdTabsCommand()) {
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`
  let parseError = null

  for (const candidate of [result.stdout, result.stderr, output]) {
    if (!String(candidate ?? "").trim()) continue
    try {
      return parseTwdPayload(candidate)
    } catch (error) {
      parseError = error
    }
  }

  const error = parseError ?? new Error(`No JSON object found in command output:\n${output}`)
  if (result.status === 0) {
    return {
      ok: false,
      command: command.join(" "),
      output: output.trim(),
      error: error.message,
    }
  }

  return {
    ok: false,
    command: command.join(" "),
    exitCode: result.status,
    output: output.trim(),
    error: error.message,
  }
}

function checkStatus(check, actualCount) {
  if (actualCount < check.minCount) return "failed"
  if (typeof check.maxCount === "number" && actualCount > check.maxCount) return "failed"
  return "passed"
}

function skippedChecks(reason) {
  return INKFRAME_SELECTOR_CHECKS.map((check) => ({
    ...check,
    status: "skipped",
    error: reason,
  }))
}

function evidenceStatus(checks, routeErrors) {
  if (routeErrors.length > 0) return "failed_route"
  if (checks.some((check) => check.status === "failed")) return "failed_selector"
  return "passed"
}

function createEvidence({ status, tabsResult, checks, notes, routeResults = [], timestamp = new Date().toISOString() }) {
  return {
    status,
    timestamp,
    tabsResult,
    routeResults,
    checks,
    notes,
  }
}

export function createBlockedEvidence({ tabsResult, now = new Date().toISOString() }) {
  return createEvidence({
    status: "blocked_no_tab",
    timestamp: now,
    tabsResult,
    checks: skippedChecks("No connected tab. Browser/mobile proof not claimed."),
    notes: [
      "No connected tab was visible to ./twd.",
      "Browser and mobile acceptance remain pending.",
      "The runner did not launch a browser.",
    ],
  })
}

export function renderMarkdownEvidence(evidence) {
  const lines = [
    "# Inkframe TWD Proof",
    "",
    `Status: \`${evidence.status}\``,
    `Timestamp: \`${evidence.timestamp}\``,
    "",
    "## Notes",
    "",
    ...evidence.notes.map((note) => `- ${note}`),
    "",
    "## Routes",
    "",
  ]

  if (evidence.routeResults.length === 0) {
    lines.push("- No route assertions ran.")
  } else {
    for (const route of evidence.routeResults) {
      lines.push(`- \`${route.route}\`: \`${route.status}\`${route.tabUrl ? ` (${route.tabUrl})` : ""}`)
    }
  }

  lines.push("", "## Selector Checks", "")
  for (const check of evidence.checks) {
    const count = typeof check.actualCount === "number" ? ` count=${check.actualCount}` : ""
    const error = check.error ? ` error=${JSON.stringify(check.error)}` : ""
    lines.push(`- [${check.status === "passed" ? "x" : " "}] ${check.group} / ${check.label}${count}${error}`)
  }

  return `${lines.join("\n")}\n`
}

function writeEvidence(taskDir, evidence) {
  const paths = resolveEvidencePaths(taskDir)
  if (!existsSync(paths.evidenceDir)) mkdirSync(paths.evidenceDir, { recursive: true })
  writeFileSync(paths.jsonPath, `${JSON.stringify(evidence, null, 2)}\n`)
  writeFileSync(paths.markdownPath, renderMarkdownEvidence(evidence))
  return paths
}

export async function runInkframeProof(options = {}) {
  const taskDir = options.taskDir ?? DEFAULT_TASK_DIR
  const tabsResult = options.tabsResult ?? runTwdTabs()
  const tabStatus = classifyTabsResult(tabsResult)

  if (tabStatus === "failed_twd") {
    const evidence = createEvidence({
      status: "failed_twd",
      tabsResult,
      checks: skippedChecks("The initial ./twd tabs command failed."),
      notes: ["The runner could not parse or execute the initial ./twd tab gate."],
    })
    const paths = writeEvidence(taskDir, evidence)
    return { evidence, paths }
  }

  if (tabStatus === "blocked_no_tab") {
    const evidence = createBlockedEvidence({ tabsResult })
    const paths = writeEvidence(taskDir, evidence)
    return { evidence, paths }
  }

  const routeResults = []
  const completedChecks = []
  const routeErrors = []
  const byRoute = groupByRoute(INKFRAME_SELECTOR_CHECKS)

  for (const [route, routeChecks] of byRoute.entries()) {
    try {
      const result = await evalOnTarget(route, buildDomCountScript(routeChecks), {
        accountName: options.accountName,
      })
      const counts = Array.isArray(result.result?.counts) ? result.result.counts : []
      const countsByLabel = new Map(counts.map((item) => [item.label, item]))

      for (const check of routeChecks) {
        const counted = countsByLabel.get(check.label)
        const actualCount = Number(counted?.actualCount ?? 0)
        completedChecks.push({
          ...check,
          actualCount,
          status: checkStatus(check, actualCount),
        })
      }

      routeResults.push({
        route,
        status: "checked",
        tabUrl: result.tabUrl,
        viewport: result.result?.viewport,
      })
    } catch (error) {
      routeErrors.push({ route, error: error.message })
      routeResults.push({ route, status: "failed", error: error.message })
      for (const check of routeChecks) {
        completedChecks.push({ ...check, status: "failed", error: error.message })
      }
    }
  }

  const notes = [
    "Selector assertions ran through the project WebDriver guard wrappers.",
    "Mobile selectors are DOM contract checks; viewport resizing is recorded as pending unless the local twd bridge exposes viewport control.",
  ]
  for (const routeError of routeErrors) {
    notes.push(`${routeError.route} route proof failed: ${routeError.error}`)
  }

  const evidence = createEvidence({
    status: evidenceStatus(completedChecks, routeErrors),
    tabsResult,
    routeResults,
    checks: completedChecks,
    notes,
  })
  const paths = writeEvidence(taskDir, evidence)
  return { evidence, paths }
}

function usage() {
  return `Usage:
  tools/twd-guard/twd-inkframe-proof --task-dir <task-dir> [--account <name>] [--json]

Defaults:
  --task-dir ${DEFAULT_TASK_DIR}
  --account zy-ean through tools/twd-guard defaults`
}

function parseArgs(argv) {
  const parsed = {
    taskDir: DEFAULT_TASK_DIR,
    accountName: undefined,
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "-h" || arg === "--help") {
      parsed.help = true
    } else if (arg === "--task-dir") {
      parsed.taskDir = argv[++index]
    } else if (arg === "--account") {
      parsed.accountName = argv[++index]
    } else if (arg === "--json") {
      parsed.json = true
    } else {
      throw new Error(`Unknown argument: ${arg}\n${usage()}`)
    }
  }

  if (!parsed.taskDir) throw new Error("--task-dir requires a value")
  parsed.taskDir = isAbsolute(parsed.taskDir) ? parsed.taskDir : resolve(ROOT, parsed.taskDir)
  return parsed
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return 0
  }

  const { evidence, paths } = await runInkframeProof(options)
  const summary = {
    ok: evidence.status === "passed",
    status: evidence.status,
    jsonPath: paths.jsonPath,
    markdownPath: paths.markdownPath,
  }

  console.log(options.json ? JSON.stringify(summary) : renderMarkdownEvidence(evidence))

  if (evidence.status === "passed") return 0
  if (evidence.status === "blocked_no_tab") return BLOCKED_EXIT_CODE
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2))
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
