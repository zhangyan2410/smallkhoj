async function getMessages(channel: string) {
  try {
    const res = await fetch(`http://localhost:8000/api/v1/channels/${channel}/messages?limit=50`, {
      cache: "no-store",
    })
    return res.json()
  } catch {
    return { messages: [] }
  }
}

export default async function ChannelPage({ params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params
  const { messages } = await getMessages(channel)

  return (
    <main className="flex min-h-screen flex-col p-4">
      <div className="max-w-2xl w-full mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <a href="/" className="text-muted-foreground hover:underline">← Back</a>
          <h1 className="text-xl font-bold">#{channel}</h1>
        </div>

        <div className="space-y-2">
          {messages.map((msg: any) => (
            <div key={msg.id} className="border-b pb-2">
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-semibold ${msg.senderType === "agent" ? "text-blue-600" : "text-green-600"}`}>
                  {msg.sender}
                </span>
                <span className="text-muted-foreground text-xs">{msg.time}</span>
                <span className="text-muted-foreground text-xs">seq={msg.seq}</span>
              </div>
              <p className="mt-1">{msg.content}</p>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-muted-foreground">No messages in #{channel}</p>
          )}
        </div>
      </div>
    </main>
  )
}
