import assert from "node:assert/strict"
import test from "node:test"

import { renderToStaticMarkup } from "react-dom/server"

import { MemberAvatar } from "../components/member-avatar"
import { MessageFrame } from "../components/message-frame"
import {
  AGENT_AVATAR_OPTIONS,
  AGENT_AVATAR_PRESETS,
  AGENT_AVATAR_STYLE,
  SMALLKHOJ_ENERGETIC_EYES_VARIANT,
  SMALLKHOJ_ENERGETIC_EYES_PATH,
  agentAvatarPresetForMember,
  avatarSeedForMember,
  avatarSourceForMember,
  memberAvatarName,
  memberForMessageSender,
  statusDotClass,
  type AvatarMember,
} from "../lib/member-avatar"

const agent = {
  id: "agent-1",
  name: "kimi-debugger",
  displayName: "Kimi Debugger",
  handle: "@kimi-debugger",
  kind: "agent",
  status: "running",
  avatarUrl: "https://example.com/ignored-agent.png",
  profile: { avatarUrl: "https://example.com/ignored-profile-agent.png" },
} satisfies AvatarMember

const human = {
  id: "human-1",
  name: "zy",
  displayName: "Zhang Yan",
  handle: "@zy",
  kind: "human",
  status: "online",
  avatarUrl: "https://example.com/human.png",
  profile: { avatarUrl: "https://example.com/profile-human.png" },
} satisfies AvatarMember

test("agent avatars are deterministic DiceBear croodles-neutral data URIs", () => {
  const first = avatarSourceForMember(agent)
  const second = avatarSourceForMember({ ...agent })

  assert.equal(first, second)
  assert.match(first ?? "", /^data:image\/svg\+xml;charset=utf-8,/)
  assert.match(decodeURIComponent((first ?? "").split(",")[1] ?? ""), /<svg/)
  assert.doesNotMatch(first ?? "", /example\.com\/ignored/)
})

test("agent avatars use configured croodles-neutral customization", () => {
  const svg = decodeURIComponent((avatarSourceForMember(agent) ?? "").split(",")[1] ?? "")

  assert.equal(AGENT_AVATAR_STYLE, "croodles-neutral")
  assert.equal(AGENT_AVATAR_OPTIONS.borderRadius, 12)
  assert.ok(AGENT_AVATAR_OPTIONS.backgroundColor.some((color) => svg.includes(color)))
})

test("agent avatar preset customizes generated croodles-neutral output", () => {
  const friendlyAgent = {
    ...agent,
    config: { avatarPreset: "friendly" },
  } satisfies AvatarMember
  const focusedAgent = {
    ...agent,
    config: { avatarPreset: "focused" },
  } satisfies AvatarMember
  const friendlySvg = decodeURIComponent((avatarSourceForMember(friendlyAgent) ?? "").split(",")[1] ?? "")
  const focusedSvg = decodeURIComponent((avatarSourceForMember(focusedAgent) ?? "").split(",")[1] ?? "")

  assert.equal(agentAvatarPresetForMember(friendlyAgent).name, "friendly")
  assert.equal(agentAvatarPresetForMember(focusedAgent).name, "focused")
  assert.notEqual(friendlySvg, focusedSvg)
  assert.ok(AGENT_AVATAR_PRESETS.friendly.backgroundColor.some((color) => friendlySvg.includes(color)))
})

test("unknown agent avatar preset falls back to default", () => {
  const unknownPresetAgent = {
    ...agent,
    config: { avatarPreset: "not-a-preset" },
  } satisfies AvatarMember

  assert.equal(agentAvatarPresetForMember(unknownPresetAgent).name, "default")
})

test("system generated agent image URL overrides generated fallback", () => {
  const imageAgent = {
    ...agent,
    config: { avatarImageUrl: "/avatars/agents/generated-energetic-reference.png" },
  } satisfies AvatarMember

  assert.equal(avatarSourceForMember(imageAgent), "/avatars/agents/generated-energetic-reference.png")
})

test("energetic preset uses the SmallKhoj custom smiling eyes variant", () => {
  const energeticAgent = {
    ...agent,
    config: { avatarPreset: "energetic" },
  } satisfies AvatarMember
  const svg = decodeURIComponent((avatarSourceForMember(energeticAgent) ?? "").split(",")[1] ?? "")

  assert.equal(agentAvatarPresetForMember(energeticAgent).name, "energetic")
  assert.deepEqual(AGENT_AVATAR_PRESETS.energetic.eyesVariant, [SMALLKHOJ_ENERGETIC_EYES_VARIANT])
  assert.ok(svg.includes(SMALLKHOJ_ENERGETIC_EYES_PATH))
})

