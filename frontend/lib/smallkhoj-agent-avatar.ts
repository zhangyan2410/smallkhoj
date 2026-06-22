export const SMALLKHOJ_AGENT_AVATAR_STYLE = "smallkhoj-agent-v0"

export const SMALLKHOJ_AGENT_AVATAR_COMPONENTS = {
  backgrounds: {
    warmPink: "#fee2e2",
  },
  brows: {
    softCurve: '<path d="M33 37c5-4 12-5 17-3M78 34c5-2 12-1 17 3" />',
  },
  eyes: {
    energeticClosed: '<path d="M34 56c3-6 13-6 17 0M77 56c3-6 13-6 17 0" />',
  },
  noses: {
    dot: '<path d="M64 66v.1" />',
  },
  mouths: {
    openSmile: '<path d="M49 79h30v7c0 9-6 15-15 15s-15-6-15-15Z" fill="#fff" />',
  },
  cheeks: {
    shortBlush:
      '<path d="M28 70l-2 4M33 70l-2 4M100 70l-2 4M105 70l-2 4" />',
  },
} as const

export const SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS = {
  energetic: {
    label: "Energetic",
    reference: "row 1, column 1",
    background: "warmPink",
    brows: "softCurve",
    eyes: "energeticClosed",
    nose: "dot",
    mouth: "openSmile",
    cheek: "shortBlush",
  },
} as const

export type SmallKhojAgentAvatarExpressionName = keyof typeof SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS

function featureGroup(part: string, content: string) {
  return `<g data-part="${part}" fill="none" stroke="#111827" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${content}</g>`
}

export function renderSmallKhojAgentAvatarSvg(expressionName: SmallKhojAgentAvatarExpressionName) {
  const expression = SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS[expressionName]
  const components = SMALLKHOJ_AGENT_AVATAR_COMPONENTS
  const background = components.backgrounds[expression.background]

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none" data-avatar-style="${SMALLKHOJ_AGENT_AVATAR_STYLE}" data-expression="${expressionName}">
  <rect data-part="background" width="128" height="128" rx="18" fill="${background}" />
  ${featureGroup("brows", components.brows[expression.brows])}
  ${featureGroup("eyes", components.eyes[expression.eyes])}
  ${featureGroup("nose", components.noses[expression.nose])}
  ${featureGroup("mouth", components.mouths[expression.mouth])}
  ${featureGroup("cheek", components.cheeks[expression.cheek])}
</svg>`
}

export function renderSmallKhojAgentAvatarDataUri(expressionName: SmallKhojAgentAvatarExpressionName) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSmallKhojAgentAvatarSvg(expressionName))}`
}
