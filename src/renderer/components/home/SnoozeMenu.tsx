import React from 'react'
import { Menu, MenuItem } from '@terminator/extension-ui'
import { snoozeChoices } from './desk-actions'
import { recordUse } from '../../usage/record'

export interface SnoozeMenuProps {
  now: number
  onPick: (until: number) => void
  onClose: () => void
}

/** How long to put an ask off: an hour, this afternoon, or tomorrow morning. */
export function SnoozeMenu(props: SnoozeMenuProps): JSX.Element {
  const { now, onPick, onClose } = props
  return (
    <Menu label="Snooze until" onDismiss={onClose} className="snooze-menu">
      {snoozeChoices(now).map((choice) => (
        <MenuItem
          key={choice.label}
          className="snooze-menu__item"
          onSelect={() => {
            recordUse('core.home.snooze')
            onPick(choice.until)
          }}
        >
          {choice.label}
        </MenuItem>
      ))}
    </Menu>
  )
}
