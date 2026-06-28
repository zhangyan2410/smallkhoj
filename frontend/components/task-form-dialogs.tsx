"use client"

import { useState } from "react"
import { Pencil, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FieldLabel, Select } from "@/components/ui/form"
import {
  Dialog,
  DialogTrigger,
  DialogBackdrop,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import type { Channel, Member } from "@/lib/control-plane"

type Template = { slug: string; name: string; status: string }

const TASK_STATUS_OPTIONS = ["todo|To do", "in_progress|In progress", "in_review|In review", "done|Done", "closed|Closed"]

/**
 * 创建/更新任务的对话框触发器 + 表单。
 * 收进对话框，不占主区常驻空间。点按钮才打开。
 * server action 通过 props 传入（因为 actions 定义在 server component page 里）。
 */
export function TaskFormDialogs({
  createAction,
  updateAction,
  channels,
  agents,
  templates,
  tasks,
  copy,
}: {
  createAction: (formData: FormData) => void
  updateAction: (formData: FormData) => void
  channels: Channel[]
  agents: Member[]
  templates: Template[]
  tasks: { id: string; number: number; title: string }[]
  copy: {
    create: string
    createTask: string
    createTaskDesc: string
    createTitlePlaceholder: string
    titleLabel: string
    descriptionLabel: string
    createDescPlaceholder: string
    channel: string
    assignee: string
    unassigned: string
    taskRunTemplate: string
    status: string
    update: string
    updateTask: string
    updateTaskDesc: string
    task: string
    keepBlankPlaceholder: string
  }
  // ↑ 注意：只接收纯字符串字段，不要传整个 copy 对象（含函数，不能跨 server→client 边界）
}) {
  const [openCreate, setOpenCreate] = useState(false)
  const [openUpdate, setOpenUpdate] = useState(false)

  return (
    <div className="flex items-center gap-2">
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogTrigger
          render={
            <Button size="sm" className="gap-1.5">
              <Plus className="size-4" />
              {copy.createTask}
            </Button>
          }
        />
        <DialogBackdrop />
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.createTask}</DialogTitle>
            <DialogDescription>{copy.createTaskDesc}</DialogDescription>
          </DialogHeader>
          <form
            action={(formData) => {
              createAction(formData)
              setOpenCreate(false)
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="task-title">{copy.titleLabel}</FieldLabel>
              <Input id="task-title" name="title" required placeholder={copy.createTitlePlaceholder} />
            </div>
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="task-description">{copy.descriptionLabel}</FieldLabel>
              <Input id="task-description" name="description" placeholder={copy.createDescPlaceholder} />
            </div>
            <div>
              <FieldLabel htmlFor="task-channel">{copy.channel}</FieldLabel>
              <Select id="task-channel" name="channel" items={channels.map((c) => c.name)} fallback="#all" />
            </div>
            <div>
              <FieldLabel htmlFor="task-assignee">{copy.assignee}</FieldLabel>
              <Select id="task-assignee" name="assignee" items={agents.map((a) => a.handle!)} emptyLabel={copy.unassigned} />
            </div>
            <div>
              <FieldLabel htmlFor="task-template">{copy.taskRunTemplate}</FieldLabel>
              <Select
                id="task-template"
                name="template"
                items={templates.map((t) => `${t.slug}|${t.name}`)}
                splitValue
                emptyLabel="Default"
              />
            </div>
            <div>
              <FieldLabel htmlFor="task-status">{copy.status}</FieldLabel>
              <Select id="task-status" name="status" items={TASK_STATUS_OPTIONS} fallback="todo" splitValue />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" size="sm" className="w-full sm:w-auto">
                {copy.create}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={openUpdate} onOpenChange={setOpenUpdate}>
        <DialogTrigger
          render={
            <Button size="sm" variant="outline" className="gap-1.5">
              <Pencil className="size-4" />
              {copy.updateTask}
            </Button>
          }
        />
        <DialogBackdrop />
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.updateTask}</DialogTitle>
            <DialogDescription>{copy.updateTaskDesc}</DialogDescription>
          </DialogHeader>
          <form
            action={(formData) => {
              updateAction(formData)
              setOpenUpdate(false)
            }}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className="sm:col-span-2">
              <FieldLabel htmlFor="update-task-id">{copy.task}</FieldLabel>
              <Select
                id="update-task-id"
                name="taskId"
                items={tasks.map((t) => `${t.id}|#${t.number} ${t.title}`)}
                splitValue
                emptyLabel={copy.task}
              />
            </div>
            <div>
              <FieldLabel htmlFor="update-task-title">{copy.titleLabel}</FieldLabel>
              <Input id="update-task-title" name="title" placeholder={copy.keepBlankPlaceholder} />
            </div>
            <div>
              <FieldLabel htmlFor="update-task-description">{copy.descriptionLabel}</FieldLabel>
              <Input id="update-task-description" name="description" placeholder={copy.keepBlankPlaceholder} />
            </div>
            <div>
              <FieldLabel htmlFor="update-task-status">{copy.status}</FieldLabel>
              <Select id="update-task-status" name="status" items={TASK_STATUS_OPTIONS} fallback="in_review" splitValue />
            </div>
            <div>
              <FieldLabel htmlFor="update-task-assignee">{copy.assignee}</FieldLabel>
              <Select id="update-task-assignee" name="assignee" items={agents.map((a) => a.handle!)} emptyLabel={copy.unassigned} />
            </div>
            <div className="sm:col-span-2 flex justify-end">
              <Button type="submit" size="sm" variant="outline" className="w-full sm:w-auto">
                {copy.update}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