test("human avatar URL is preferred over generated fallback", () => {
  assert.equal(avatarSourceForMember(human), "https://example.com/profile-human.png")
  assert.equal(avatarSourceForMember({ ...human, profile: {} }), "https://example.com/human.png")
})

test("avatar seeds prefer stable identity fields", () => {
  assert.equal(avatarSeedForMember(agent), "agent-1")
  assert.equal(avatarSeedForMember({ ...agent, id: "" }), "@kimi-debugger")
  assert.equal(avatarSeedForMember({ ...agent, id: "", handle: "" }), "kimi-debugger")
})

test("status mapping covers lifecycle states through one helper", () => {
  assert.equal(statusDotClass("running"), "bg-info animate-[pulse_0.8s_ease-in-out_infinite]")
  assert.equal(statusDotClass("online"), "bg-success")
  assert.equal(statusDotClass("pending_start"), "bg-warning animate-pulse")
  assert.equal(statusDotClass("failed"), "bg-danger")
  assert.equal(statusDotClass("offline"), "bg-muted-foreground")
})

test("MemberAvatar renders the status dot on the top-right corner", () => {
  const markup = renderToStaticMarkup(<MemberAvatar member={agent} size="sm" showStatus />)

  assert.match(markup, /data-slot="member-avatar"/)
  assert.match(markup, /data-avatar-kind="agent"/)
  assert.match(markup, /data-status="running"/)
  assert.match(markup, /-right-0\.5/)
  assert.match(markup, /-top-0\.5/)
  assert.match(markup, /bg-info/)
})

test("memberAvatarName produces readable fallback text", () => {
  assert.equal(memberAvatarName(agent), "Kimi Debugger")
  assert.equal(memberAvatarName({ ...agent, displayName: "" }), "kimi-debugger")
})

test("message sender avatars resolve to the matching member identity", () => {
  assert.equal(memberForMessageSender("Kimi Debugger", "agent", [human, agent]).id, "agent-1")
  assert.equal(memberForMessageSender("@kimi-debugger", "agent", [human, agent]).id, "agent-1")
  assert.equal(memberForMessageSender("Zhang Yan", "member", [human, agent]).id, "human-1")
})

test("unknown agent message sender still uses generated agent avatar fallback", () => {
  const resolved = memberForMessageSender("new-agent", "agent", [])

  assert.equal(resolved.kind, "agent")
  assert.equal(resolved.displayName, "new-agent")
  assert.match(avatarSourceForMember(resolved) ?? "", /^data:image\/svg\+xml;charset=utf-8,/)
})

test("MessageFrame aligns author text and message body in one component", () => {
  const markup = renderToStaticMarkup(
    <MessageFrame member={agent} senderType="agent" time="2026-06-21 12:00:00" avatarSize="lg" showStatus>
      <p>hello</p>
    </MessageFrame>
  )

  assert.match(markup, /data-slot="message-frame"/)
  assert.match(markup, /data-slot="member-avatar"/)
  assert.match(markup, /data-slot="message-author"/)
  assert.match(markup, /data-slot="message-body"/)
  assert.match(markup, /data-status="running"/)
  assert.match(markup, /assistant/)
  assert.match(markup, /border-left-color:var\(--agent-color-/)
  assert.match(markup, /2026-06-21 12:00:00/)
  assert.match(markup, /hello/)
})

test("MessageFrame hides status dots for human chat authors", () => {
  const markup = renderToStaticMarkup(
    <MessageFrame member={human} senderType="member" time="2026-06-21 12:00:00" avatarSize="lg">
      <p>hello</p>
    </MessageFrame>
  )

  assert.match(markup, /data-slot="message-frame"/)
  assert.match(markup, /data-slot="member-avatar"/)
  assert.doesNotMatch(markup, /data-status=/)
})

test("MessageFrame compact time keeps narrow thread headers readable", () => {
  const markup = renderToStaticMarkup(
    <MessageFrame member={human} senderType="member" time="2026-06-21 12:00:00" timeVariant="compact" avatarSize="sm">
      <p>hello</p>
    </MessageFrame>
  )

  assert.match(markup, /06\/21 12:00/)
  assert.match(markup, /title="2026-06-21 12:00:00"/)
  assert.match(markup, /whitespace-nowrap/)
})
