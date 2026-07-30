import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { renderToStaticMarkup } from "react-dom/server"

import {
  AgentSealMark,
  AttachmentSheet,
  AvatarObject,
  ChannelDivider,
  ChatComposerSurface,
  ChatTaskToggle,
  ComputerInkstone,
  EvidenceSurface,
  EventBadge,
  HumanSignatureCard,
  InkframeObjectSurface,
  MemoryFixedNote,
  MessagePaper,
  MessageToolStrip,
  MemberNameTag,
  ObjectField,
  ObjectMetric,
  ObjectToggleField,
  ReviewStamp,
  SidebarEntityItem,
  TaskMaterialSurface,
  TaskTicket,
} from "../components/inkframe-object-ui"
import { EmptyState, ProductRow, RuntimeChip, Toolbar } from "../components/product-ui"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card"
import { Select } from "../components/ui/form"

const frontendRoot = fileURLToPath(new URL("..", import.meta.url))

function sourceFilesUnder(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return sourceFilesUnder(path)
    return /\.(tsx?|css)$/.test(path) ? [path] : []
  })
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "")
}

function countMatches(source: string, pattern: RegExp) {
  return source.match(pattern)?.length ?? 0
}

test("Inkframe object primitives expose stable slots and material state", () => {
  const markup = renderToStaticMarkup(
    <div>
      <InkframeObjectSurface material="dry" raised data-region="object-test">
        <span>paper</span>
      </InkframeObjectSurface>
      <ObjectField label="memberId" value="27e1ab21" />
      <ObjectMetric label="Agents" value={2} description="bound identities" />
      <ObjectToggleField>
        <input type="checkbox" defaultChecked />
        file write
      </ObjectToggleField>
    </div>
  )

  assert.match(markup, /data-slot="inkframe-object-surface"/)
  assert.match(markup, /data-object="surface"/)
  assert.match(markup, /data-material="dry"/)
  assert.match(markup, /data-region="object-test"/)
  assert.match(markup, /sk-object-surface/)
  assert.match(markup, /sk-object-raised/)
  assert.match(markup, /data-slot="object-field"/)
  assert.match(markup, /data-object="field"/)
  assert.match(markup, /data-slot="object-field-label"/)
  assert.match(markup, /data-slot="object-field-value"/)
  assert.match(markup, /data-slot="object-metric"/)
  assert.match(markup, /data-object="metric"/)
  assert.match(markup, /data-slot="object-metric-description"/)
  assert.match(markup, /data-slot="object-toggle-field"/)
  assert.match(markup, /data-object="toggle-field"/)
  assert.match(markup, /sk-object-toggle-field/)
})

test("Identity and runtime metaphors expose desk-object slots", () => {
  const agentMember = {
    id: "agent-1",
    name: "gate-minimax",
    displayName: "gate-minimax",
    kind: "agent",
    status: "running",
  }
  const humanMember = {
    id: "human-1",
    name: "zy-ean",
    displayName: "zy-ean",
    kind: "human",
    status: "online",
  }
  const markup = renderToStaticMarkup(
    <div>
      <AvatarObject member={agentMember} size="sm" />
      <AvatarObject member={humanMember} size="sm" />
      <AgentSealMark status="running">
        <span>agent avatar</span>
      </AgentSealMark>
      <HumanSignatureCard>
        <span>human avatar</span>
      </HumanSignatureCard>
      <ChannelDivider kind="dm" active>
        inkframe-ui
      </ChannelDivider>
      <EventBadge count={4} active label="4 unread" />
      <SidebarEntityItem
        href="/chat/general"
        active
        tone="blue"
        title="general"
        subtitle="workspace"
        unreadCount={2}
        unreadLabel="2 unread"
      />
      <ComputerInkstone status="online" compact>
        <span>daemon host</span>
      </ComputerInkstone>
    </div>
  )

  assert.match(markup, /data-slot="avatar-object"/)
  assert.match(markup, /data-object="avatar"/)
  assert.match(markup, /data-avatar-kind="agent"/)
  assert.match(markup, /data-avatar-kind="human"/)
  assert.match(markup, /data-slot="agent-seal-mark"/)
  assert.match(markup, /data-object="agent-identity"/)
  assert.match(markup, /data-status="running"/)
  assert.match(markup, /sk-agent-seal-mark/)
  assert.match(markup, /data-slot="human-signature-card"/)
  assert.match(markup, /data-object="human-identity"/)
  assert.match(markup, /sk-human-signature-card/)
  assert.match(markup, /data-slot="channel-divider"/)
  assert.match(markup, /data-object="channel"/)
  assert.match(markup, /data-kind="dm"/)
  assert.match(markup, /data-active="true"/)
  assert.match(markup, /sk-channel-divider-active/)
  assert.match(markup, /data-slot="event-badge"/)
  assert.match(markup, /data-object="event-badge"/)
  assert.match(markup, /data-inkframe-object="event-badge"/)
  assert.match(markup, /data-inkframe-unread="true"/)
  assert.match(markup, /sk-event-badge-active/)
  assert.match(markup, /data-slot="sidebar-entity-item"/)
  assert.match(markup, /data-object="sidebar-entity"/)
  assert.match(markup, /data-inkframe-object="sidebar-entity"/)
  assert.match(markup, /data-unread="true"/)
  assert.match(markup, /data-inkframe-unread="true"/)
  assert.match(markup, /data-slot="computer-inkstone"/)
  assert.match(markup, /data-object="computer"/)
  assert.match(markup, /data-compact="true"/)
  assert.match(markup, /sk-computer-inkstone/)
})

