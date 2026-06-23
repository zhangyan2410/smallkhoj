import assert from "node:assert/strict"
import test from "node:test"

import { NextIntlClientProvider } from "next-intl"
import { renderToStaticMarkup } from "react-dom/server"

import { ChannelClient } from "../app/chat/[channel]/channel-client"
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

test("ChannelClient server markup uses stable default panel widths for hydration", () => {
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
    const markup = renderChannelClient({
      initialChannel: "ccc",
      initialChannelId: "channel-1",
      initialChannels: [{ id: "channel-1", name: "#ccc", type: "public" }],
      initialMembers: [],
      initialAllMembers: [],
      initialDms: [],
      initialMessages: [],
    })

    assert.match(markup, /style="width:260px"/)
    assert.match(markup, /aria-valuenow="260"/)
    assert.doesNotMatch(markup, /315\.9443664550781/)
    assert.doesNotMatch(markup, /aria-valuenow="512"/)
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    })
  }
})

test("ChannelClient preserves backend DM recency order", () => {
  const markup = renderChannelClient({
    initialChannel: "ccc",
    initialChannelId: "channel-1",
    initialChannels: [{ id: "channel-1", name: "#ccc", type: "public" }],
    initialMembers: [],
    initialAllMembers: [],
    initialDms: [
        {
          id: "dm-zulu",
          name: "dm:zulu",
          type: "dm",
          displayName: "DM @Zulu",
          peer: { id: "zulu", name: "zulu", displayName: "Zulu", kind: "agent", status: "online" },
        },
        {
          id: "dm-alpha",
          name: "dm:alpha",
          type: "dm",
          displayName: "DM @Alpha",
          peer: { id: "alpha", name: "alpha", displayName: "Alpha", kind: "agent", status: "online" },
        },
      ],
    initialMessages: [],
  })

  assert.ok(markup.indexOf("Zulu") > -1)
  assert.ok(markup.indexOf("Alpha") > -1)
  assert.ok(markup.indexOf("Zulu") < markup.indexOf("Alpha"))
})
