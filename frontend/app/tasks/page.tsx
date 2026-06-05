import Link from "next/link"

import { apiGet } from "@/lib/control-plane"

type Task = {
  number: number
  title: string
  status: string
  assignee?: string | null
}

async function getTasks() {
  return apiGet<{ tasks: Task[] }>("/api/v1/tasks", { tasks: [] })
}

const statusColors: Record<string, string> = {
  todo: "bg-gray-200 text-gray-800",
  in_progress: "bg-blue-100 text-blue-800",
  in_review: "bg-yellow-100 text-yellow-800",
  done: "bg-green-100 text-green-800",
  closed: "bg-red-100 text-red-800",
}

export default async function TasksPage() {
  const { tasks } = await getTasks()

  return (
    <main className="flex min-h-screen flex-col p-4">
      <div className="max-w-2xl w-full mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Link href="/" className="text-muted-foreground hover:underline">← Back</Link>
          <h1 className="text-xl font-bold">Tasks</h1>
        </div>

        <div className="space-y-2">
          {tasks.map((t) => (
            <div key={t.number} className="border rounded p-3 flex items-center gap-3">
              <span className="font-mono text-sm text-muted-foreground">#{t.number}</span>
              <span className="flex-1">{t.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded ${statusColors[t.status] || "bg-gray-100"}`}>
                {t.status}
              </span>
              {t.assignee && (
                <span className="text-xs text-muted-foreground">@{t.assignee}</span>
              )}
            </div>
          ))}
          {tasks.length === 0 && (
            <p className="text-muted-foreground">No tasks</p>
          )}
        </div>
      </div>
    </main>
  )
}
