"use client"

import { useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"

const STORAGE_KEY = "smallkhoj.members.lastSelected"

/**
 * 记住 members 页最后选中的成员，并在从别的页面切回 /members（无 ?member=）时恢复。
 *
 * 行为：
 * - 当前 URL 有 ?member=xx → 写入 sessionStorage
 * - 当前 URL 没有 ?member= 但 sessionStorage 有值 → router.replace 补上，
 *   选中态回来（不产生多余历史记录）
 *
 * 这样从 rail 点 /members 回来也能回到上次看的成员，符合「切走再切回不丢失」。
 * 只在客户端 effect 里读 sessionStorage，避免 hydration 不一致。
 */
export function RestoreMemberSelection() {
  const router = useRouter()
  const params = useSearchParams()
  const memberId = params.get("member")

  useEffect(() => {
    if (memberId) {
      // 记住当前选中
      try {
        sessionStorage.setItem(STORAGE_KEY, memberId)
      } catch {
        // sessionStorage 不可用（隐私模式等），静默降级
      }
    } else {
      // 无 query，尝试恢复
      try {
        const last = sessionStorage.getItem(STORAGE_KEY)
        if (last) {
          router.replace(`/members?member=${encodeURIComponent(last)}`)
        }
      } catch {
        // ignore
      }
    }
  }, [memberId, router])

  return null
}
