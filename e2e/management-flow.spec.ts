import { randomUUID } from "node:crypto"

import { expect, test, type APIRequestContext, type Page } from "@playwright/test"
import WebSocket, { type RawData } from "ws"

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the authenticated integration flow`)
  return value
}

const API_BASE = requiredEnv("API_BASE")
requiredEnv("FRONTEND_BASE")
const PUBLIC_KEY = requiredEnv("E2E_PUBLIC_API_KEY")
const RUN_NAMESPACE = requiredEnv("E2E_RUN_NAMESPACE").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 24)
const DATABASE_SCOPE = requiredEnv("E2E_DATABASE_SCOPE")
const DAEMON_VERSION = requiredEnv("E2E_DAEMON_VERSION")

if (!RUN_NAMESPACE) {
  throw new Error("E2E_RUN_NAMESPACE must contain at least one letter or digit")
}
if (DATABASE_SCOPE !== "disposable") {
  throw new Error("E2E_DATABASE_SCOPE must be 'disposable'; this flow must never target a shared database")
}

type AccountSession = {
  account: { id: string; name: string; displayName?: string | null }
  server: { id: string; name: string }
  member: { id: string; displayName?: string | null }
  memberships?: Array<{
    server: { id: string; name: string }
    role: string
    status: string
  }>
}

function scopedHeaders(sessionToken: string, serverId: string) {
  return {
    "X-Public-Key": PUBLIC_KEY,
    "X-Account-Token": sessionToken,
    "X-Server-Id": serverId,
  }
}

async function scopedPost<T>(
  request: APIRequestContext,
  path: string,
  body: Record<string, unknown>,
  sessionToken: string,
  serverId: string,
) {
  const response = await request.post(`${API_BASE}${path}`, {
    headers: {
      ...scopedHeaders(sessionToken, serverId),
      "Content-Type": "application/json",
    },
    data: body,
  })
  expect(response.status(), `POST ${path} must succeed`).toBeGreaterThanOrEqual(200)
  expect(response.status(), `POST ${path} must succeed`).toBeLessThan(300)
  return response.json() as Promise<T>
}

function daemonWebSocket(machineToken: string, computerId: string, cursor?: string) {
  const url = new URL("/internal/agent-api/ws", API_BASE.replace(/^http/, "ws"))
  if (cursor !== undefined) url.searchParams.set("eventLogCursor", cursor)
  return new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${machineToken}`,
      "X-Computer-Id": computerId,
    },
  })
}

function waitForOpen(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      ws.off("open", onOpen)
      ws.off("error", onError)
      ws.off("close", onClose)
    }
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error("Daemon WebSocket closed before opening"))
    }
    ws.once("open", onOpen)
    ws.once("error", onError)
    ws.once("close", onClose)
  })
}

function observeJsonEvents(ws: WebSocket) {
  const events: Array<Record<string, unknown>> = []
  let closed = false
  let socketError: Error | undefined
  const onMessage = (data: RawData) => {
    try {
      events.push(JSON.parse(data.toString()) as Record<string, unknown>)
    } catch {
      // Non-JSON control frames are irrelevant to this delivery contract.
    }
  }
  const onClose = () => {
    closed = true
  }
  const onError = (error: Error) => {
    socketError = error
  }
  ws.on("message", onMessage)
  ws.on("close", onClose)
  ws.on("error", onError)
  return {
    events,
    get closed() {
      return closed
    },
    get error() {
      return socketError
    },
    stop() {
      ws.off("message", onMessage)
      ws.off("close", onClose)
      ws.off("error", onError)
    },
  }
}

function waitForEvent(
  ws: WebSocket,
  predicate: (event: Record<string, unknown>) => boolean,
  timeoutMs = 5_000,
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      ws.off("message", onMessage)
      ws.off("error", onError)
      ws.off("close", onClose)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error("Timed out waiting for the expected daemon WebSocket event"))
    }, timeoutMs)
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    const onClose = () => {
      cleanup()
      reject(new Error("Daemon WebSocket closed before the expected live event"))
    }
    const onMessage = (data: RawData) => {
      let event: Record<string, unknown>
      try {
        event = JSON.parse(data.toString()) as Record<string, unknown>
      } catch {
        return
      }
      if (!predicate(event)) return
      cleanup()
      resolve(event)
    }
    ws.on("message", onMessage)
    ws.once("error", onError)
    ws.once("close", onClose)
  })
}

function waitForObservationWindow(durationMs = 300) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs))
}

