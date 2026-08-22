import React, { useState } from 'react'
import type { GroupKey, SessionView, SortKey } from '../../sidebar/view-model'
import './ViewBar.css'

const GROUP_LABELS: Record<GroupKey, string> = {
  project: 'Project',
  workspace: 'Workspace',
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
  /** Applies a grouping/sort/filter change to the active view. */
  onChangeView: (patch: Partial<SessionView>) => void
  onSaveAsNew: (name: string) => void
  onDeleteView: (id: string) => void
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
  onSelectView,
  onChangeView,
  onSaveAsNew,
  onDeleteView,
  hideStaleUnavailable,
}: ViewBarProps): JSX.Element {
  const [menu, setMenu] = useState<'group' | 'sort' | null>(null)
  const [newName, setNewName] = useState<string | null>(null)
  const active = views.find((v) => v.id === activeViewId) ?? views[0]

  function commitNewView(): void {
    const trimmed = newName?.trim()
    if (trimmed) onSaveAsNew(trimmed.slice(0, 40))
    setNewName(null)
  }

  return (
    <div className="view-bar">
      <div className="view-bar__chips">
        {views.map((v) => (
          <button
            key={v.id}
            className={`view-bar__chip${v.id === activeViewId ? ' view-bar__chip--active' : ''}`}
            onClick={() => onSelectView(v.id)}
            onContextMenu={(e) => {
              if (v.builtIn) return
              e.preventDefault()
              onDeleteView(v.id)
            }}
            title={v.builtIn ? v.name : `${v.name} (right-click to delete)`}
          >
            {v.name}
          </button>
        ))}
        <button
          className="view-bar__chip view-bar__chip--add"
          title="Save current view"
          onClick={() => setNewName('')}
        >
          +
        </button>
      </div>

      {newName !== null && (
        <input
          className="view-bar__name-input"
          placeholder="View name"
          value={newName}
          autoFocus
          maxLength={40}
          onChange={(e) => setNewName(e.target.value)}
          onBlur={commitNewView}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitNewView()
            if (e.key === 'Escape') setNewName(null)
          }}
        />
      )}

      <div className="view-bar__controls">
        <button
          className="view-bar__control"
          onClick={() => setMenu(menu === 'group' ? null : 'group')}
        >
          Group: {GROUP_LABELS[active.groupBy]}
        </button>
        <button
          className="view-bar__control"
          onClick={() => setMenu(menu === 'sort' ? null : 'sort')}
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
        <div className="view-bar__menu" role="menu">
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
        <div className="view-bar__menu" role="menu">
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
