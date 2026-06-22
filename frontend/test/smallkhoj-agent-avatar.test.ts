import assert from "node:assert/strict"
import test from "node:test"

import {
  SMALLKHOJ_AGENT_AVATAR_COMPONENTS,
  SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS,
  renderSmallKhojAgentAvatarDataUri,
  renderSmallKhojAgentAvatarSvg,
} from "../lib/smallkhoj-agent-avatar"

test("SmallKhoj agent avatar pack keeps the good simple energetic expression", () => {
  assert.deepEqual(Object.keys(SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS), ["energetic"])
})

test("SmallKhoj agent avatar expressions are built from separate face components", () => {
  for (const expression of Object.values(SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS)) {
    assert.ok(expression.background in SMALLKHOJ_AGENT_AVATAR_COMPONENTS.backgrounds)
    assert.ok(expression.brows in SMALLKHOJ_AGENT_AVATAR_COMPONENTS.brows)
    assert.ok(expression.eyes in SMALLKHOJ_AGENT_AVATAR_COMPONENTS.eyes)
    assert.ok(expression.nose in SMALLKHOJ_AGENT_AVATAR_COMPONENTS.noses)
    assert.ok(expression.mouth in SMALLKHOJ_AGENT_AVATAR_COMPONENTS.mouths)
    assert.ok(expression.cheek in SMALLKHOJ_AGENT_AVATAR_COMPONENTS.cheeks)
  }
})

test("SmallKhoj agent avatar SVG keeps facial parts inspectable", () => {
  const svg = renderSmallKhojAgentAvatarSvg("energetic")

  assert.match(svg, /data-avatar-style="smallkhoj-agent-v0"/)
  assert.match(svg, /data-expression="energetic"/)
  assert.match(svg, /data-part="background"/)
  assert.match(svg, /data-part="brows"/)
  assert.match(svg, /data-part="eyes"/)
  assert.match(svg, /data-part="nose"/)
  assert.match(svg, /data-part="mouth"/)
  assert.match(svg, /data-part="cheek"/)
  assert.doesNotMatch(svg, /DiceBear/)
})

test("SmallKhoj agent avatar data URI is a deterministic inline SVG", () => {
  const first = renderSmallKhojAgentAvatarDataUri("energetic")
  const second = renderSmallKhojAgentAvatarDataUri("energetic")

  assert.equal(first, second)
  assert.match(first, /^data:image\/svg\+xml;charset=utf-8,/)
  assert.match(decodeURIComponent(first.split(",")[1] ?? ""), /data-expression="energetic"/)
})