function closeWebSocket(ws: WebSocket, timeoutMs = 5_000) {
  return new Promise<void>((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      ws.off("close", onClose)
      reject(new Error("Timed out closing the daemon WebSocket"))
    }, timeoutMs)
    const onClose = () => {
      clearTimeout(timer)
      resolve()
    }
    ws.once("close", onClose)
    ws.close()
  })
}

async function assertAuthenticatedPage(page: Page, accountLabel: string, serverName: string) {
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/)
  const switcher = page.locator('[data-region="server-switcher"]')
  const summary = switcher.locator("summary")
  await expect(summary).toHaveAttribute("title", serverName)
  await summary.click()
  await expect(switcher).toContainText(accountLabel)
  await expect(switcher).toContainText(serverName)
  await summary.click()
}

async function assertTenantRejections(
  request: APIRequestContext,
  sessionToken: string,
  serverId: string,
) {
  const publicKeyOnly = await request.get(`${API_BASE}/api/v1/computers`, {
    headers: {
      "X-Public-Key": PUBLIC_KEY,
      "X-Server-Id": serverId,
    },
  })
  expect(publicKeyOnly.status(), "a public client key is not a human login").toBe(401)

  const foreignServer = await request.get(`${API_BASE}/api/v1/computers`, {
    headers: scopedHeaders(sessionToken, randomUUID()),
  })
  expect(foreignServer.status(), "an authenticated account cannot select a foreign Server").toBe(403)
}

