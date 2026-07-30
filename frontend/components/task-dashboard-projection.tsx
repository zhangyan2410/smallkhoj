"use client"

import Link from "next/link"
import { ArrowRight, CheckSquare } from "lucide-react"
import { useTranslations } from "next-intl"

import { TaskProjectionStatus, useTaskProjection } from "@/components/task-projection-provider"
import { EmptyState, RuntimeChip } from "@/components/product-ui"
import { TaskTicket } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { statusLabel } from "@/lib/control-plane"
import { partitionPendingTasks } from "@/lib/task-projection"

export function TaskDashboardProjection() {
  const t = useTranslations("home")
  const tCommon = useTranslations("common")
  const { tasks } = useTaskProjection()
  const pending = partitionPendingTasks(tasks)

  return (
    <Card className="lg:col-span-2 lg:col-start-2">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <CheckSquare className="size-4 text-accent-rose" />
            {t("pendingTasks")}
          </CardTitle>
          <CardDescription>{t("pendingTasksDesc")}</CardDescription>
        </div>
        <Link href="/tasks">
          <Button variant="ghost" size="sm">
            {tCommon("allTasks")} <ArrowRight className="size-3" />
          </Button>
        </Link>
      </CardHeader>
      <CardContent>
        <TaskProjectionStatus
          refreshingLabel={tCommon("loading")}
          errorLabel={tCommon("routeErrorDesc")}
          retryLabel={tCommon("tryAgain")}
        />
        <div className="mb-3 mt-2 flex gap-2">
          <RuntimeChip tone="paper" className="gap-1 py-1">
            <span className="size-1.5 shrink-0 rounded-full bg-warning" />
            {t("openCount", { count: pending.todo.length })}
          </RuntimeChip>
          <RuntimeChip tone="paper" className="gap-1 py-1">
            <span className="size-1.5 shrink-0 rounded-full bg-info" />
            {t("inProgressCount", { count: pending.inProgress.length })}
          </RuntimeChip>
        </div>
        {pending.all.length === 0 ? (
          <EmptyState title={t("noPendingTasks")} description={t("noPendingTasksDesc")} />
        ) : (
          <div className="space-y-1">
            {pending.all.slice(0, 6).map((task) => (
              <TaskTicket
                key={task.id}
                href={`/tasks?task=${encodeURIComponent(task.id)}`}
                status={task.status}
                className="w-full justify-start"
              >
                <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                <RuntimeChip tone="paper" className="gap-1">
                  <span className={`size-1.5 shrink-0 rounded-full ${task.status === "in_progress" ? "bg-info" : "bg-warning"}`} />
                  {statusLabel(task.status)}
                </RuntimeChip>
              </TaskTicket>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
