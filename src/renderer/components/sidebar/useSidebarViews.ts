import { useMemo, useState } from 'react'
import type { SessionView } from '../../sidebar/view-model'
import { BUILT_IN_VIEWS, DEFAULT_VIEW_ID, loadViews, saveViews } from '../../sidebar/views'

/** The active view, with the search typed into the header folded into its filters. */
function activeView(views: SessionView[], activeViewId: string, searchQuery: string): SessionView {
  const base =
    views.find((v) => v.id === activeViewId) ??
    BUILT_IN_VIEWS.find((v) => v.id === DEFAULT_VIEW_ID)!
  return searchQuery ? { ...base, filters: { ...base.filters, query: searchQuery } } : base
}

/** The saved views, which one is active, and the search. The active view is deliberately
 * component state, never restored from storage: a filtered view must never be what greets you
 * at launch (FR-015). */
export function useSidebarViews(initialViewId: string) {
  const [views, setViews] = useState(loadViews)
  const [activeViewId, setActiveViewId] = useState(initialViewId)
  const [searchQuery, setSearchQuery] = useState('')
  const view = useMemo(
    () => activeView(views, activeViewId, searchQuery),
    [views, activeViewId, searchQuery]
  )

  function changeActiveView(patch: Partial<SessionView>): void {
    const next = views.map((v) => (v.id === activeViewId ? { ...v, ...patch } : v))
    setViews(next)
    saveViews(next)
  }

  function showAll(): void {
    setSearchQuery('')
    setActiveViewId(DEFAULT_VIEW_ID)
  }

  return {
    views,
    activeViewId,
    setActiveViewId,
    view,
    searchQuery,
    setSearchQuery,
    changeActiveView,
    showAll,
  }
}

export type SidebarViews = ReturnType<typeof useSidebarViews>
