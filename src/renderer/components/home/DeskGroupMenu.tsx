import React from 'react'
import { ChevronDown } from 'lucide-react'
import { DropdownMenu, RadioChoices } from '../sidebar/menu'
import { useDeskSelection } from './desk-selection'
import { DESK_GROUP_OPTIONS } from './desk-groups'
import '../sidebar/SidebarMenu.css'
import './InFlight.css'

/** The Group: menu above a list of work; the choice is kept in the Desk's selection store. */
export function DeskGroupMenu(): JSX.Element {
  const groupBy = useDeskSelection((s) => s.groupBy)
  const setGroupBy = useDeskSelection((s) => s.setGroupBy)
  const current = DESK_GROUP_OPTIONS.find(([value]) => value === groupBy)?.[1]
  return (
    <DropdownMenu
      label={`Group: ${current}`}
      icon={<ChevronDown aria-hidden="true" />}
      panelLabel="Group by"
      variant="desk-group-menu"
    >
      {(close) => (
        <RadioChoices
          choices={DESK_GROUP_OPTIONS}
          current={groupBy}
          onPick={(value) => {
            setGroupBy(value)
            close()
          }}
        />
      )}
    </DropdownMenu>
  )
}
