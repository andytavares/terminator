import React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { GroupKey, SessionView, SortKey } from '../../sidebar/view-model'
import { DropdownMenu, RadioChoices } from './menu'
import './SidebarMenu.css'

/**
 * Grouping by branch, by status or by branch name went with the terminal rows:
 * a branch is the listed item now, so bucketing by it is meaningless, and every
 * row carries its own state glyph so a status bucket adds nothing (FR-038).
 */
const GROUPS: Array<[GroupKey, string]> = [
  ['workspace', 'Workspace'],
  ['none', 'None'],
]

const SORTS: Array<[SortKey, string]> = [
  ['recent', 'Recent'],
  ['oldest', 'Oldest'],
  ['name', 'Name'],
  ['status', 'Status'],
  ['manual', 'Manual'],
]

export interface DisplayMenuProps {
  view: SessionView
  onChangeView: (patch: Partial<SessionView>) => void
}

/** How the branch list is arranged: grouping and sort, behind one control. */
export function DisplayMenu({ view, onChangeView }: DisplayMenuProps): JSX.Element {
  return (
    <DropdownMenu label="Display" icon={<SlidersHorizontal aria-hidden="true" />}>
      {(close) => {
        const pick = (patch: Partial<SessionView>): void => {
          onChangeView(patch)
          close()
        }
        return (
          <>
            <div className="sidebar-menu__heading">Group</div>
            <RadioChoices
              choices={GROUPS}
              current={view.groupBy}
              onPick={(groupBy) => pick({ groupBy })}
            />
            <div className="sidebar-menu__separator" />
            <div className="sidebar-menu__heading">Sort</div>
            <RadioChoices
              choices={SORTS}
              current={view.sortBy}
              onPick={(sortBy) => pick({ sortBy })}
            />
          </>
        )
      }}
    </DropdownMenu>
  )
}
