import { expect, test, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"

const API_BASE = process.env.API_BASE ?? "http://localhost:8000"
const FRONTEND_BASE = process.env.FRONTEND_BASE ?? "http://localhost:3000"
const PUBLIC_KEY = "sk_public_local"
const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL?.replace("postgresql+asyncpg://", "postgresql://") ??
  "postgresql://smallkhoj:smallkhoj@localhost:55432/smallkhoj"

const publicHeaders = { "X-Public-Key": PUBLIC_KEY, "Content-Type": "application/json" }

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: publicHeaders,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function connectDaemon(connectToken: string, machineId: string, name: string) {
  const res = await fetch(`${API_BASE}/internal/agent-api/daemon/connect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connectToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      daemonId: `daemon-${machineId}`,
      machineId,
      name,
      os: "e2e-os",
      daemonVersion: "e2e",
      status: "online",
      detectedRuntimes: ["custom"],
    }),
  })
  if (!res.ok) {
    throw new Error(`daemon connect failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function agentSend(apiKey: string, agentId: string, target: string, content: string) {
  const res = await fetch(`${API_BASE}/internal/agent-api/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Agent-Id": agentId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ target, content }),
  })
  if (!res.ok) {
    throw new Error(`agent send failed: ${res.status} ${await res.text()}`)
  }
  return res.json()
}

async function findMemberIdByName(name: string): Promise<string | undefined> {
  const res = await fetch(`${API_BASE}/api/v1/members`, { headers: { "X-Public-Key": PUBLIC_KEY } })
  if (!res.ok) return undefined
  const data = await res.json() as { members: Array<{ name: string; id: string }> }
  return data.members.find((m) => m.name === name)?.id
}

async function fillByLabel(page: Page, label: string, value: string) {
  await page.getByLabel(label).fill(value)
}

function sqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function cleanupTestData(stamp: number) {
  const names = {
    agent: `e2e-ui-agent-${stamp}`,
    channel: `e2e-ui-${stamp}`,
    computer: `e2e-ui-computer-${stamp}`,
    machine: `e2e-machine-${stamp}`,
  }
  const sql = `
    BEGIN;
    CREATE TEMP TABLE e2e_members_to_delete ON COMMIT DROP AS
      SELECT id FROM members WHERE display_name = ${sqlLiteral(names.agent)};
    CREATE TEMP TABLE e2e_channels_to_delete ON COMMIT DROP AS
      SELECT id FROM channels WHERE name = ${sqlLiteral(names.channel)}
      UNION
      SELECT cm.channel_id
      FROM channel_members cm
      JOIN channels c ON c.id = cm.channel_id
      WHERE c.type = 'dm'
        AND cm.member_id IN (SELECT id FROM e2e_members_to_delete);
    CREATE TEMP TABLE e2e_computers_to_delete ON COMMIT DROP AS
      SELECT id FROM computers WHERE name = ${sqlLiteral(names.computer)} OR machine_id = ${sqlLiteral(names.machine)};
    DELETE FROM message_reactions
      WHERE message_id IN (
        SELECT m.id FROM messages m
        WHERE m.channel_id IN (SELECT id FROM e2e_channels_to_delete)
      );
    DELETE FROM reminders
      WHERE agent_id IN (SELECT id FROM e2e_members_to_delete)
         OR channel_id IN (SELECT id FROM e2e_channels_to_delete);
    DELETE FROM files
      WHERE channel_id IN (SELECT id FROM e2e_channels_to_delete)
         OR uploaded_by IN (SELECT id FROM e2e_members_to_delete);
    DELETE FROM event_records
      WHERE actor_id IN (SELECT id FROM e2e_members_to_delete)
         OR channel_id IN (SELECT id FROM e2e_channels_to_delete)
         OR message_id IN (
           SELECT m.id FROM messages m
           WHERE m.channel_id IN (SELECT id FROM e2e_channels_to_delete)
         );
    DELETE FROM activity_logs
      WHERE agent_id IN (SELECT id FROM e2e_members_to_delete)
         OR channel_id IN (SELECT id FROM e2e_channels_to_delete);
    DELETE FROM tasks
      WHERE channel_id IN (SELECT id FROM e2e_channels_to_delete)
         OR assignee_id IN (SELECT id FROM e2e_members_to_delete);
    DELETE FROM messages
      WHERE channel_id IN (SELECT id FROM e2e_channels_to_delete);
    DELETE FROM channel_members
      WHERE channel_id IN (SELECT id FROM e2e_channels_to_delete)
         OR member_id IN (SELECT id FROM e2e_members_to_delete);
    DELETE FROM channels
      WHERE id IN (SELECT id FROM e2e_channels_to_delete);
    DELETE FROM agent_workspaces
      WHERE agent_id IN (SELECT id FROM e2e_members_to_delete)
         OR computer_id IN (SELECT id FROM e2e_computers_to_delete);
    DELETE FROM api_keys
      WHERE resource_id IN (SELECT id FROM e2e_members_to_delete)
         OR resource_id IN (SELECT id FROM e2e_computers_to_delete);
    DELETE FROM connect_tickets
      WHERE requested_name = ${sqlLiteral(names.computer)};
    DELETE FROM members
      WHERE id IN (SELECT id FROM e2e_members_to_delete);
    DELETE FROM computers
      WHERE id IN (SELECT id FROM e2e_computers_to_delete);
    COMMIT;
  `

  execFileSync("psql", [E2E_DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-c", sql], {
    stdio: "inherit",
  })
}

test.describe("Management product flow", () => {
  test("browser flow: daemon connect, computer, agent, channel, message, and DM", async ({ page }) => {
    const stamp = Date.now()
    const computerName = `e2e-ui-computer-${stamp}`
    const agentName = `e2e-ui-agent-${stamp}`
    const channelName = `e2e-ui-${stamp}`
    const channelMessage = `hello channel ${stamp} @${agentName}`
    const channelReply = `agent channel reply ${stamp}`
    const dmMessage = `private dm ${stamp}`
    const dmReply = `agent dm reply ${stamp}`
    const channelThreadReply = `thread reply ${stamp}`
    const dmThreadReply = `dm thread reply ${stamp}`

    try {
      // 1. Generate one-time daemon connect command on Computers page
      await page.goto(`${FRONTEND_BASE}/computers`)
      await expect(page.getByRole("heading", { name: "Computers" })).toBeVisible()
      await fillByLabel(page, "Computer Name", computerName)
      await page.getByRole("button", { name: "Generate Connect Command" }).click()

      const command = (await page.getByTestId("connection-command").textContent())?.trim() ?? ""
      const connectToken = /SLOCK_CONNECT_TOKEN=(sk_connect_[^\s]+)/.exec(command)?.[1]
      await expect(page.getByTestId("connection-command")).toContainText("agent/daemon/aaa-daemon")
      await expect(page.getByTestId("connection-command")).toContainText("node dist/cmd/main.js start")
      await expect(page.getByTestId("connection-command")).toContainText("SLOCK_CONNECT_TOKEN=sk_connect_")
      await expect(page.getByTestId("connection-command")).toContainText("--proxy-port 0")
      await expect(page.getByTestId("connection-command")).toContainText("--register-daemon")
      await expect(page.getByTestId("connection-command")).not.toContainText("@slock-ai/daemon")
      expect(connectToken).toMatch(/^sk_connect_/)

      // 2. Connect daemon using generated one-time token; computer is created only after this.
      const machineId = `e2e-machine-${stamp}`
      const connect = await connectDaemon(connectToken!, machineId, computerName)
      const apiKey = connect.machineToken as string
      const computerId = connect.computer.id as string
      expect(apiKey).toMatch(/^sk_machine_/)
      expect(computerId).toMatch(/^[0-9a-f-]{36}$/)

      await page.reload()
      await expect(page.getByText(computerName, { exact: true })).toBeVisible()
      await expect(page.getByText("e2e-os").first()).toBeVisible()
      await expect(page.getByText("custom").first()).toBeVisible()

      // 3. Create agent bound to computer/runtime on Members page
      await page.goto(`${FRONTEND_BASE}/members`)
      await expect(page.getByRole("heading", { name: "Members" })).toBeVisible()
      await fillByLabel(page, "Agent Name", agentName)
      await page.getByLabel("Computer").selectOption({ label: computerName })
      await page.getByLabel("Runtime").selectOption("custom")
      await fillByLabel(page, "Backend", "E2E")
      await page.getByRole("button", { name: "Create Agent" }).click()
      await expect(page.getByText(agentName).first()).toBeVisible()

      // Look up the agent's member ID for agent-api auth
      const agentId = await findMemberIdByName(agentName)
      expect(agentId).toBeDefined()

      // 4. Create channel on home page
      await page.goto(FRONTEND_BASE)
      await fillByLabel(page, "New Channel", channelName)
      await page.getByPlaceholder("description").fill("E2E browser channel")
      await page.getByRole("button", { name: "Create" }).click()
      await expect(page.getByRole("link", { name: new RegExp(`#${channelName}`) })).toBeVisible()

      // 5. Open channel, add agent as member
      await page.getByRole("link", { name: new RegExp(`#${channelName}`) }).click()
      await expect(page.getByRole("heading", { name: `#${channelName}` })).toBeVisible()
      await page.getByTestId("add-channel-member-select").selectOption({ label: `${agentName} (agent)` })
      await page.getByRole("button", { name: "Add member to channel" }).click()
      await expect(page.getByTestId(`channel-member-${agentName}`)).toBeVisible()

      // 6. Send channel message as human, verify it appears
      await page.getByPlaceholder("Type a message...").fill(channelMessage)
      await page.getByRole("button", { name: "Send message" }).click()
      await expect(page.getByText(channelMessage)).toBeVisible()

      await page.getByRole("button", { name: "Reply" }).first().click()
      await expect(page.getByRole("complementary", { name: "Thread" })).toBeVisible()
      await page.getByPlaceholder("Reply in thread...").fill(channelThreadReply)
      await page.getByRole("button", { name: "Send thread reply" }).click()
      await expect(page.getByRole("complementary", { name: "Thread" }).getByText(channelThreadReply)).toBeVisible()
      await page.getByRole("button", { name: "Close thread" }).click()
      await expect(page.getByText(channelThreadReply)).not.toBeVisible()
      await expect(page.getByRole("button", { name: /1 replies/ }).first()).toBeVisible()

      // 7. Agent replies via agent-facing API using the daemon-issued machine token
      await agentSend(apiKey!, agentId!, `#${channelName}`, channelReply)
      await page.reload()
      await expect(page.getByText(channelReply)).toBeVisible()
      await expect(page.locator("span.font-semibold.text-blue-600", { hasText: `@${agentName}` })).toBeVisible()

      // 8. Start DM with agent from home page
      await page.goto(FRONTEND_BASE)
      await page.getByLabel("Start DM with").selectOption(agentName)
      await page.getByRole("button", { name: "DM" }).click()
      await expect(page).toHaveURL(/\/chat\/dm(%3A|:)/)
      await expect(page.getByRole("heading", { name: `DM @${agentName}` })).toBeVisible()
      await page.getByPlaceholder("Type a message...").fill(dmMessage)
      await page.getByRole("button", { name: "Send message" }).click()
      await expect(page.getByText(dmMessage)).toBeVisible()

      await page.getByRole("button", { name: "Reply" }).first().click()
      await expect(page.getByRole("complementary", { name: "Thread" })).toBeVisible()
      await page.getByPlaceholder("Reply in thread...").fill(dmThreadReply)
      await page.getByRole("button", { name: "Send thread reply" }).click()
      await expect(page.getByRole("complementary", { name: "Thread" }).getByText(dmThreadReply)).toBeVisible()
      await page.getByRole("button", { name: "Close thread" }).click()
      await expect(page.getByText(dmThreadReply)).not.toBeVisible()

      // 9. Agent replies in DM via agent-facing API (target format: dm:<peer_name>)
      const dmChannelName = decodeURIComponent(page.url().split("/chat/").at(-1) ?? "")
      expect(dmChannelName).toContain("dm:")
      await agentSend(apiKey!, agentId!, "dm:zy-ean", dmReply)
      await page.reload()
      await expect(page.getByText(dmReply)).toBeVisible()
    } finally {
      cleanupTestData(stamp)
    }
  })
})
