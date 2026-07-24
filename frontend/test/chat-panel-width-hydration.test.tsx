import assert from "node:assert/strict"
import test from "node:test"

import { NextIntlClientProvider } from "next-intl"
import { renderToStaticMarkup } from "react-dom/server"

import { ChannelClient } from "../app/(app)/chat/[channel]/channel-client"
import zhMessages from "../messages/zh-CN.json"

type ChannelClientProps = Parameters<typeof ChannelClient>[0]

function renderChannelClient(props: ChannelClientProps) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="zh-CN"
      messages={zhMessages}
      onError={(error) => {
        if (error.code !== "ENVIRONMENT_FALLBACK") throw error
      }}
    >
      <ChannelClient {...props} />
    </NextIntlClientProvider>
  )
}

const baseProps = {
  initialChannel: "ccc",
  initialChannelId: "channel-1",
  initialChannels: [{ id: "channel-1", name: "#ccc", type: "public" as const }],
  initialMembers: [],
  initialAllMembers: [],
  initialDms: [],
  initialMessages: [],
}

test("ChannelClient server markup never leaks localStorage panel widths (hydration-safe)", () => {
  // The resizable list/sidebar panels now live in chat-sidebar / ProductShell,
  // not ChannelClient. What still matters for hydration safety: even when
  // window.localStorage returns stored widths, those values must NOT appear in
  // the server-rendered markup (useResizablePanel reads storage only after mount).
  const originalWindow = globalThis.window
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem(key: string) {
          if (key === "smallkhoj.chat.sidebarWidth") return "315.9443664550781"
          if (key === "smallkhoj.chat.threadWidth") return "512"
          return null
        },
      },
    },
  })

  try {
    const markup = renderChannelClient(baseProps)

    // ChannelClient still owns the thread aside width, so it must render the
    // deterministic default and never the stored value during SSR.
    assert.doesNotMatch(markup, /315\.9443664550781/)
    assert.doesNotMatch(markup, /aria-valuenow="512"/)
    // Sanity: the chat root + members aside render at all.
    assert.match(markup, /data-chat-root/)
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    })
  }
})

test("ChannelClient renders members aside with a deterministic (non-stored) header", () => {
  const markup = renderChannelClient(baseProps)
  // Members count header is server-stable regardless of any stored panel width.
  assert.match(markup, /成员（0）/)
})
