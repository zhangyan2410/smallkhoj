import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  SMALLKHOJ_AGENT_AVATAR_COMPONENTS,
  SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS,
  renderSmallKhojAgentAvatarDataUri,
  type SmallKhojAgentAvatarExpressionName,
} from "../lib/smallkhoj-agent-avatar"
import { avatarSourceForMember, type AvatarMember } from "../lib/member-avatar"

const OUTPUT_DIR = join(process.cwd(), "public", "avatar-preview")
const OUTPUT_FILE = join(OUTPUT_DIR, "agent-avatar-presets.html")
const GENERATED_IMAGE_AVATAR_URL = "/avatars/agents/generated-energetic-reference.png"

function htmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

async function main() {
  const expressionNames = Object.keys(SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS) as SmallKhojAgentAvatarExpressionName[]
  const expressionCards = expressionNames.map((expressionName) => {
    const expression = SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS[expressionName]
    const src = renderSmallKhojAgentAvatarDataUri(expressionName)

    return `
      <figure class="avatar-card">
        <img src="${src}" alt="${htmlEscape(expression.label)} expression" />
        <figcaption>
          <strong>${htmlEscape(expression.label)}</strong>
          <span>${htmlEscape(expression.reference)}</span>
        </figcaption>
      </figure>
  `
  }).join("")

  const imageAssetMember = {
    id: "agent:image-asset-preview",
    name: "image-asset-preview",
    displayName: "Image Asset Preview",
    kind: "agent",
    config: { avatarImageUrl: GENERATED_IMAGE_AVATAR_URL },
  } satisfies AvatarMember
  const imageAssetSrc = avatarSourceForMember(imageAssetMember) ?? ""

  const componentRows = Object.entries(SMALLKHOJ_AGENT_AVATAR_EXPRESSIONS).map(([name, expression]) => `
    <tr>
      <th>${htmlEscape(name)}</th>
      <td>${htmlEscape(expression.background)}</td>
      <td>${htmlEscape(expression.brows)}</td>
      <td>${htmlEscape(expression.eyes)}</td>
      <td>${htmlEscape(expression.nose)}</td>
      <td>${htmlEscape(expression.mouth)}</td>
      <td>${htmlEscape(expression.cheek)}</td>
    </tr>
  `).join("")

  const componentCounts = {
    backgrounds: Object.keys(SMALLKHOJ_AGENT_AVATAR_COMPONENTS.backgrounds).length,
    brows: Object.keys(SMALLKHOJ_AGENT_AVATAR_COMPONENTS.brows).length,
    eyes: Object.keys(SMALLKHOJ_AGENT_AVATAR_COMPONENTS.eyes).length,
    noses: Object.keys(SMALLKHOJ_AGENT_AVATAR_COMPONENTS.noses).length,
    mouths: Object.keys(SMALLKHOJ_AGENT_AVATAR_COMPONENTS.mouths).length,
    cheeks: Object.keys(SMALLKHOJ_AGENT_AVATAR_COMPONENTS.cheeks).length,
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SmallKhoj Agent Avatar Pack Preview</title>
  <style>
    :root {
      color-scheme: light;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }

    body {
      margin: 0;
      padding: 32px;
    }

    header {
      max-width: 960px;
      margin: 0 auto 28px;
    }

    h1 {
      margin: 0 0 8px;
      font-size: 24px;
    }

    p {
      margin: 0;
      color: #64748b;
      line-height: 1.5;
    }

    section {
      max-width: 960px;
      margin: 0 auto 28px;
      padding: 20px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      background: #ffffff;
    }

    h2 {
      margin: 0 0 16px;
      font-size: 16px;
    }

    .avatar-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
    }

    .avatar-card {
      margin: 0;
      display: grid;
      gap: 12px;
      justify-items: center;
      padding: 16px;
      border-radius: 10px;
      background: #f8fafc;
    }

    img {
      width: 128px;
      height: 128px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
    }

    figcaption {
      display: grid;
      gap: 3px;
      text-align: center;
      font-size: 12px;
      color: #475569;
    }

    figcaption strong {
      color: #0f172a;
      font-size: 14px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }

    th,
    td {
      padding: 10px 8px;
      border-top: 1px solid #e2e8f0;
      text-align: left;
    }

    th {
      color: #0f172a;
      font-weight: 650;
    }

    code {
      border-radius: 6px;
      background: #f1f5f9;
      padding: 2px 6px;
    }
  </style>
</head>
<body>
  <header>
    <h1>SmallKhoj Agent Avatar Pack Preview</h1>
    <p>Generated image assets can be used directly for agent avatars, while the simple SVG expression remains available as a lightweight fallback.</p>
  </header>
  <section>
    <h2>Agent Avatar Sources</h2>
    <div class="avatar-grid">${expressionCards}</div>
    <div class="avatar-grid secondary-grid">
      <figure class="avatar-card">
        <img src="${htmlEscape(imageAssetSrc)}" alt="Generated image asset avatar" />
        <figcaption>
          <strong>Generated Image Asset</strong>
          <span>${htmlEscape(GENERATED_IMAGE_AVATAR_URL)}</span>
        </figcaption>
      </figure>
    </div>
  </section>
  <section>
    <h2>Component Slots</h2>
    <p>
      ${componentCounts.backgrounds} backgrounds,
      ${componentCounts.brows} brows,
      ${componentCounts.eyes} eyes,
      ${componentCounts.noses} noses,
      ${componentCounts.mouths} mouths,
      ${componentCounts.cheeks} cheek variants.
    </p>
    <table>
      <thead>
        <tr>
          <th>expression</th>
          <th>background</th>
          <th>brows</th>
          <th>eyes</th>
          <th>nose</th>
          <th>mouth</th>
          <th>cheek</th>
        </tr>
      </thead>
      <tbody>${componentRows}</tbody>
    </table>
  </section>
</body>
</html>
`

  await mkdir(OUTPUT_DIR, { recursive: true })
  await writeFile(OUTPUT_FILE, html, "utf8")
  console.log(`Wrote ${OUTPUT_FILE}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
