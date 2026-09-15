// How the operator has arranged the Monitor wall. Persisted per machine in
// localStorage — the one side effect here, isolated to load/save.

export type TileSize = 's' | 'm' | 'l'
export type WallThenBy = 'state' | 'workspace-project' | 'recent'

export interface WallPrefs {
  size: TileSize
  pinNeeds: boolean
  thenBy: WallThenBy
}

export const WALL_PREFS_KEY = 'terminator.wall.prefs'

export const DEFAULT_WALL_PREFS: WallPrefs = { size: 'm', pinNeeds: true, thenBy: 'state' }

export function loadWallPrefs(): WallPrefs {
  let raw: unknown
  try {
    const stored = localStorage.getItem(WALL_PREFS_KEY)
    raw = stored === null ? null : JSON.parse(stored)
  } catch {
    return DEFAULT_WALL_PREFS
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_WALL_PREFS
  const p = raw as Record<string, unknown>
  const d = DEFAULT_WALL_PREFS
  return {
    size: ['s', 'm', 'l'].includes(p.size as string) ? (p.size as TileSize) : d.size,
    pinNeeds: typeof p.pinNeeds === 'boolean' ? p.pinNeeds : d.pinNeeds,
    thenBy: ['state', 'workspace-project', 'recent'].includes(p.thenBy as string)
      ? (p.thenBy as WallThenBy)
      : d.thenBy,
  }
}

/** A preference is not worth an exception. */
export function saveWallPrefs(prefs: WallPrefs): void {
  try {
    localStorage.setItem(WALL_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage refused; the arrangement lasts until reload */
  }
}
