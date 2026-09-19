import type { QuickAction, QuickActionGroup } from './types'

export type SurfaceKind = 'global' | 'workspace' | 'project' | 'sidebar'

export interface SurfaceRegistration {
  extensionId: string
  view: string
  label: string
  kind: SurfaceKind
}

function firstFreeLetter(label: string, used: Set<string>): string | undefined {
  for (const ch of label.toLowerCase()) {
    if (/[a-z]/.test(ch) && !used.has(ch)) return ch
  }
  return undefined
}

/**
 * "Open <label>" actions for every non-core surface a registry holds: global
 * tabs, workspace tabs, project tabs and sidebar panels. Core never names an
 * extension (Principle II) — these are generated from registry data, not a
 * hard-coded list.
 */
export function buildSurfaceActions(
  surfaces: SurfaceRegistration[],
  groups: QuickActionGroup[],
  activate: (surface: SurfaceRegistration) => void
): QuickAction[] {
  const groupIdByOwner = new Map(groups.filter((g) => g.owner).map((g) => [g.owner!, g.id]))
  const mnemonicsUsed = new Map<string, Set<string>>()

  return surfaces.map((surface) => {
    const group = groupIdByOwner.get(surface.extensionId) ?? 'top'
    const used = mnemonicsUsed.get(group) ?? new Set<string>()
    const mnemonic = used.has('o') ? firstFreeLetter(surface.label, used) : 'o'
    if (mnemonic) used.add(mnemonic)
    mnemonicsUsed.set(group, used)

    return {
      id: `surface:${surface.extensionId}:${surface.view}`,
      label: `Open ${surface.label}`,
      group,
      mnemonic,
      run: () => activate(surface),
    }
  })
}

/** Finds the surface `extension:show-surface` asked for, by extension id and view param. */
export function findSurface(
  surfaces: SurfaceRegistration[],
  extensionId: string,
  view: string
): SurfaceRegistration | undefined {
  return surfaces.find((s) => s.extensionId === extensionId && s.view === view)
}
