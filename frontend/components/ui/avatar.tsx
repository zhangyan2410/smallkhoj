import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const avatarVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-lg font-semibold uppercase",
  {
    variants: {
      size: {
        xs: "size-6 text-[10px] rounded-md",
        sm: "size-7 text-xs",
        default: "size-8 text-xs",
        lg: "size-9 text-sm",
        xl: "size-10 text-sm rounded-xl",
      },
    },
    defaultVariants: { size: "default" },
  }
)

function initials(name: string): string {
  const parts = name.trim().split(/[\s_\-./]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2)
  return (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")
}

function hashHue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 360
}

function Avatar({
  name,
  src,
  size,
  status,
  className,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof avatarVariants> & {
    name: string
    src?: string | null
    status?: "online" | "offline"
  }) {
  const hue = hashHue(name || "?")
  const style = src
    ? undefined
    : {
        backgroundColor: `hsl(${hue} 64% 92%)`,
        color: `hsl(${hue} 52% 34%)`,
      }
  return (
    <span data-slot="avatar" className="relative inline-flex shrink-0">
      <span className={cn(avatarVariants({ size }), className)} style={style} {...props}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} className="size-full object-cover" />
        ) : (
          initials(name)
        )}
      </span>
      {status ? (
        <span
          aria-label={status}
          className={cn(
            "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background",
            status === "online" ? "bg-success" : "bg-muted-foreground/40"
          )}
        />
      ) : null}
    </span>
  )
}

export { Avatar }
