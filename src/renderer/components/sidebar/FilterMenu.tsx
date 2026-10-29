import React from 'react'
import { ListFilter } from 'lucide-react'
import type { SessionView } from '../../sidebar/view-model'
import { DropdownMenu, MenuChoice } from './menu'
import { recordUse } from '../../usage/record'
import './SidebarMenu.css'

export interface FilterMenuProps {
  views: SessionView[]
  activeViewId: string
  onSelectView: (id: string) => void
  /** How many branches each view would show, keyed by view id. */
  counts?: Record<string, number>
  onChangeView: (patch: Partial<SessionView>) => void
  /** True when the active view already shows only stale branches. */
  hideStaleUnavailable: boolean
  /** Branches after and before filtering, so the badge can say what is hidden. */
  shown: number
  total: number
  onShowAll: () => void
}

/**
 * Which branches are shown: the saved views and the stale toggle, behind one
 * control.
 *
 * This absorbed the chip strip and the filter-notice band. The notice existed
 * to say "showing 9 of 14" in a strip of its own; a count on the control that
 * caused the filtering says the same thing without a band of chrome, and puts
 * the way out in the same place as the way in.
 */
export function FilterMenu(props: FilterMenuProps): JSX.Element {
  const hidden = Math.max(0, props.total - props.shown)
  return (
    <DropdownMenu
      label="Filter"
      icon={<ListFilter aria-hidden="true" />}
      ariaLabel={hidden > 0 ? `Filter — ${hidden} hidden` : 'Filter'}
      on={hidden > 0}
      badge={hidden > 0 && <span className="sidebar-menu__badge">{hidden}</span>}
    >
      {(close) => (
        <>
          <ViewChoices {...props} close={close} />
          <div className="sidebar-menu__separator" />
          <HideStaleItem {...props} />
          {hidden > 0 && <ShowAllItem {...props} close={close} />}
        </>
      )}
    </DropdownMenu>
  )
}

type Closing = { close: () => void }

/** The saved views, each with how many branches it would show. */
function ViewChoices({
  views,
  activeViewId,
  onSelectView,
  counts,
  close,
}: FilterMenuProps & Closing): JSX.Element {
  return (
    <>
      {views.map((view) => (
        <MenuChoice
          key={view.id}
          checked={view.id === activeViewId}
          onSelect={() => {
            recordUse('core.sidebar.filter')
            onSelectView(view.id)
            close()
          }}
        >
          <span>{view.name}</span>
          {counts?.[view.id] ? (
            <span className="sidebar-menu__count">{counts[view.id]}</span>
          ) : null}
        </MenuChoice>
      ))}
    </>
  )
}

/** Toggles the active view's stale filter, keeping its other filters. */
function HideStaleItem({
  views,
  activeViewId,
  onChangeView,
  hideStaleUnavailable,
}: FilterMenuProps): JSX.Element {
  const active = views.find((v) => v.id === activeViewId) ?? views[0]
  const on = active?.filters.hideStale === true
  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={on}
      className="sidebar-menu__item"
      disabled={hideStaleUnavailable}
      onClick={() => {
        recordUse('core.sidebar.filter')
        onChangeView({ filters: { ...active.filters, hideStale: !on } })
      }}
    >
      <span>Hide stale</span>
      {on && <span className="sidebar-menu__tick">✓</span>}
    </button>
  )
}

/** The way out of the filtering, saying how much it hides. */
function ShowAllItem({ shown, total, onShowAll, close }: FilterMenuProps & Closing): JSX.Element {
  return (
    <>
      <div className="sidebar-menu__separator" />
      <button
        type="button"
        role="menuitem"
        className="sidebar-menu__item sidebar-menu__item--note"
        onClick={() => {
          recordUse('core.sidebar.filter')
          onShowAll()
          close()
        }}
      >
        Showing {shown} of {total} — show all
      </button>
    </>
  )
}
