"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type TabsContextValue = {
  value: string
  onValueChange?: (value: string) => void
  listId: string
}

const TabsContext = React.createContext<TabsContextValue | null>(null)

function useTabsContext(component: string) {
  const context = React.useContext(TabsContext)
  if (!context) throw new Error(`${component} must be used inside <Tabs>`)
  return context
}

type TabsProps = React.HTMLAttributes<HTMLDivElement> & {
  value: string
  onValueChange?: (value: string) => void
}

const Tabs = React.forwardRef<HTMLDivElement, TabsProps>(
  ({ className, value, onValueChange, ...props }, ref) => {
    const listId = React.useId()
    return (
      <TabsContext.Provider value={{ value, onValueChange, listId }}>
        <div ref={ref} className={cn("space-y-2", className)} {...props} />
      </TabsContext.Provider>
    )
  },
)
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const { listId } = useTabsContext("TabsList")
    return (
      <div
        ref={ref}
        id={listId}
        role="tablist"
        aria-orientation="horizontal"
        className={cn("sk-tabs-list flex flex-wrap gap-2", className)}
        {...props}
      />
    )
  },
)
TabsList.displayName = "TabsList"

type TabsTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  value: string
}

const TabsTrigger = React.forwardRef<HTMLButtonElement, TabsTriggerProps>(
  ({ className, value, onClick, onKeyDown, disabled, ...props }, ref) => {
    const context = useTabsContext("TabsTrigger")
    const selected = context.value === value

    const moveToSibling = (direction: 1 | -1) => {
      const list = document.getElementById(context.listId)
      if (!list) return
      const triggers = Array.from(list.querySelectorAll<HTMLButtonElement>('[role="tab"]')).filter(
        (trigger) => !trigger.disabled,
      )
      const index = triggers.findIndex((trigger) => trigger === document.activeElement)
      if (index < 0 || triggers.length === 0) return
      const next = triggers[(index + direction + triggers.length) % triggers.length]
      next.focus()
      next.click()
    }

    return (
      <button
        ref={ref}
        type="button"
        role="tab"
        id={`${context.listId}-${value}-tab`}
        aria-selected={selected}
        aria-controls={`${context.listId}-${value}`}
        tabIndex={selected ? 0 : -1}
        data-state={selected ? "active" : "inactive"}
        disabled={disabled}
        className={cn(
          "sk-tabs-trigger min-h-8 rounded-none border-2 border-[var(--ink)] px-3 py-1.5 text-xs font-medium transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          selected ? "sk-accent-green shadow-[2px_2px_0_var(--ink)]" : "sk-accent-green-soft hover:-translate-y-px",
          className,
        )}
        onClick={(event) => {
          onClick?.(event)
          if (!event.defaultPrevented && !disabled) context.onValueChange?.(value)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key === "ArrowRight") {
            event.preventDefault()
            moveToSibling(1)
          } else if (event.key === "ArrowLeft") {
            event.preventDefault()
            moveToSibling(-1)
          }
        }}
        {...props}
      />
    )
  },
)
TabsTrigger.displayName = "TabsTrigger"

type TabsContentProps = React.HTMLAttributes<HTMLDivElement> & {
  value: string
}

const TabsContent = React.forwardRef<HTMLDivElement, TabsContentProps>(
  ({ className, value, ...props }, ref) => {
    const context = useTabsContext("TabsContent")
    if (context.value !== value) return null
    return (
      <div
        ref={ref}
        id={`${context.listId}-${value}`}
        role="tabpanel"
        aria-labelledby={`${context.listId}-${value}-tab`}
        tabIndex={0}
        className={cn("outline-none", className)}
        {...props}
      />
    )
  },
)
TabsContent.displayName = "TabsContent"

export { Tabs, TabsContent, TabsList, TabsTrigger }
