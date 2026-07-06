import assert from "node:assert/strict"
import test from "node:test"

import { renderToStaticMarkup } from "react-dom/server"

import { MarkdownMessage } from "../components/markdown-message"

test("MarkdownMessage escapes unknown html-like tags while preserving mention styling", () => {
  const markup = renderToStaticMarkup(
    <MarkdownMessage content="agent wrote <marker>keep this literal</marker> for @reviewer in #general" />,
  )

  assert.doesNotMatch(markup, /<marker>/)
  assert.match(markup, /&lt;marker&gt;keep this literal&lt;\/marker&gt;/)
  assert.match(markup, /class="mention"[^>]*>@reviewer</)
  assert.match(markup, /class="channel-tag"[^>]*>#general</)
})
