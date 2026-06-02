import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { store, getStatusColor, getStatusLabel } from "@/lib/daemon-store"
import { Bot, MessageSquare, CheckSquare, Radio, ArrowLeft, Wifi } from "lucide-react"

// Server Component — reads from store directly
export default function DaemonPage() {
  const agents = Array.from(store.agents.values())
  const channels = Array.from(store.channels.values())
  const tasks = Array.from(store.tasks.values())
  const messages = Array.from(store.messages.values()).sort((a, b) => a.seq - b.seq).slice(-10).reverse()

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-1" />
                返回
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Radio className="w-6 h-6 text-primary" />
                Slock Daemon 仪表盘
              </h1>
              <p className="text-sm text-muted-foreground">MVP 版本 — 实时监控 agent 状态与任务</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Wifi className="w-4 h-4 text-green-500" />
            <span>daemon v0.55.0</span>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>在线 Agent</CardDescription>
              <CardTitle className="text-3xl">
                {agents.filter((a) => a.status === "online").length}
                <span className="text-lg text-muted-foreground font-normal">
                  /{agents.length}
                </span>
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>活跃频道</CardDescription>
              <CardTitle className="text-3xl">{channels.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>进行中的任务</CardDescription>
              <CardTitle className="text-3xl">
                {tasks.filter((t) => t.status === "in_progress").length}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>消息数</CardDescription>
              <CardTitle className="text-3xl">{store.messages.size}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Agents Panel */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Agents
              </CardTitle>
              <CardDescription>所有已注册的 AI agent</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${getStatusColor(agent.status)}`} />
                        <div>
                          <div className="font-medium">@{agent.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {agent.backend} · {agent.role}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full ${
                          agent.status === "online"
                            ? "bg-green-100 text-green-700"
                            : agent.status === "idle"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {agent.status}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Channels Panel */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5" />
                频道
              </CardTitle>
              <CardDescription>已加入的聊天频道</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {channels.map((channel) => (
                    <div
                      key={channel.id}
                      className="flex items-center justify-between p-3 rounded-lg border bg-card"
                    >
                      <div>
                        <div className="font-medium">{channel.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {channel.description}
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {channel.members.length} members
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Tasks Panel */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="w-5 h-5" />
                任务板
              </CardTitle>
              <CardDescription>#window 频道的任务</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                    >
                      <div className={`w-2 h-2 mt-1.5 rounded-full ${getStatusColor(task.status)}`} />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{task.title}</div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            #{task.number} · @{task.assigneeId || "unassigned"}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              task.status === "done"
                                ? "bg-green-100 text-green-700"
                                : task.status === "in_progress"
                                  ? "bg-blue-100 text-blue-700"
                                  : task.status === "in_review"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {getStatusLabel(task.status)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Messages Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5" />
              最近消息
            </CardTitle>
            <CardDescription>来自各频道的最新动态</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[200px]">
              <div className="space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card">
                    <div
                      className={`w-2 h-2 mt-2 rounded-full ${
                        msg.senderType === "human"
                          ? "bg-blue-500"
                          : msg.senderType === "agent"
                            ? "bg-purple-500"
                            : "bg-gray-400"
                      }`}
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">@{msg.sender}</span>
                        <span className="text-xs text-muted-foreground">{msg.target}</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                          {new Date(msg.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {msg.content}
                      </p>
                    </div>
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-8">暂无消息</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* API Status */}
        <Card className="bg-muted/50">
          <CardHeader>
            <CardTitle className="text-sm">API 端点状态</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>GET /server — 已就绪</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>POST /send — 已就绪</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>GET /events — 已就绪</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>GET /history — 已就绪</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>POST /tasks/claim — 已就绪</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500" />
                <span>POST /tasks/update-status — 已就绪</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-yellow-500" />
                <span>WebSocket — Phase 3 预留</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
