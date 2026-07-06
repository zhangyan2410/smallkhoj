export type MaterialOwnerKind = "app-background" | "message" | "task" | "evidence" | "review"

export type MaterialSourceKind = "none" | "image" | "generated" | "ink-only"

export type MaterialResourceLifecycle = "private" | "shared"

export type MaterialResource = {
  id: string
  ownerKind: MaterialOwnerKind
  tint: "desk" | "paper" | "task" | "evidence" | "review" | string
  sourceKind: MaterialSourceKind
  lifecycle: MaterialResourceLifecycle
  visualBlob?: Blob
  visualObjectUrl?: string
  restoreBlob?: Blob
  restoreObjectUrl?: string
  sourceBlob?: Blob
  sourceObjectUrl?: string
  createdAt: number
}

export type MaterialResourceInput = {
  id: string
  ownerKind: MaterialOwnerKind
  tint: MaterialResource["tint"]
  sourceKind?: MaterialSourceKind
  lifecycle?: MaterialResourceLifecycle
  visualBlob?: Blob
  restoreBlob?: Blob
  sourceBlob?: Blob
}

export type MaterialResourceUrlEnv = {
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  now?: () => number
}

export const defaultMaterialResourceUrlEnv: MaterialResourceUrlEnv = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  now: () => Date.now(),
}

const trackedPrivateResources = new Set<MaterialResource>()
let pageLifecycleInstalled = false

function installMaterialResourcePageLifecycle() {
  if (pageLifecycleInstalled || typeof window === "undefined") return
  pageLifecycleInstalled = true
  window.addEventListener("pagehide", () => {
    flushMaterialResourcePageLifecycle()
  })
}

function trackMaterialResourceForPageLifecycle(resource: MaterialResource) {
  if (resource.lifecycle === "shared") return
  trackedPrivateResources.add(resource)
  installMaterialResourcePageLifecycle()
}

export function flushMaterialResourcePageLifecycle(
  env: Pick<MaterialResourceUrlEnv, "revokeObjectURL"> = defaultMaterialResourceUrlEnv,
): number {
  let revoked = 0
  for (const resource of Array.from(trackedPrivateResources)) {
    revoked += revokeMaterialResource(resource, env)
  }
  trackedPrivateResources.clear()
  return revoked
}

export function createMaterialResource(
  input: MaterialResourceInput,
  env: MaterialResourceUrlEnv = defaultMaterialResourceUrlEnv,
): MaterialResource {
  const resource: MaterialResource = {
    id: input.id,
    ownerKind: input.ownerKind,
    tint: input.tint,
    sourceKind: input.sourceKind ?? "none",
    lifecycle: input.lifecycle ?? "private",
    visualBlob: input.visualBlob,
    visualObjectUrl: input.visualBlob ? env.createObjectURL(input.visualBlob) : undefined,
    restoreBlob: input.restoreBlob,
    restoreObjectUrl: input.restoreBlob ? env.createObjectURL(input.restoreBlob) : undefined,
    sourceBlob: input.sourceBlob,
    sourceObjectUrl: input.sourceBlob ? env.createObjectURL(input.sourceBlob) : undefined,
    createdAt: env.now?.() ?? Date.now(),
  }
  trackMaterialResourceForPageLifecycle(resource)
  return resource
}

function uniqueResourceUrls(resource: MaterialResource): string[] {
  return [resource.visualObjectUrl, resource.restoreObjectUrl, resource.sourceObjectUrl].filter(
    (url, index, urls): url is string => Boolean(url) && urls.indexOf(url) === index,
  )
}

export function revokeMaterialResource(
  resource: MaterialResource | null | undefined,
  env: Pick<MaterialResourceUrlEnv, "revokeObjectURL"> = defaultMaterialResourceUrlEnv,
): number {
  if (!resource || resource.lifecycle === "shared") return 0
  trackedPrivateResources.delete(resource)
  const urls = uniqueResourceUrls(resource)
  for (const url of urls) env.revokeObjectURL(url)
  return urls.length
}

export function replaceMaterialResource<T extends MaterialResource | null | undefined>(
  current: MaterialResource | null | undefined,
  next: T,
  env: Pick<MaterialResourceUrlEnv, "revokeObjectURL"> = defaultMaterialResourceUrlEnv,
): T {
  if (current && current !== next) revokeMaterialResource(current, env)
  return next
}

export function discardMaterialResource<T extends MaterialResource | null | undefined>(
  current: MaterialResource | null | undefined,
  fallback: T,
  env: Pick<MaterialResourceUrlEnv, "revokeObjectURL"> = defaultMaterialResourceUrlEnv,
): T {
  if (current && current !== fallback) revokeMaterialResource(current, env)
  return fallback
}
