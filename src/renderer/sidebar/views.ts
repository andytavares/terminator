import type { SessionView } from './view-model'

/** One key, matching the existing ad-hoc sidebar keys (width, expanded, collapsed). */
export const VIEWS_STORAGE_KEY = 'terminator.sidebar.views'

/**
 * The view the sidebar always opens on. The active view is deliberately not
 * persisted: a user who opens their laptop to 6 of 22 sessions reads it as
 * data loss, so a filtered view is never restored (FR-015).
 */
export const DEFAULT_VIEW_ID = 'everything'

/** Built-in views ship as data, not code, so the pure layer stays declarative. */
export const BUILT_IN_VIEWS: SessionView[] = [
  {
    id: 'everything',
    name: 'Everything',
    // Workspace first: it is the outermost thing a user navigates by, and the
    // grouping nests its projects, so nothing the project grouping offers is
    // lost by defaulting here.
    groupBy: 'workspace',
    sortBy: 'manual',
    filters: {},
    builtIn: true,
  },
  {
    id: 'needs-me',
    name: 'Needs me',
    // Grouped by status, not project: the whole point of this view is that it
    // is cross-project, so one "Awaiting you" section with a project badge per
    // row beats the same six sessions split across five headings.
    groupBy: 'status',
    sortBy: 'recent',
    filters: { states: ['awaiting-input'] },
    builtIn: true,
  },
  {
    id: 'active',
    name: 'Active',
    groupBy: 'project',
    sortBy: 'recent',
    filters: { states: ['working'] },
    builtIn: true,
  },
  {
    id: 'stale',
    name: 'Stale',
    groupBy: 'project',
    sortBy: 'oldest',
    filters: { staleOnly: true },
    builtIn: true,
  },
]

const BUILT_IN_IDS = new Set(BUILT_IN_VIEWS.map((v) => v.id))

function isSessionView(value: unknown): value is SessionView {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Partial<SessionView>
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.groupBy === 'string' &&
    typeof v.sortBy === 'string' &&
    typeof v.filters === 'object' &&
    v.filters !== null
  )
}

/**
 * Built-ins first, then the user's own.
 *
 * A built-in's definition stays in code, but the user's grouping, sort and
 * hide-stale choices for it are theirs and must survive a restart (FR-014), so
 * they are stored as an override keyed by view id and re-applied here. Corrupt
 * storage degrades to the built-ins rather than throwing — same convention as
 * workspace.store's loadExpandedIds.
 */
export function loadViews(): SessionView[] {
  try {
    const raw = localStorage.getItem(VIEWS_STORAGE_KEY)
    if (!raw) return BUILT_IN_VIEWS
    const parsed: unknown = JSON.parse(raw)

    // Legacy shape: a bare array of custom views, written before per-view
    // overrides existed.
    const custom = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.custom)
        ? parsed.custom
        : []
    const overrides = isRecord(parsed) && isRecord(parsed.overrides) ? parsed.overrides : {}

    const builtIns = BUILT_IN_VIEWS.map((v) => {
      const patch = overrides[v.id]
      return isRecord(patch) ? ({ ...v, ...patch, id: v.id, builtIn: true } as SessionView) : v
    })
    // A stored view may not squat on a built-in id, or it would shadow a view
    // the user cannot then get back.
    const ownViews = custom.filter(isSessionView).filter((v) => !BUILT_IN_IDS.has(v.id))
    return [...builtIns, ...ownViews]
  } catch {
    return BUILT_IN_VIEWS
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Persists the user's views, plus their per-view changes to the built-ins.
 * A built-in whose settings are untouched is not written at all.
 */
export function saveViews(views: SessionView[]): void {
  try {
    const custom = views.filter((v) => !v.builtIn && !BUILT_IN_IDS.has(v.id))
    const overrides: Record<string, Partial<SessionView>> = {}
    for (const builtIn of BUILT_IN_VIEWS) {
      const current = views.find((v) => v.id === builtIn.id)
      if (!current) continue
      const patch: Partial<SessionView> = {}
      if (current.groupBy !== builtIn.groupBy) patch.groupBy = current.groupBy
      if (current.sortBy !== builtIn.sortBy) patch.sortBy = current.sortBy
      if (JSON.stringify(current.filters) !== JSON.stringify(builtIn.filters)) {
        patch.filters = current.filters
      }
      if (Object.keys(patch).length > 0) overrides[builtIn.id] = patch
    }
    localStorage.setItem(VIEWS_STORAGE_KEY, JSON.stringify({ custom, overrides }))
  } catch {
    // ignore write failures (private browsing, storage full)
  }
}
