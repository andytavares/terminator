// How the operator has arranged Home. Persisted per machine in localStorage —
// the one side effect in this module, isolated to loadHomePrefs/saveHomePrefs,
// the same convention the board's hidden lanes used.

export type HomeLayout = 'ledger' | 'logbook'
export type LedgerGroupBy = 'workspace-project' | 'project' | 'none'
export type LedgerSort = 'needs-you' | 'recent'

export interface LedgerColumns {
  branch: boolean
  workItem: boolean
  tags: boolean
  latestLine: boolean
  age: boolean
}

export interface HomePrefs {
  layout: HomeLayout
  groupBy: LedgerGroupBy
  sort: LedgerSort
  columns: LedgerColumns
  previewSelected: boolean
  hideExited: boolean
}

export const HOME_PREFS_KEY = 'terminator.home.prefs'

export const DEFAULT_HOME_PREFS: HomePrefs = {
  layout: 'ledger',
  groupBy: 'workspace-project',
  sort: 'needs-you',
  columns: { branch: true, workItem: true, tags: false, latestLine: true, age: true },
  previewSelected: true,
  hideExited: false,
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * Field by field, so a preference written by a later version — or one damaged
 * by hand — costs only the field it broke, never the whole arrangement.
 */
export function loadHomePrefs(): HomePrefs {
  let raw: unknown
  try {
    const stored = localStorage.getItem(HOME_PREFS_KEY)
    raw = stored === null ? null : JSON.parse(stored)
  } catch {
    return DEFAULT_HOME_PREFS
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return DEFAULT_HOME_PREFS
  const p = raw as Record<string, unknown>
  const d = DEFAULT_HOME_PREFS
  const c = (typeof p.columns === 'object' && p.columns !== null ? p.columns : {}) as Record<
    string,
    unknown
  >
  return {
    layout: oneOf(p.layout, ['ledger', 'logbook'], d.layout),
    groupBy: oneOf(p.groupBy, ['workspace-project', 'project', 'none'], d.groupBy),
    sort: oneOf(p.sort, ['needs-you', 'recent'], d.sort),
    columns: {
      branch: flag(c.branch, d.columns.branch),
      workItem: flag(c.workItem, d.columns.workItem),
      tags: flag(c.tags, d.columns.tags),
      latestLine: flag(c.latestLine, d.columns.latestLine),
      age: flag(c.age, d.columns.age),
    },
    previewSelected: flag(p.previewSelected, d.previewSelected),
    hideExited: flag(p.hideExited, d.hideExited),
  }
}

/** A preference is not worth an exception. */
export function saveHomePrefs(prefs: HomePrefs): void {
  try {
    localStorage.setItem(HOME_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    /* storage refused; the arrangement lasts until reload */
  }
}
