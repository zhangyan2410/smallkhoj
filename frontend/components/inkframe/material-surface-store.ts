import type { MaterialOwnerKind } from "./material-resource"

export type MaterialWorkspaceRegion = "app-background" | "chat-main" | "task-main" | (string & {})

export type ActiveMaterialSurfaceRecord = {
  region: MaterialWorkspaceRegion
  ownerId: string
  ownerKind: MaterialOwnerKind
  deactivate: (keep: boolean) => Promise<void> | void
}

export type MaterialSurfaceCoordinator = {
  getActive: (region: MaterialWorkspaceRegion) => ActiveMaterialSurfaceRecord | null
  activate: (
    record: ActiveMaterialSurfaceRecord,
    options?: { keepPrevious?: boolean },
  ) => Promise<ActiveMaterialSurfaceRecord>
  release: (region: MaterialWorkspaceRegion, ownerId: string) => void
  deactivate: (region: MaterialWorkspaceRegion, options?: { keep?: boolean }) => Promise<void>
  deactivateAll: (options?: { keep?: boolean }) => Promise<void>
}

export function createMaterialSurfaceCoordinator(): MaterialSurfaceCoordinator {
  const activeByRegion = new Map<MaterialWorkspaceRegion, ActiveMaterialSurfaceRecord>()

  async function deactivateRecord(record: ActiveMaterialSurfaceRecord, keep: boolean) {
    await record.deactivate(keep)
  }

  return {
    getActive(region) {
      return activeByRegion.get(region) ?? null
    },

    async activate(record, options = {}) {
      const current = activeByRegion.get(record.region)
      if (current && current.ownerId !== record.ownerId) {
        await deactivateRecord(current, options.keepPrevious ?? false)
      }
      activeByRegion.set(record.region, record)
      return record
    },

    release(region, ownerId) {
      const current = activeByRegion.get(region)
      if (current?.ownerId === ownerId) activeByRegion.delete(region)
    },

    async deactivate(region, options = {}) {
      const current = activeByRegion.get(region)
      if (!current) return
      await deactivateRecord(current, options.keep ?? false)
      if (activeByRegion.get(region) === current) activeByRegion.delete(region)
    },

    async deactivateAll(options = {}) {
      const entries = Array.from(activeByRegion.entries())
      await Promise.all(entries.map(([, record]) => deactivateRecord(record, options.keep ?? false)))
      for (const [region, record] of entries) {
        if (activeByRegion.get(region) === record) activeByRegion.delete(region)
      }
    },
  }
}

export const materialSurfaceCoordinator = createMaterialSurfaceCoordinator()
