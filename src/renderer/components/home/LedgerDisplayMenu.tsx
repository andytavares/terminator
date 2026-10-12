import React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { MenuChoice, useMenu } from '../sidebar/menu'
import type { HomePrefs, LedgerColumns, LedgerGroupBy, LedgerSort } from '../../sidebar/home-prefs'
import '../sidebar/SidebarMenu.css'

const GROUPS: Array<[LedgerGroupBy, string]> = [
  ['workspace-project', 'Repo, then branch'],
  ['project', 'Branch'],
  ['none', 'None'],
]

const SORTS: Array<[LedgerSort, string]> = [
  ['needs-you', 'Needs you first'],
  ['recent', 'Recently opened'],
]

const COLUMNS: Array<[keyof LedgerColumns, string]> = [
  ['branch', 'Branch'],
  ['workItem', 'Work item or description'],
  ['tags', 'Tags'],
  ['latestLine', 'Latest output'],
  ['age', 'Age'],
]

interface Props {
  prefs: HomePrefs
  onChange: (patch: Partial<HomePrefs>) => void
}

/** How the Ledger is arranged, behind one control, in the shape of the sidebar's Display menu. */
export function LedgerDisplayMenu({ prefs, onChange }: Props): JSX.Element {
  const { open, close, toggle, buttonRef, panelRef, placement } = useMenu()

  const radio = (checked: boolean, label: string, patch: Partial<HomePrefs>): JSX.Element => (
    <MenuChoice
      key={label}
      checked={checked}
      onSelect={() => {
        onChange(patch)
        close()
      }}
    >
      {label}
    </MenuChoice>
  )

  const check = (checked: boolean, label: string, patch: Partial<HomePrefs>): JSX.Element => (
    <MenuChoice key={label} kind="checkbox" checked={checked} onSelect={() => onChange(patch)}>
      {label}
    </MenuChoice>
  )

  return (
    <div className="sidebar-menu home-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        className={`sidebar-menu__button${open ? ' sidebar-menu__button--on' : ''}`}
        aria-expanded={open}
        aria-label="Display"
        onClick={toggle}
      >
        <SlidersHorizontal aria-hidden="true" />
        <span className="sidebar-menu__label">Display</span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="sidebar-menu__panel home-menu__panel"
          role="menu"
          aria-label="Display options"
          style={placement}
        >
          <div className="sidebar-menu__heading">Group by</div>
          {GROUPS.map(([key, label]) => radio(prefs.groupBy === key, label, { groupBy: key }))}
          <div className="sidebar-menu__separator" />
          <div className="sidebar-menu__heading">Sort</div>
          {SORTS.map(([key, label]) => radio(prefs.sort === key, label, { sort: key }))}
          <div className="sidebar-menu__separator" />
          <div className="sidebar-menu__heading">Columns</div>
          {COLUMNS.map(([key, label]) =>
            check(prefs.columns[key], label, {
              columns: { ...prefs.columns, [key]: !prefs.columns[key] },
            })
          )}
          <div className="sidebar-menu__separator" />
          {check(prefs.previewSelected, 'Preview the selected row', {
            previewSelected: !prefs.previewSelected,
          })}
          {check(prefs.hideExited, 'Hide exited sessions', { hideExited: !prefs.hideExited })}
        </div>
      )}
    </div>
  )
}
