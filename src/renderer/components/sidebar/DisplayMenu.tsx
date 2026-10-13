import React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { GroupKey, SessionView, SortKey } from '../../sidebar/view-model'
import { MenuChoice, useMenu } from './menu'
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
  const { open, close, toggle, buttonRef, panelRef, placement } = useMenu()

  return (
    <div className="sidebar-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        className="sidebar-menu__button"
        aria-expanded={open}
        aria-label="Display"
        onClick={toggle}
      >
        <SlidersHorizontal aria-hidden="true" />
        <span className="sidebar-menu__label">Display</span>
      </button>

      {open && (
        <div ref={panelRef} className="sidebar-menu__panel" role="menu" style={placement}>
          <div className="sidebar-menu__heading">Group</div>
          {(Object.keys(GROUP_LABELS) as GroupKey[]).map((key) => (
            <MenuChoice
              key={key}
              checked={view.groupBy === key}
              onSelect={() => {
                onChangeView({ groupBy: key })
                close()
              }}
            >
              {GROUP_LABELS[key]}
            </MenuChoice>
          ))}

          <div className="sidebar-menu__separator" />
          <div className="sidebar-menu__heading">Sort</div>
          {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
            <MenuChoice
              key={key}
              checked={view.sortBy === key}
              onSelect={() => {
                onChangeView({ sortBy: key })
                close()
              }}
            >
              {SORT_LABELS[key]}
            </MenuChoice>
          ))}
        </div>
      )}
    </div>
  )
}
