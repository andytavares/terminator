import React, { useEffect, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { closeAllContextMenus } from '../ContextMenu'
import { useMenuPlacement } from '../use-menu-placement'
import type { HomePrefs, LedgerColumns, LedgerGroupBy, LedgerSort } from '../../sidebar/home-prefs'
import '../sidebar/SidebarMenu.css'

const GROUPS: Array<[LedgerGroupBy, string]> = [
  ['workspace-project', 'Repo, then branch'],
  ['project', 'Branch'],
  ['none', 'None'],
]

const SORTS: Array<[LedgerSort, string]> = [
  ['needs-you', 'Needs you first'],
  ['recent', 'Recent activity'],
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
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const placement = useMenuPlacement(open, buttonRef, panelRef)

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

  const radio = (checked: boolean, label: string, patch: Partial<HomePrefs>): JSX.Element => (
    <button
      key={label}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      className={`sidebar-menu__item${checked ? ' sidebar-menu__item--on' : ''}`}
      onClick={() => {
        onChange(patch)
        setOpen(false)
      }}
    >
      {label}
    </button>
  )

  const check = (checked: boolean, label: string, patch: Partial<HomePrefs>): JSX.Element => (
    <button
      key={label}
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      className={`sidebar-menu__item${checked ? ' sidebar-menu__item--on' : ''}`}
      onClick={() => onChange(patch)}
    >
      {label}
    </button>
  )

  return (
    <div className="sidebar-menu home-menu" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        className={`sidebar-menu__button${open ? ' sidebar-menu__button--on' : ''}`}
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
