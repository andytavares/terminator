import React from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { DropdownMenu, MenuChoice, RadioChoices } from '../sidebar/menu'
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
  return (
    <DropdownMenu
      label="Display"
      icon={<SlidersHorizontal aria-hidden="true" />}
      on="when-open"
      variant="home-menu"
      panelLabel="Display options"
    >
      {(close) => <LedgerOptions prefs={prefs} onChange={onChange} close={close} />}
    </DropdownMenu>
  )
}

/** Grouping and sort, which close the menu once picked, then the toggles. */
function LedgerOptions({ prefs, onChange, close }: Props & { close: () => void }): JSX.Element {
  const pick = (patch: Partial<HomePrefs>): void => {
    onChange(patch)
    close()
  }
  return (
    <>
      <div className="sidebar-menu__heading">Group by</div>
      <RadioChoices
        choices={GROUPS}
        current={prefs.groupBy}
        onPick={(groupBy) => pick({ groupBy })}
      />
      <div className="sidebar-menu__separator" />
      <div className="sidebar-menu__heading">Sort</div>
      <RadioChoices choices={SORTS} current={prefs.sort} onPick={(sort) => pick({ sort })} />
      <div className="sidebar-menu__separator" />
      <LedgerToggles prefs={prefs} onChange={onChange} />
    </>
  )
}

/** The column checkboxes and the two row toggles; these leave the menu open. */
function LedgerToggles({ prefs, onChange }: Props): JSX.Element {
  const check = (checked: boolean, label: string, patch: Partial<HomePrefs>): JSX.Element => (
    <MenuChoice key={label} kind="checkbox" checked={checked} onSelect={() => onChange(patch)}>
      {label}
    </MenuChoice>
  )
  return (
    <>
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
    </>
  )
}