test.describe("Authenticated management integration", () => {
  test("signs up, proves account and Server scope, then creates a scoped connect command", async ({
    page,
    request,
    context,
  }) => {
    const unique = `${RUN_NAMESPACE}-${randomUUID().slice(0, 8)}`
    const displayName = `E2E ${unique}`
    const email = `e2e+${unique.toLowerCase()}@example.test`
    const password = `Aa1!-${randomUUID()}-${randomUUID()}`
    const computerName = `e2e-computer-${unique}`
    const agentName = `e2e-agent-${unique}`
    const channelName = `e2e-${unique}`
    const connectDialog = page.getByTestId("connect-computer-dialog")
    let connectToken: string | undefined

    await test.step("establish a supported browser session through the real login form", async () => {
      await page.goto("/login?returnTo=/computers")
      await page.locator("#login-email").fill(email)
      await page.locator("#login-password").fill(password)
      await page.locator("#login-display-name").fill(displayName)
      await page.locator('button[name="mode"][value="signup"]').click()
      await expect(page).toHaveURL(/\/computers(?:\?|$)/)
      await expect(page.locator('[data-region="server-switcher"]')).toBeVisible()
    })

    await test.step("acknowledge the empty-Server connect dialog before using global chrome", async () => {
      await expect(connectDialog).toBeVisible()
      await connectDialog.locator('[data-slot="dialog-close"]').click()
      await expect(connectDialog).toBeHidden()
    })

    const cookies = await context.cookies()
    const sessionToken = cookies.find((cookie) => cookie.name === "smallkhoj_session")?.value
    const activeServerId = cookies.find((cookie) => cookie.name === "smallkhoj_active_server")?.value
    expect(sessionToken, "login must establish the SmallKhoj account session").toBeTruthy()
    expect(activeServerId, "login must select an active Server").toBeTruthy()

    const me = await request.get(`${API_BASE}/api/v1/auth/me`, {
      headers: scopedHeaders(sessionToken!, activeServerId!),
    })
    expect(me.status()).toBe(200)
    const session = (await me.json()) as AccountSession
    expect(session.server.id).toBe(activeServerId)
    expect(session.account.displayName).toBe(displayName)
    expect(session.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          server: expect.objectContaining({ id: activeServerId }),
          role: "owner",
          status: "active",
        }),
      ]),
    )

    await assertTenantRejections(request, sessionToken!, activeServerId!)
    await assertAuthenticatedPage(page, displayName, session.server.name)

    await test.step("exercise one representative Server-scoped management mutation", async () => {
      const correctScope = await request.get(`${API_BASE}/api/v1/computers`, {
        headers: scopedHeaders(sessionToken!, activeServerId!),
      })
      expect(correctScope.status()).toBe(200)

      await page.getByTestId("add-computer-button").click()
      await expect(connectDialog).toBeVisible()
      const connectForm = connectDialog.locator("form").filter({ has: page.locator("#computer-name") })
      await connectForm.locator("#computer-name").fill(computerName)
      await connectForm.locator('button[type="submit"]').click()
      await expect(page).toHaveURL(/\/computers\?created=/)
      await expect(page.getByTestId("pending-computer-name")).toHaveText(computerName)
      await expect(page.getByTestId("pending-server-name")).toHaveText(session.server.name)
      await expect(page.getByTestId("daemon-connect-command")).toContainText("npx -y --package")
      await expect(page.getByTestId("daemon-connect-command")).toContainText("--api-key")
      const command = (await page.getByTestId("daemon-connect-command").textContent()) ?? ""
      connectToken = /(?:^|\s)--api-key\s+(sk_connect_[A-Za-z0-9_-]+)(?=\s|$)/.exec(command)?.[1]
      expect(connectToken, "the supported connect command must contain a one-time token").toBeTruthy()
    })

    await test.step("preserve real daemon WebSocket live/no-replay coverage", async () => {
      const machineId = `machine-${unique}`
      const connect = await request.post(`${API_BASE}/internal/agent-api/daemon/connect`, {
        headers: {
          Authorization: `Bearer ${connectToken}`,
          "Content-Type": "application/json",
        },
        data: {
          daemonId: `daemon-${unique}`,
          machineId,
          name: computerName,
          os: "e2e-os",
          daemonVersion: DAEMON_VERSION,
          status: "online",
          detectedRuntimes: ["custom"],
        },
      })
      expect(connect.status()).toBe(200)
      const machine = (await connect.json()) as {
        machineToken: string
        computer: { id: string }
      }

      const agent = await scopedPost<{ member: { id: string } }>(
        request,
        "/api/v1/members/agents",
        {
          name: agentName,
          computerId: machine.computer.id,
          runtime: "claude_code",
          backend: "E2E",
        },
        sessionToken!,
        activeServerId!,
      )
      const channel = await scopedPost<{ channel: { id: string; name: string } }>(
        request,
        "/api/v1/channels",
        { name: channelName, description: "authenticated daemon delivery integration" },
        sessionToken!,
        activeServerId!,
      )
      await scopedPost(
        request,
        `/api/v1/channels/${channel.channel.id}/members`,
        { memberId: agent.member.id },
        sessionToken!,
        activeServerId!,
      )

      const historicalContent = `historical-${unique}`
      await scopedPost(
        request,
        `/api/v1/channels/${encodeURIComponent(channel.channel.name)}/messages`,
        { content: historicalContent },
        sessionToken!,
        activeServerId!,
      )

      const forbiddenReplayContents = [historicalContent]
      for (const [cursorLabel, cursor] of [
        ["missing", undefined],
        ["zero", "0"],
        ["invalid", "not-a-number"],
      ] as const) {
        const ws = daemonWebSocket(machine.machineToken, machine.computer.id, cursor)
        const observation = observeJsonEvents(ws)
        const cursorLiveContent = `cursor-live-${unique}-${cursorLabel}`
        try {
          await waitForOpen(ws)
          expect(ws.readyState, `${cursorLabel} cursor socket must open`).toBe(WebSocket.OPEN)
          const liveEvent = waitForEvent(
            ws,
            (event) => event.type === "message.created" && event.content === cursorLiveContent,
          )
          await scopedPost(
            request,
            `/api/v1/channels/${encodeURIComponent(channel.channel.name)}/messages`,
            { content: cursorLiveContent },
            sessionToken!,
            activeServerId!,
          )
          await expect(liveEvent).resolves.toEqual(
            expect.objectContaining({
              type: "message.created",
              content: cursorLiveContent,
              target: channel.channel.name,
              targetAgentId: agent.member.id,
            }),
          )
          await waitForObservationWindow()
          expect(observation.closed, `${cursorLabel} cursor socket must stay open`).toBe(false)
          expect(observation.error, `${cursorLabel} cursor socket must remain healthy`).toBeUndefined()
          expect(ws.readyState, `${cursorLabel} cursor socket must stay open`).toBe(WebSocket.OPEN)
          expect(
            observation.events.filter(
              (event) =>
                event.type === "message.created" &&
                forbiddenReplayContents.includes(String(event.content)),
            ),
            `${cursorLabel} cursor must not replay prior messages`,
          ).toEqual([])
        } finally {
          await closeWebSocket(ws)
          observation.stop()
        }
        forbiddenReplayContents.push(cursorLiveContent)
      }
    })

    await page.goto("/members")
    await assertAuthenticatedPage(page, displayName, session.server.name)

    await test.step("reject a revoked/stale product session", async () => {
      const logout = await request.post(`${API_BASE}/api/v1/auth/logout`, {
        headers: scopedHeaders(sessionToken!, activeServerId!),
      })
      expect(logout.status()).toBe(200)
      const staleSession = await request.get(`${API_BASE}/api/v1/computers`, {
        headers: scopedHeaders(sessionToken!, activeServerId!),
      })
      expect(staleSession.status()).toBe(401)
    })
  })
})
