"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

import { apiGet, type AgentSkill } from "@/lib/control-plane"
import { cn } from "@/lib/utils"

/**
 * 拉取 server 已安装技能列表（GET /api/v1/skills）。
 * 后端未就绪/请求失败时静默回退为空列表 —— 空列表有独立占位文案，
 * 不阻塞表单提交（见 frontend-handoff-phase1.md 验收 3）。
 */
export function useInstalledSkills(enabled = true): { skills: AgentSkill[]; loading: boolean } {
  const [skills, setSkills] = useState<AgentSkill[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    apiGet<{ skills: AgentSkill[] }>("/api/v1/skills", { skills: [] })
      .then((data) => {
        if (!cancelled) setSkills(Array.isArray(data?.skills) ? data.skills : [])
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])
  return { skills, loading }
}

/**
 * 技能多选 chips：名称 + 版本号，选中高亮。供创建表单与成员详情编辑复用。
 * 每项 chip 带 title 提示（Use-when 触发描述），卡片式详情见成员详情页。
 */
export function SkillChipsSelect({
  selectedIds,
  onToggle,
  disabled = false,
  idPrefix = "skill-chip",
  skills: skillsOverride,
}: {
  selectedIds: string[]
  onToggle: (skillId: string) => void
  disabled?: boolean
  idPrefix?: string
  /** 外部注入列表时跳过 GET /api/v1/skills（设计预览/测试用）。 */
  skills?: AgentSkill[]
}) {
  const t = useTranslations("chat")
  const fetched = useInstalledSkills(skillsOverride === undefined)
  const skills = skillsOverride ?? fetched.skills
  const loading = skillsOverride === undefined && fetched.loading

  if (!loading && skills.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">{t("skillsEmpty")}</p>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("agentSkillsLabel")}>
      {skills.map((skill) => {
        const selected = selectedIds.includes(skill.id)
        return (
          <button
            key={skill.id}
            id={`${idPrefix}-${skill.id}`}
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            title={skill.description}
            onClick={() => onToggle(skill.id)}
            className={cn(
              "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs font-medium transition-colors",
              selected ? "sk-cat-success" : "sk-cat-neutral hover:text-foreground",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <span className="truncate">{skill.name}</span>
            <span className="text-[0.65rem] opacity-70">v{skill.version}</span>
          </button>
        )
      })}
    </div>
  )
}
