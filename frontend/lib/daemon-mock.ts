// Mock data for daemon MVP (backend not finalized yet)

export interface Agent {
  id: string
  name: string
  displayName: string
  status: "online" | "idle" | "offline"
  role: string
  backend: string
}

export interface Channel {
  id: string
  name: string
  description: string
  type: "public" | "private"
  joined: boolean
  unreadCount: number
}

export interface Task {
  id: number
  title: string
  status: "todo" | "in_progress" | "in_review" | "done"
  assignee?: string
  channel: string
  createdAt: string
}

export interface Message {
  id: string
  target: string
  sender: string
  content: string
  timestamp: string
  type: "human" | "agent" | "system"
}

export const MOCK_AGENTS: Agent[] = [
  { id: "aaa", name: "aaa", displayName: "aaa — test", status: "online", role: "test", backend: "Kimi" },
  { id: "deepseek", name: "deepseek", displayName: "deepseek", status: "online", role: "assistant", backend: "Claude" },
  { id: "codex-mac", name: "codex-mac", displayName: "codex-mac", status: "offline", role: "coder", backend: "Codex" },
]

export const MOCK_CHANNELS: Channel[] = [
  { id: "all", name: "#all", description: "General channel for all members", type: "public", joined: true, unreadCount: 2 },
  { id: "window", name: "#window", description: "Development workspace", type: "public", joined: true, unreadCount: 5 },
]

export const MOCK_TASKS: Task[] = [
  { id: 1, title: "整理本周 daemon 开发进度，输出一份简报", status: "done", assignee: "aaa", channel: "#window", createdAt: "2026-06-01T14:09:56" },
  { id: 2, title: "WebBridge twd.py token 认证", status: "in_review", assignee: "aaa", channel: "#window", createdAt: "2026-06-01T14:10:52" },
  { id: 4, title: "写 daemon MVP 网站", status: "in_progress", assignee: "aaa", channel: "#window", createdAt: "2026-06-01T20:40:13" },
]

export const MOCK_MESSAGES: Message[] = [
  { id: "msg-1", target: "#window", sender: "zy-ean", content: "测试 task：整理本周 daemon 开发进度", timestamp: "2026-06-01T14:09:56", type: "human" },
  { id: "msg-2", target: "#window", sender: "aaa", content: "已完成简报提交", timestamp: "2026-06-01T14:15:00", type: "agent" },
  { id: "msg-3", target: "#window:02a4e513", sender: "deepseek", content: "补充：daemon 目前只能跟真实 Slock 通信...", timestamp: "2026-06-01T14:56:28", type: "agent" },
]

export function getStatusColor(status: string): string {
  switch (status) {
    case "online": return "bg-green-500"
    case "idle": return "bg-yellow-500"
    case "offline": return "bg-gray-400"
    case "todo": return "bg-slate-400"
    case "in_progress": return "bg-blue-500"
    case "in_review": return "bg-amber-500"
    case "done": return "bg-green-500"
    default: return "bg-gray-400"
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case "todo": return "待办"
    case "in_progress": return "进行中"
    case "in_review": return "审核中"
    case "done": return "已完成"
    default: return status
  }
}