test("ComputerInkstone uses a local status object instead of a full-width bottom rail", () => {
  const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  assert.match(globalCss, /\.sk-computer-inkstone::after\s*\{\s*content:\s*none;/)
  assert.match(globalCss, /\.sk-computer-inkstone-well[\s\S]*?right:\s*1\.02rem;[\s\S]*?top:\s*0\.92rem;[\s\S]*?width:\s*0\.58rem;/)
  assert.doesNotMatch(globalCss, /\.sk-computer-inkstone-well\s*\{[\s\S]*?left:\s*0\.98rem;[\s\S]*?right:\s*0\.98rem;[\s\S]*?bottom:/)
})

test("MessagePaper only tilts short messages", () => {
  const shortMarkup = renderToStaticMarkup(<MessagePaper length={12}>short</MessagePaper>)
  const mediumMarkup = renderToStaticMarkup(<MessagePaper length={88}>medium</MessagePaper>)
  const longMarkup = renderToStaticMarkup(<MessagePaper length={180}>long</MessagePaper>)

  assert.match(shortMarkup, /data-slot="message-paper"/)
  assert.match(shortMarkup, /data-object="chat-message"/)
  assert.match(shortMarkup, /data-density="short"/)
  assert.match(shortMarkup, /sk-message-paper-tilt/)
  assert.match(mediumMarkup, /data-density="medium"/)
  assert.doesNotMatch(mediumMarkup, /sk-message-paper-tilt/)
  assert.doesNotMatch(mediumMarkup, /soft-tilt/)
  assert.match(longMarkup, /data-density="long"/)
  assert.doesNotMatch(longMarkup, /sk-message-paper-tilt/)
})

test("Short message paper does not stamp every slip with the same clip decoration", () => {
  const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  assert.doesNotMatch(globalCss, /\.sk-message-paper\[data-density="short"\]::before/)
  assert.doesNotMatch(globalCss, /\.sk-message-paper\[data-density="short"\]::after/)
})

test("Inkframe object language does not add broad component rotation", () => {
  const taskBoardSource = readFileSync(new URL("../components/task-board.tsx", import.meta.url), "utf8")
  const objectUiSource = readFileSync(new URL("../components/inkframe-object-ui.tsx", import.meta.url), "utf8")
  const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  assert.doesNotMatch(taskBoardSource, /rotate-\d/)
  assert.doesNotMatch(objectUiSource, /soft-tilt/)

  const rotateCount = globalCss.match(/rotate\(/g)?.length ?? 0
  assert.equal(rotateCount, 3)
  assert.match(globalCss, /\.sk-message-paper-tilt\s*\{\s*transform:\s*rotate\(-0\.45deg\)/)
  assert.match(globalCss, /\.sk-review-stamp[\s\S]*?transform:\s*rotate\(-1deg\)/)
  assert.match(globalCss, /\.sk-empty-note::before[\s\S]*?transform:\s*rotate\(2\.5deg\)/)
})

test("User-facing product surfaces avoid route-local legacy color blocks", () => {
  const sourceFiles = [
    ...sourceFilesUnder(join(frontendRoot, "app")),
    ...sourceFilesUnder(join(frontendRoot, "components")),
  ].filter((path) =>
    !path.includes(`${join("app", "daemon")}${"/"}`) &&
    !path.includes(`${join("app", "control")}${"/"}`) &&
    !path.endsWith(join("app", "globals.css"))
  )

  for (const path of sourceFiles) {
    const source = stripComments(readFileSync(path, "utf8"))
    assert.doesNotMatch(
      source,
      /\b(?:bg|text|border)-(?:blue|purple|rose|pink|sky|cyan|emerald|amber|green)-\d{2,3}\b/,
      path
    )
    assert.doesNotMatch(source, /\bsk-status-success\b/, path)
  }
})

test("Internal control pages are excluded from the object-desk product surface pass", () => {
  const daemonSource = readFileSync(new URL("../app/(app)/daemon/page.tsx", import.meta.url), "utf8")
  const controlSources = sourceFilesUnder(join(frontendRoot, "app", "(app)", "control"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n")
  const objectPrimitiveImports = /@\/components\/inkframe-object-ui|ComputerInkstone|TaskMaterialSurface|MessagePaper|EvidenceSurface/

  assert.doesNotMatch(daemonSource, objectPrimitiveImports)
  assert.doesNotMatch(controlSources, objectPrimitiveImports)
})

test("Login and join entry surfaces keep the dry-paper object language", () => {
  const loginSource = readFileSync(new URL("../app/login/page.tsx", import.meta.url), "utf8")
  const joinSource = readFileSync(new URL("../app/join/[token]/page.tsx", import.meta.url), "utf8")

  assert.match(loginSource, /data-slot="workbench-desk"/)
  assert.match(loginSource, /sk-workbench-desk/)
  assert.match(loginSource, /InkframeObjectSurface material="blocked"/)
  assert.match(loginSource, /InkframeObjectSurface material="dry"/)
  assert.doesNotMatch(loginSource, /<select\b/)

  assert.match(joinSource, /data-slot="workbench-desk"/)
  assert.match(joinSource, /sk-workbench-desk/)
  assert.match(joinSource, /InkframeObjectSurface material="blocked"/)
  assert.match(joinSource, /InkframeObjectSurface material="dry"/)
  assert.match(joinSource, /ObjectField/)
})

test("Inkframe background contract has one shell owner", () => {
  const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  // P2: shell chrome (rail + background + engine) moved from product-shell.tsx
  // into the shared app/(app)/layout.tsx so it mounts once across navigations.
  const shellSource = readFileSync(new URL("../app/(app)/layout.tsx", import.meta.url), "utf8")
  const bodySource = readFileSync(new URL("../components/product-shell.tsx", import.meta.url), "utf8")
  const backgroundSource = readFileSync(new URL("../components/inkframe/app-desk-background.tsx", import.meta.url), "utf8")

  assert.match(globalCss, /--desk-paper-bg:/)
  assert.match(globalCss, /--sheet-paper-bg:/)
  assert.equal(globalCss.match(/\.sk-paper-field\s*\{/g)?.length ?? 0, 1)
  // background + engine now live in the (app) shell layout (single mount)
  assert.match(shellSource, /AppDeskBackground/)
  assert.equal(countMatches(shellSource, /<AppDeskBackground\b/g), 1)
  assert.match(shellSource, /data-inkframe-background-owner="product-shell"/)
  assert.match(shellSource, /data-inkframe-background-scope="global-desk"/)
  assert.match(shellSource, /InkMaterialRuntimeScript/)
  assert.equal(countMatches(shellSource, /<InkMaterialRuntimeScript\b/g), 1)
  assert.match(shellSource, /sm:ml-14/)
  assert.doesNotMatch(shellSource, /className="relative z-10 ml-14/)
  // the slimmed ProductShell is body-only now: it must NOT mount the background/engine
  assert.doesNotMatch(bodySource, /AppDeskBackground/, "product-shell.tsx must not mount AppDeskBackground after the P2 lift")
  assert.doesNotMatch(bodySource, /InkMaterialRuntimeScript/, "product-shell.tsx must not mount InkMaterialRuntimeScript after the P2 lift")
  assert.match(backgroundSource, /data-inkframe-background-owner="product-shell"/)
  assert.match(backgroundSource, /data-inkframe-background-scope="global-desk"/)
  assert.match(backgroundSource, /data-inkframe-resource-owner-kind=\{resource\?\.ownerKind \?\? "app-background"\}/)
  assert.match(backgroundSource, /data-inkframe-resource-tint=\{resource\?\.tint \?\? "desk"\}/)
  assert.match(backgroundSource, /const sourceMode = resource\?\.sourceKind \?\? "none"/)
  assert.match(backgroundSource, /data-inkframe-resource-source-kind=\{sourceMode\}/)
  assert.match(backgroundSource, /MaterialSurface/)
  assert.match(backgroundSource, /ownerKind="app-background"/)
  assert.match(backgroundSource, /ownerId="global-desk"/)
  assert.match(backgroundSource, /tint="desk"/)
  assert.match(backgroundSource, /"use client"/)
  assert.match(backgroundSource, /APP_DESK_MATERIAL_EVENT/)
  assert.match(backgroundSource, /onResourceChange=\{setResource\}/)
  assert.match(backgroundSource, /onModeChange=\{setMaterialMode\}/)
  assert.match(backgroundSource, /pointerMode=\{pointerMode\}/)
  assert.match(backgroundSource, /data-inkframe-background-source-mode/)
  assert.match(backgroundSource, /data-inkframe-background-has-visual/)
  assert.match(backgroundSource, /data-inkframe-background-has-restore/)
  assert.match(backgroundSource, /data-inkframe-background-has-source/)
  assert.match(globalCss, /\.sk-app-desk-background[\s\S]*?position:\s*fixed/)
  assert.match(globalCss, /\.sk-app-desk-material[\s\S]*?position:\s*absolute/)
  assert.match(globalCss, /\.sk-app-desk-static[\s\S]*?background-image:/)
  assert.match(globalCss, /\.sk-paper-field[\s\S]*?background-image:\s*var\(--sheet-paper-bg\)/)
  assert.match(globalCss, /\.sk-chat-main[\s\S]*?background-image:\s*var\(--sheet-paper-bg\)/)
  assert.match(globalCss, /\.sk-chat-message-list[\s\S]*?background-color:\s*transparent/)
})

test("User-facing product routes share the ProductShell desk owner without page-local app backgrounds", () => {
  const routeContracts = [
    { route: "/", page: "../app/(app)/page.tsx", shellOwner: "../app/(app)/page.tsx" },
    { route: "/chat", page: "../app/(app)/chat/page.tsx", shellOwner: "../app/(app)/chat/layout.tsx" },
    { route: "/chat/[channel]", page: "../app/(app)/chat/[channel]/page.tsx", shellOwner: "../app/(app)/chat/layout.tsx" },
    { route: "/tasks", page: "../app/(app)/tasks/page.tsx", shellOwner: "../app/(app)/tasks/page.tsx" },
    { route: "/members", page: "../app/(app)/members/page.tsx", shellOwner: "../app/(app)/members/page.tsx" },
    { route: "/computers", page: "../app/(app)/computers/page.tsx", shellOwner: "../app/(app)/computers/page.tsx" },
    { route: "/settings", page: "../app/(app)/settings/page.tsx", shellOwner: "../app/(app)/settings/page.tsx" },
    { route: "/login", page: "../app/login/page.tsx", entrySurface: true },
    { route: "/join/[token]", page: "../app/join/[token]/page.tsx", entrySurface: true },
  ] as const
  const expectedUserFacingRoutes = [
    "/",
    "/chat",
    "/chat/[channel]",
    "/tasks",
    "/members",
    "/computers",
    "/settings",
    "/login",
    "/join/[token]",
  ] as const
  const coveredSources = Array.from(new Set([
    "../components/product-shell.tsx",
    // P2: the shell chrome now lives in the shared (app) layout
    "../app/(app)/layout.tsx",
    ...routeContracts.flatMap((contract) => [contract.page, "shellOwner" in contract ? contract.shellOwner : contract.page]),
  ]))
  const productSources = coveredSources
    .map((route) => readFileSync(new URL(route, import.meta.url), "utf8"))
    .join("\n")

  assert.deepEqual(routeContracts.map((contract) => contract.route), [...expectedUserFacingRoutes])
  assert.doesNotMatch(routeContracts.map((contract) => contract.route).join("\n"), /^\/(?:control|daemon|dm)(?:\/|$)/m)

  for (const contract of routeContracts) {
    const pageSource = readFileSync(new URL(contract.page, import.meta.url), "utf8")
    assert.doesNotMatch(pageSource, /AppDeskBackground/, `${contract.route} should not mount a route-local app desk background`)

    if ("shellOwner" in contract) {
      const shellSource = readFileSync(new URL(contract.shellOwner, import.meta.url), "utf8")
      assert.match(
        shellSource,
        /import\s+\{\s*ProductShell\s*\}\s+from\s+"@\/components\/product-shell"/,
        `${contract.route} should be covered by a ProductShell owner`,
      )
      assert.match(shellSource, /<ProductShell\b/, `${contract.route} should render through ProductShell`)
      assert.doesNotMatch(shellSource, /AppDeskBackground/, `${contract.route} should not mount AppDeskBackground outside ProductShell`)
      continue
    }

    if ("entrySurface" in contract) {
      assert.match(pageSource, /data-slot="workbench-desk"/, `${contract.route} should still use the dry-paper workbench surface`)
      assert.match(pageSource, /sk-workbench-desk/, `${contract.route} should keep the clean desk entry background`)
    }
  }

  assert.equal(countMatches(productSources, /import\s+\{\s*AppDeskBackground\s*\}/g), 1)
  assert.equal(countMatches(productSources, /<AppDeskBackground\b/g), 1)
  assert.doesNotMatch(productSources, /\b(?:bg|text|border)-(?:pink|purple|sky|cyan|emerald|amber)-\d{2,3}\b/)
})

test("ProductShell foreground regions expose contrast owners over material backgrounds", () => {
  const shellBodySource = readFileSync(new URL("../components/product-shell-body.tsx", import.meta.url), "utf8")

  assert.match(shellBodySource, /data-inkframe-contrast-owner="workbench-header"/)
  assert.match(shellBodySource, /data-inkframe-contrast-owner="list-panel"/)
  assert.match(shellBodySource, /data-inkframe-contrast-owner="main-panel"/)
  assert.match(shellBodySource, /data-inkframe-contrast-owner="side-panel"/)
  assert.match(shellBodySource, /data-inkframe-foreground-surface="paper-stack"/)
  assert.match(shellBodySource, /data-inkframe-foreground-surface="paper-field"/)
  assert.match(shellBodySource, /data-inkframe-foreground-surface="side-paper"/)
})

test("Chat controls expose explicit object slots without page-local wrappers", () => {
  const markup = renderToStaticMarkup(
    <div>
      <MessageToolStrip>
        <button type="button">copy</button>
      </MessageToolStrip>
      <ChatComposerSurface>
        <input name="content" />
      </ChatComposerSurface>
      <ChatTaskToggle active>
        <span data-slot="chat-task-toggle-mark" />
        Task
      </ChatTaskToggle>
    </div>
  )

  assert.match(markup, /data-slot="message-tool-strip"/)
  assert.match(markup, /data-object="message-actions"/)
  assert.match(markup, /data-inkframe-object="message-actions"/)
  assert.match(markup, /data-inkframe-state="toolbar-hidden"/)
  assert.match(markup, /sk-message-tool-strip/)
  assert.match(markup, /data-slot="chat-composer-surface"/)
  assert.match(markup, /data-object="composer"/)
  assert.match(markup, /sk-chat-composer-surface/)
  assert.match(markup, /data-slot="chat-task-toggle"/)
  assert.match(markup, /data-object="task-toggle"/)
  assert.match(markup, /data-active="true"/)
  assert.match(markup, /sk-chat-task-toggle-active/)
})

test("Chat side panels expose attachment sheets and member name tags", () => {
  const markup = renderToStaticMarkup(
    <div>
      <AttachmentSheet kind="image">
        <span>diagram.png</span>
      </AttachmentSheet>
      <MemberNameTag kind="agent" status="running">
        <span>Kimi Debugger</span>
      </MemberNameTag>
    </div>
  )

  assert.match(markup, /data-slot="attachment-sheet"/)
  assert.match(markup, /data-object="attachment"/)
  assert.match(markup, /data-attachment-kind="image"/)
  assert.match(markup, /sk-attachment-sheet/)
  assert.match(markup, /data-slot="member-name-tag"/)
  assert.match(markup, /data-object="member"/)
  assert.match(markup, /data-member-kind="agent"/)
  assert.match(markup, /data-status="running"/)
  assert.match(markup, /sk-member-name-tag/)
})

test("Evidence, review, task, and memory objects keep separate semantics", () => {
  const markup = renderToStaticMarkup(
    <div>
      <TaskMaterialSurface status="in_review">task docket</TaskMaterialSurface>
      <EvidenceSurface kind="trace">runtime observed</EvidenceSurface>
      <ReviewStamp tone="approved">APPROVED</ReviewStamp>
      <TaskTicket href="/tasks?task=42" status="review">deploy-auth #42</TaskTicket>
      <MemoryFixedNote fixed>settled memory</MemoryFixedNote>
    </div>
  )

  assert.match(markup, /data-slot="task-material-surface"/)
  assert.match(markup, /data-object="task"/)
  assert.match(markup, /data-inkframe-object="task-ticket"/)
  assert.match(markup, /data-task-material="drying"/)
  assert.match(markup, /sk-task-material-surface/)
  assert.match(markup, /data-slot="evidence-surface"/)
  assert.match(markup, /data-object="evidence"/)
  assert.match(markup, /data-inkframe-object="evidence"/)
  assert.match(markup, /data-evidence-kind="trace"/)
  assert.match(markup, /runtime observed/)
  assert.match(markup, /data-slot="review-stamp"/)
  assert.match(markup, /data-object="review"/)
  assert.match(markup, /data-inkframe-object="review"/)
  assert.match(markup, /data-tone="approved"/)
  assert.match(markup, /APPROVED/)
  assert.match(markup, /data-slot="task-ticket"/)
  assert.match(markup, /data-object="task-link"/)
  assert.match(markup, /data-inkframe-object="task-ticket"/)
  assert.match(markup, /data-status="review"/)
  assert.match(markup, /href="\/tasks\?task=42"/)
  assert.match(markup, /data-slot="memory-fixed-note"/)
  assert.match(markup, /data-object="memory"/)
  assert.match(markup, /data-fixed="true"/)
})

test("Default product primitives carry the inkframe object language", () => {
  const markup = renderToStaticMarkup(
    <div>
      <Card>
        <CardHeader>
          <CardTitle>Workbench object</CardTitle>
        </CardHeader>
        <CardContent>paper body</CardContent>
      </Card>
      <Toolbar>tools</Toolbar>
      <RuntimeChip tone="paper">runtime ready</RuntimeChip>
      <EmptyState title="No tasks" description="Create one from chat." />
      <ProductRow>row evidence</ProductRow>
    </div>
  )

  assert.match(markup, /data-slot="card"/)
  assert.match(markup, /sk-object-card/)
  assert.match(markup, /data-slot="toolbar"/)
  assert.match(markup, /sk-object-toolbar/)
  assert.match(markup, /data-slot="runtime-chip"/)
  assert.match(markup, /bg-\[var\(--paper\)\]/)
  assert.match(markup, /runtime ready/)
  assert.match(markup, /data-slot="empty-state"/)
  assert.match(markup, /sk-empty-note/)
  assert.match(markup, /sk-product-row/)
})

test("Select supports structured disabled options without leaving the shared form primitive", () => {
  const markup = renderToStaticMarkup(
    <Select
      id="provider"
      name="runtimeProvider"
      items={[
        { value: "glm", label: "GLM" },
        { value: "__unavailable", label: "Unavailable providers", disabled: true },
      ]}
      emptyLabel="Default"
    />
  )

  assert.match(markup, /id="provider"/)
  assert.match(markup, /name="runtimeProvider"/)
  assert.match(markup, /<option value="">Default<\/option>/)
  assert.match(markup, /<option value="__unavailable" disabled="">Unavailable providers<\/option>/)
  assert.match(markup, /border-2/)
})

test("Main page object taxonomy documents and preserves aligned object classes", () => {
  const design = readFileSync(
    join(frontendRoot, "..", ".trellis/tasks/archive/2026-07/06-30-ink-wash-theme-exploration/design.md"),
    "utf8"
  )
  const languageMap = readFileSync(
    join(frontendRoot, "..", ".trellis/tasks/archive/2026-07/06-30-ink-wash-theme-exploration/visual-language-map.md"),
    "utf8"
  )
  const alignmentNotes = readFileSync(
    join(frontendRoot, "..", ".trellis/tasks/archive/2026-07/06-30-ink-wash-theme-exploration/object-language-alignment.md"),
    "utf8"
  )
  const chatSources = [
    readFileSync(new URL("../app/(app)/chat/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/chat-sidebar.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/message-frame.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const taskSources = [
    readFileSync(new URL("../app/(app)/tasks/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-route-projection.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-material-state.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-board.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-list-panel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-dnd-board.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const memberSources = [
    readFileSync(new URL("../app/(app)/members/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/members/members-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/members/activity-tab.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/agent-activity-list.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const computerSources = [
    readFileSync(new URL("../app/(app)/computers/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/computers/connect-computer-form.tsx", import.meta.url), "utf8"),
  ].join("\n")

  assert.match(design, /## Main Page Object Taxonomy and Alignment/)
  assert.match(design, /visual-language-map\.md/)
  assert.match(alignmentNotes, /## Motion Semantics/)
  assert.match(alignmentNotes, /If hover makes an object move, lift, drift, or float, the object should be movable/)
  assert.match(alignmentNotes, /Drop Target Rule/)
  assert.match(languageMap, /hover motion such as lift, drift, or/)
  for (const label of ["anchor", "primary", "meta", "state", "actions", "evidence"]) {
    assert.match(design, new RegExp(`\\*\\*${label}\\*\\*`))
    assert.match(languageMap, new RegExp(`\\b${label}\\b`))
  }
  for (const objectName of [
    "Chat / DM",
    "Tasks",
    "Members",
    "Computers",
    "data-object=\"chat-message\"",
    "data-object=\"avatar\"",
    "data-object=\"task\"",
    "data-object=\"member\"",
    "data-object=\"computer\"",
    "data-object=\"evidence\"",
  ]) {
    assert.match(design, new RegExp(objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
  }

  for (const phrase of [
    "消息纸片",
    "消息工具条",
    "频道签",
    "成员名签",
    "头像",
    "头像预制体",
    "agent 头像外框",
    "人类头像外框",
    "任务票据",
    "证据纸",
    "审阅印章",
    "记忆便签",
    "附件纸",
    "电脑砚台",
    "runtime 纸标",
    "字段账本",
    "指标签",
    "工作桌背景",
  ]) {
    assert.match(languageMap, new RegExp(phrase), `visual language map should define ${phrase}`)
  }

  for (const selector of [
    'data-object="chat-message"',
    'data-object="avatar"',
    'data-object="message-actions"',
    'data-object="channel"',
    'data-object="member"',
    'data-object="agent-identity"',
    'data-object="human-identity"',
    'data-object="task"',
    'data-object="task-link"',
    'data-object="evidence"',
    'data-object="review"',
    'data-object="memory"',
    'data-object="attachment"',
    'data-object="computer"',
    'data-slot="runtime-chip"',
    'data-object="field"',
    'data-object="metric"',
  ]) {
    assert.match(languageMap, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `visual language map should target ${selector}`)
  }

  for (const required of ["ChannelDivider", "MemberNameTag", "AvatarObject", "MessageToolStrip", "ChatTaskToggle", "AttachmentSheet", "MessagePaper", "SidebarEntityItem"]) {
    assert.match(chatSources, new RegExp(required), `chat should preserve ${required}`)
  }
  assert.doesNotMatch(chatSources, /import\s+\{\s*MemberAvatar\s*\}\s+from\s+"@\/components\/member-avatar"/)
  assert.doesNotMatch(chatSources, /<MemberAvatar\b/)
  for (const required of ["TaskMaterialSurface", "EvidenceSurface", "ReviewStamp", "MemoryFixedNote", "TaskTicket"]) {
    assert.match(taskSources, new RegExp(required), `tasks should preserve ${required}`)
  }
  for (const required of ["MemberNameTag", "AvatarObject", "ObjectField", "ObjectMetric", "ComputerInkstone", "EvidenceSurface"]) {
    assert.match(memberSources, new RegExp(required), `members should preserve ${required}`)
  }
  assert.doesNotMatch(memberSources, /import\s+\{\s*MemberAvatar\s*\}\s+from\s+"@\/components\/member-avatar"/)
  assert.doesNotMatch(memberSources, /<MemberAvatar\b/)
  for (const required of ["ComputerInkstone", "RuntimeChip", "ObjectField", "ObjectMetric", "AttachmentSheet"]) {
    assert.match(computerSources, new RegExp(required), `computers should preserve ${required}`)
  }
})
