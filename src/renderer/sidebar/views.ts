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
    groupBy: 'project',
    sortBy: 'manual',
    filters: {},
    builtIn: true,
  },
  {
    id: 'needs-me',
    name: 'Needs me',
    groupBy: 'project',
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
 * Built-ins first, then the user's own. Corrupt storage degrades to the
 * built-ins rather than throwing — same convention as workspace.store's
 * loadExpandedIds.
 */
export function loadViews(): SessionView[] {
  try {
    const raw = localStorage.getItem(VIEWS_STORAGE_KEY)
    if (!raw) return BUILT_IN_VIEWS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return BUILT_IN_VIEWS
    // A stored view may not squat on a built-in id, or it would shadow a view
    // the user cannot then get back.
    const custom = parsed.filter(isSessionView).filter((v) => !BUILT_IN_IDS.has(v.id))
    return [...BUILT_IN_VIEWS, ...custom]
  } catch {
    return BUILT_IN_VIEWS
  }
}

/** Persists the custom views only; built-ins are code, not data. */
export function saveViews(views: SessionView[]): void {
  try {
    localStorage.setItem(
      VIEWS_STORAGE_KEY,
      JSON.stringify(views.filter((v) => !v.builtIn && !BUILT_IN_IDS.has(v.id)))
    )
  } catch {
    // ignore write failures (private browsing, storage full)
  }
}
