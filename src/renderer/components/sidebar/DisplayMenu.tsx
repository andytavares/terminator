import React, { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { GroupKey, SessionView, SortKey } from '../../sidebar/view-model'
import { closeAllContextMenus } from '../ContextMenu'
import './SidebarMenu.css'

/**
 * Grouping by branch, by status or by branch name went with the terminal rows:
 * a branch is the listed item now, so bucketing by it is meaningless, and every
 * row carries its own state glyph so a status bucket adds nothing (FR-038).
 */
const GROUP_LABELS: Record<GroupKey, string> = {
  workspace: 'Workspace',
  none: 'None',
}

const SORT_LABELS: Record<SortKey, string> = {
  recent: 'Recent',
  oldest: 'Oldest',
  name: 'Name',
  status: 'Status',
  manual: 'Manual',
}

export interface DisplayMenuProps {
  view: SessionView
  onChangeView: (patch: Partial<SessionView>) => void
}

/** How the branch list is arranged: grouping and sort, behind one control. */
export function DisplayMenu({ view, onChangeView }: DisplayMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const close = (): void => setOpen(false)
    window.addEventListener('click', close)
    window.addEventListener('close-context-menus', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('close-context-menus', close)
    }
  }, [open])

  return (
    <div className="sidebar-menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="sidebar-menu__button"
        aria-expanded={open}
        aria-label="Display"
        onClick={() => {
          closeAllContextMenus()
          setOpen((v) => !v)
        }}
      >
        <SlidersHorizontal aria-hidden="true" />
        <span className="sidebar-menu__label">Display</span>
      </button>

      {open && (
        <div className="sidebar-menu__panel" role="menu">
          <div className="sidebar-menu__heading">Group</div>
          {(Object.keys(GROUP_LABELS) as GroupKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={view.groupBy === key}
              className={`sidebar-menu__item${view.groupBy === key ? ' sidebar-menu__item--on' : ''}`}
              onClick={() => {
                onChangeView({ groupBy: key })
                setOpen(false)
              }}
            >
              {GROUP_LABELS[key]}
            </button>
          ))}

          <div className="sidebar-menu__separator" />
          <div className="sidebar-menu__heading">Sort</div>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={view.sortBy === key}
              className={`sidebar-menu__item${view.sortBy === key ? ' sidebar-menu__item--on' : ''}`}
              onClick={() => {
                onChangeView({ sortBy: key })
                setOpen(false)
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
