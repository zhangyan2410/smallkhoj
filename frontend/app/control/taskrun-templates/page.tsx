import Link from "next/link"
import { revalidatePath } from "next/cache"
import { Bot, FilePenLine, Layers3, Plus, Settings2, ShieldOff } from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { EmptyState, RuntimeChip, StatusPill, Toolbar } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/form"
import { API_BASE, apiGet, type TaskRunTemplate } from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

type TemplateListResponse = {
  templates: TaskRunTemplate[]
}

function csv(value: FormDataEntryValue | null) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function arrayValue(source: Record<string, unknown> | undefined, key: string) {
  const value = source?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function firstRole(template: TaskRunTemplate) {
  const role = template.rolePresets?.find((item) => item && typeof item === "object")
  return role ?? {}
}

function roleKey(template: TaskRunTemplate) {
  const role = firstRole(template)
  return typeof role.roleKey === "string" ? role.roleKey : "general"
}

function roleName(template: TaskRunTemplate) {
  const role = firstRole(template)
  return typeof role.displayName === "string" ? role.displayName : roleKey(template)
}

function rolePurpose(template: TaskRunTemplate) {
  const role = firstRole(template)
  return typeof role.purpose === "string" ? role.purpose : ""
}

function buildPayload(formData: FormData) {
  const role = {
    roleKey: String(formData.get("roleKey") || "general").trim() || "general",
    displayName: String(formData.get("roleName") || "General").trim() || "General",
    purpose: String(formData.get("purpose") || "").trim(),
    instructionTemplate: String(formData.get("instructionTemplate") || "").trim(),
    toolPolicy: {
      allowedToolGroups: csv(formData.get("tools")),
      writeSlockCommands: true,
    },
    skillPolicy: {
      requiredSkills: csv(formData.get("skills")),
      allowAdditionalSkills: true,
    },
    memoryPolicy: {
      readScopes: csv(formData.get("readScopes")),
      writeScopes: csv(formData.get("writeScopes")),
    },
    outputPolicy: {
      expectedOutputTypes: csv(formData.get("outputTypes")),
      channelMessageRequired: formData.get("channelMessageRequired") === "on",
    },
    runtimePolicy: {
      contextIsolation: "required",
    },
    loopPolicy: {
      completionPolicy: "single_turn_result",
    },
    contextPolicy: {
      suggestSummaryAtContextRatio: 0.85,
    },
    editableFields: ["displayName", "purpose", "instructionTemplate", "toolPolicy", "skillPolicy", "memoryPolicy", "outputPolicy"],
  }
  return {
    name: String(formData.get("name") || "").trim(),
    slug: String(formData.get("slug") || "").trim(),
    description: String(formData.get("description") || "").trim() || null,
    category: String(formData.get("category") || "").trim() || null,
    systemInstruction: String(formData.get("systemInstruction") || "").trim(),
    toolPolicy: role.toolPolicy,
    skillPolicy: role.skillPolicy,
    memoryPolicy: {
      ...role.memoryPolicy,
      summaryOnCompletion: true,
      suggestSummaryAtContextRatio: 0.85,
    },
    outputPolicy: {
      ...role.outputPolicy,
      multipleOutputsAllowed: true,
    },
    runtimePolicy: role.runtimePolicy,
    startPolicy: {
      autoStart: true,
      executionStrategy: "parallel",
    },
    rolePresets: [role],
  }
}

async function writeTemplate(path: string, body: Record<string, unknown>, method = "POST") {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await serverApiHeaders(true),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`)
  }
}

async function createTemplateAction(formData: FormData) {
  "use server"
  await writeTemplate("/api/v1/task-run-templates", buildPayload(formData))
  revalidatePath("/control/taskrun-templates")
  revalidatePath("/tasks")
}

async function updateTemplateAction(formData: FormData) {
  "use server"
  const slug = String(formData.get("templateSlug") || "")
  if (!slug) return
  const payload = buildPayload(formData)
  delete (payload as { slug?: string }).slug
  await writeTemplate(`/api/v1/task-run-templates/${encodeURIComponent(slug)}`, payload, "PATCH")
  revalidatePath("/control/taskrun-templates")
  revalidatePath("/tasks")
}

async function disableTemplateAction(formData: FormData) {
  "use server"
  const slug = String(formData.get("templateSlug") || "")
  if (!slug) return
  await writeTemplate(`/api/v1/task-run-templates/${encodeURIComponent(slug)}/disable`, {}, "POST")
  revalidatePath("/control/taskrun-templates")
  revalidatePath("/tasks")
}

function PolicyLine({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate">{values.length ? values.join(", ") : "未设置"}</span>
    </div>
  )
}

function TemplateFields({ template }: { template?: TaskRunTemplate }) {
  const role = firstRole(template ?? ({} as TaskRunTemplate))
  const roleToolPolicy = role.toolPolicy && typeof role.toolPolicy === "object" ? role.toolPolicy as Record<string, unknown> : template?.toolPolicy
  const roleSkillPolicy = role.skillPolicy && typeof role.skillPolicy === "object" ? role.skillPolicy as Record<string, unknown> : template?.skillPolicy
  const roleMemoryPolicy = role.memoryPolicy && typeof role.memoryPolicy === "object" ? role.memoryPolicy as Record<string, unknown> : template?.memoryPolicy
  const roleOutputPolicy = role.outputPolicy && typeof role.outputPolicy === "object" ? role.outputPolicy as Record<string, unknown> : template?.outputPolicy
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-name`}>名称</label>
        <Input id={`${template?.slug ?? "new"}-name`} name="name" required defaultValue={template?.name ?? ""} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-slug`}>Slug</label>
        <Input id={`${template?.slug ?? "new"}-slug`} name="slug" required defaultValue={template?.slug ?? ""} disabled={Boolean(template)} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-category`}>分类</label>
        <Input id={`${template?.slug ?? "new"}-category`} name="category" defaultValue={template?.category ?? ""} placeholder="research / qa / planning" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-role-key`}>Role key</label>
        <Input id={`${template?.slug ?? "new"}-role-key`} name="roleKey" required defaultValue={template ? roleKey(template) : "general"} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-role-name`}>角色名</label>
        <Input id={`${template?.slug ?? "new"}-role-name`} name="roleName" required defaultValue={template ? roleName(template) : "General"} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-purpose`}>角色目的</label>
        <Input id={`${template?.slug ?? "new"}-purpose`} name="purpose" defaultValue={template ? rolePurpose(template) : ""} />
      </div>
      <div className="md:col-span-2">
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-description`}>说明</label>
        <Input id={`${template?.slug ?? "new"}-description`} name="description" defaultValue={template?.description ?? ""} />
      </div>
      <div className="md:col-span-2">
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-system`}>系统指令</label>
        <Textarea
          id={`${template?.slug ?? "new"}-system`}
          name="systemInstruction"
          required
          defaultValue={template?.systemInstruction ?? ""}
          rows={6}
        />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-tools`}>工具组</label>
        <Input id={`${template?.slug ?? "new"}-tools`} name="tools" defaultValue={arrayValue(roleToolPolicy, "allowedToolGroups").join(", ")} placeholder="slock, web, read" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-skills`}>必需 skills</label>
        <Input id={`${template?.slug ?? "new"}-skills`} name="skills" defaultValue={arrayValue(roleSkillPolicy, "requiredSkills").join(", ")} placeholder="research, qa" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-read`}>可读 memory</label>
        <Input id={`${template?.slug ?? "new"}-read`} name="readScopes" defaultValue={arrayValue(roleMemoryPolicy, "readScopes").join(", ")} placeholder="channel, thread, task" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-write`}>可写 memory</label>
        <Input id={`${template?.slug ?? "new"}-write`} name="writeScopes" defaultValue={arrayValue(roleMemoryPolicy, "writeScopes").join(", ")} placeholder="task, channel" />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground" htmlFor={`${template?.slug ?? "new"}-outputs`}>输出类型</label>
        <Input id={`${template?.slug ?? "new"}-outputs`} name="outputTypes" defaultValue={arrayValue(roleOutputPolicy, "expectedOutputTypes").join(", ")} placeholder="message, memory, file" />
      </div>
      <label className="flex items-end gap-2 pb-2 text-sm">
        <input name="channelMessageRequired" type="checkbox" defaultChecked={(roleOutputPolicy?.channelMessageRequired ?? template?.outputPolicy?.channelMessageRequired) !== false} />
        要求频道消息
      </label>
      <input type="hidden" name="instructionTemplate" value={typeof role.instructionTemplate === "string" ? role.instructionTemplate : ""} />
    </div>
  )
}

function TemplateRow({ template }: { template: TaskRunTemplate }) {
  const role = firstRole(template)
  const roleToolPolicy = role.toolPolicy && typeof role.toolPolicy === "object" ? role.toolPolicy as Record<string, unknown> : template.toolPolicy
  const roleSkillPolicy = role.skillPolicy && typeof role.skillPolicy === "object" ? role.skillPolicy as Record<string, unknown> : template.skillPolicy
  const roleMemoryPolicy = role.memoryPolicy && typeof role.memoryPolicy === "object" ? role.memoryPolicy as Record<string, unknown> : template.memoryPolicy
  const roleOutputPolicy = role.outputPolicy && typeof role.outputPolicy === "object" ? role.outputPolicy as Record<string, unknown> : template.outputPolicy
  return (
    <div className="border-b px-4 py-3 last:border-b-0">
      <div className="grid gap-3 lg:grid-cols-[minmax(14rem,1.2fr)_minmax(18rem,1.8fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold">{template.name}</h3>
            <StatusPill status={template.status} />
            <RuntimeChip>{template.visibility}</RuntimeChip>
          </div>
          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">{template.slug}</div>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Bot className="size-3.5" />
            {roleName(template)} / {roleKey(template)}
          </div>
        </div>
        <div className="grid gap-1">
          <PolicyLine label="工具" values={arrayValue(roleToolPolicy, "allowedToolGroups")} />
          <PolicyLine label="Skills" values={arrayValue(roleSkillPolicy, "requiredSkills")} />
          <PolicyLine label="读取" values={arrayValue(roleMemoryPolicy, "readScopes")} />
          <PolicyLine label="写入" values={arrayValue(roleMemoryPolicy, "writeScopes")} />
          <PolicyLine label="输出" values={arrayValue(roleOutputPolicy, "expectedOutputTypes")} />
        </div>
        <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
          <details className="w-full lg:w-auto">
            <summary className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-muted">
              <FilePenLine className="size-3.5" />
              编辑
            </summary>
            <form action={updateTemplateAction} className="mt-3 grid gap-3 rounded-md border bg-muted/25 p-3 lg:w-[42rem]">
              <input type="hidden" name="templateSlug" value={template.slug} />
              <TemplateFields template={template} />
              <div className="flex justify-end">
                <Button type="submit" size="sm">保存模板</Button>
              </div>
            </form>
          </details>
          {template.status !== "disabled" && (
            <form action={disableTemplateAction}>
              <input type="hidden" name="templateSlug" value={template.slug} />
              <Button type="submit" size="sm" variant="outline">
                <ShieldOff className="size-4" />
                禁用
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

export default async function TaskRunTemplatesPage() {
  const session = await requireCurrentAccount()
  const { templates } = await apiGet<TemplateListResponse>("/api/v1/task-run-templates", { templates: [] })
  const activeCount = templates.filter((template) => template.status === "active").length

  return (
    <ProductShell
      active="control"
      title="TaskRun 模板"
      description="管理自动启动 TaskRun 时使用的结构化角色、工具、memory 和输出策略。"
      session={session}
      actions={
        <div className="flex gap-2">
          <Link href="/tasks">
            <Button size="sm" variant="outline">任务</Button>
          </Link>
          <Link href="/control/integration">
            <Button size="sm" variant="outline">Integration</Button>
          </Link>
        </div>
      }
    >
      <div className="space-y-5">
        <Toolbar>
          <Layers3 className="size-4 text-primary" />
          <span className="text-sm font-medium">模板控制面</span>
          <span className="text-xs text-muted-foreground">{activeCount} active / {templates.length} total</span>
        </Toolbar>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-4" />
              创建模板
            </CardTitle>
            <CardDescription>固定角色能力、工具范围、memory 策略和输出契约；不是单纯 prompt 输入框。</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createTemplateAction} className="grid gap-3">
              <TemplateFields />
              <div className="flex justify-end">
                <Button type="submit" size="sm">创建模板</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="size-4" />
              模板列表
            </CardTitle>
            <CardDescription>主视图只展示可判断行为的字段；具体 id 保持在 API/debug 层。</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {templates.length > 0 ? (
              <div>
                {templates.map((template) => (
                  <TemplateRow key={template.id} template={template} />
                ))}
              </div>
            ) : (
              <EmptyState title="暂无模板" description="后端启动后会种子内置模板，也可以在这里创建自定义模板。" />
            )}
          </CardContent>
        </Card>
      </div>
    </ProductShell>
  )
}
