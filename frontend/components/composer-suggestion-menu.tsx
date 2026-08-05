"use client"

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

export type ComposerSuggestionOption = {
  id: string
  value: string
  primary: string
  secondary?: string | null
  kind: "member" | "channel"
}

export function ComposerSuggestionMenu({
  id,
  anchorRef,
  open,
  options,
  activeIndex,
  emptyLabel,
  onActiveIndexChange,
  onSelect,
}: {
  id: string
  anchorRef: RefObject<HTMLInputElement | null>
  open: boolean
  options: ComposerSuggestionOption[]
  activeIndex: number
  emptyLabel: string
  onActiveIndexChange: (index: number) => void
  onSelect: (option: ComposerSuggestionOption) => void
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [position, setPosition] = useState<{
    left: number
    top?: number
    bottom?: number
    width: number
  } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const viewportPadding = 8
      const width = Math.min(Math.max(rect.width, 280), window.innerWidth - viewportPadding * 2)
      const left = Math.max(
        viewportPadding,
        Math.min(rect.left, window.innerWidth - width - viewportPadding),
      )
      if (rect.top >= 220) {
        setPosition({
          left,
          bottom: window.innerHeight - rect.top + 6,
          width,
        })
      } else {
        setPosition({ left, top: rect.bottom + 6, width })
      }
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
    }
  }, [anchorRef, open])

  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  if (!open || !position || typeof document === "undefined") return null

  return createPortal(
    <div
      id={id}
      role="listbox"
      data-slot="composer-suggestion-menu"
      className="fixed z-[90] max-h-72 overflow-y-auto border-2 border-[var(--ink)] bg-sand-card p-1 shadow-[3px_3px_0_var(--ink)]"
      style={position}
    >
      {options.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : options.map((option, index) => {
        const active = index === activeIndex
        return (
          <button
            key={option.id}
            ref={(node) => { optionRefs.current[index] = node }}
            id={`${id}-option-${index}`}
            type="button"
            role="option"
            aria-selected={active}
            data-kind={option.kind}
            className={cn(
              "flex w-full min-w-0 touch-manipulation items-start gap-2 border-2 px-2.5 py-2 text-left",
              active
                ? "border-[var(--ink)] bg-primary text-primary-foreground"
                : "border-transparent text-foreground hover:border-[var(--ink)] hover:bg-muted",
            )}
            onPointerEnter={() => onActiveIndexChange(index)}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{option.primary}</span>
              {option.secondary ? (
                <span className={cn(
                  "mt-0.5 line-clamp-2 block text-xs",
                  active ? "text-primary-foreground/80" : "text-muted-foreground",
                )}>
                  {option.secondary}
                </span>
              ) : null}
            </span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}
