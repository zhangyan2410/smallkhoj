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
  // Strip leading @ (handles like "@zy-ean" should show "zy" not "@E")
  const clean = name.trim().replace(/^@+/, "")
  const parts = clean.split(/[\s_\-./@]+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2)
  return (parts[0][0] ?? "") + (parts[parts.length - 1][0] ?? "")
}

// Per DESIGN.md, all UI colors live in the mid-sea blue / warm sand band
// (hue 200-225 for accents, 70-85 for warm surfaces). Avatar tints sample from
// that band — no random rainbow hue.
const AVATAR_TINTS: Array<{ bg: string; fg: string }> = [
  { bg: "oklch(0.95 0.025 215)", fg: "oklch(0.32 0.06 215)" }, // sea tint
  { bg: "oklch(0.95 0.030 198)", fg: "oklch(0.32 0.06 198)" }, // turquoise tint
  { bg: "oklch(0.96 0.020 230)", fg: "oklch(0.30 0.06 230)" }, // deep sea tint
  { bg: "oklch(0.96 0.025 85)",  fg: "oklch(0.34 0.05 55)"  }, // warm sand tint
  { bg: "oklch(0.95 0.030 200)", fg: "oklch(0.32 0.06 200)" }, // bright sea
  { bg: "oklch(0.96 0.025 150)", fg: "oklch(0.30 0.06 150)" }, // sea-green (accent only)
]

function hashTintIndex(name: string): number {
  const clean = (name || "").trim().replace(/^@+/, "")
  if (!clean) return 0
  let h = 0
  for (let i = 0; i < clean.length; i++) h = (h * 31 + clean.charCodeAt(i)) >>> 0
  return h % AVATAR_TINTS.length
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
  const tint = AVATAR_TINTS[hashTintIndex(name || "?")]
  const style = src
    ? undefined
    : {
        backgroundColor: tint.bg,
        color: tint.fg,
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
