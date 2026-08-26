import React, { useEffect, useState } from 'react'
import type { GroupKey, SessionView, SortKey } from '../../sidebar/view-model'
import './ViewBar.css'

// Order is the menu order; workspace leads because it is the default grouping.
const GROUP_LABELS: Record<GroupKey, string> = {
  workspace: 'Workspace',
  project: 'Project',
  status: 'Status',
  branch: 'Branch',
  none: 'None',
}

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recent',
  oldest: 'Oldest',
  name: 'Name',
  status: 'Status',
  manual: 'Manual',
}

export interface ViewBarProps {
  views: SessionView[]
  activeViewId: string
  onSelectView: (id: string) => void
  /** How many sessions each view would show, keyed by view id. */
  counts?: Record<string, number>
  /** Applies a grouping/sort/filter change to the active view. */
  onChangeView: (patch: Partial<SessionView>) => void
  /** True when the active view already shows only stale sessions. */
  hideStaleUnavailable: boolean
}

/**
 * Saved-view chips plus the grouping, sort and hide-stale controls. Sits below
 * SidebarHeader, which is workspace-independent and deliberately untouched.
 */
export function ViewBar({
  views,
  activeViewId,
  counts,
  onSelectView,
  onChangeView,
  hideStaleUnavailable,
}: ViewBarProps): JSX.Element {
  const [menu, setMenu] = useState<'group' | 'sort' | null>(null)

  // Dismiss like every other menu in the app: an outside click, or another
  // menu announcing it is opening.
  useEffect(() => {
    if (menu === null) return
    const close = (): void => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('close-context-menus', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('close-context-menus', close)
    }
  }, [menu])
  const active = views.find((v) => v.id === activeViewId) ?? views[0]

  return (
    <div className="view-bar">
      <div className="view-bar__chips">
        {views.map((v) => (
          <button
            key={v.id}
            className={`view-bar__chip${v.id === activeViewId ? ' view-bar__chip--active' : ''}`}
            onClick={() => onSelectView(v.id)}
            title={v.name}
          >
            {v.name}
            {counts?.[v.id] ? <span className="view-bar__count"> · {counts[v.id]}</span> : null}
          </button>
        ))}
      </div>

      <div className="view-bar__controls">
        <button
          className="view-bar__control"
          onClick={(e) => {
            e.stopPropagation()
            setMenu(menu === 'group' ? null : 'group')
          }}
        >
          Group: {GROUP_LABELS[active.groupBy]}
        </button>
        <button
          className="view-bar__control"
          onClick={(e) => {
            e.stopPropagation()
            setMenu(menu === 'sort' ? null : 'sort')
          }}
        >
          Sort: {SORT_LABELS[active.sortBy]}
        </button>
        {/* The Stale view shows only stale sessions, so a hide-stale toggle
            there would contradict itself (FR-021). */}
        {!hideStaleUnavailable && (
          <label className="view-bar__toggle">
            <input
              type="checkbox"
              checked={active.filters.hideStale ?? false}
              onChange={(e) =>
                onChangeView({ filters: { ...active.filters, hideStale: e.target.checked } })
              }
            />
            Hide stale
          </label>
        )}
      </div>

      {menu === 'group' && (
        <div className="view-bar__menu" role="menu" onClick={(e) => e.stopPropagation()}>
          {(Object.keys(GROUP_LABELS) as GroupKey[]).map((key) => (
            <button
              key={key}
              className="view-bar__menu-item"
              onClick={() => {
                onChangeView({ groupBy: key })
                setMenu(null)
              }}
            >
              {GROUP_LABELS[key]}
            </button>
          ))}
        </div>
      )}

      {menu === 'sort' && (
        <div className="view-bar__menu" role="menu" onClick={(e) => e.stopPropagation()}>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <button
              key={key}
              className="view-bar__menu-item"
              onClick={() => {
                onChangeView({ sortBy: key })
                setMenu(null)
              }}
            >
              {SORT_LABELS[key]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
