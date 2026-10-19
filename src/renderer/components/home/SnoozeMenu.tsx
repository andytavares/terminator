import React from 'react'
import { Popover } from '@terminator/extension-ui'
import { snoozeChoices } from './desk-actions'

export interface SnoozeMenuProps {
  now: number
  onPick: (until: number) => void
  onClose: () => void
}

/** How long to put an ask off: an hour, this afternoon, or tomorrow morning. */
export function SnoozeMenu(props: SnoozeMenuProps): JSX.Element {
  const { now, onPick, onClose } = props
  return (
    <Popover label="Snooze until" onDismiss={onClose} className="snooze-menu">
      <div role="menu" aria-label="Snooze until">
        {snoozeChoices(now).map((choice) => (
          <button
            key={choice.label}
            type="button"
            role="menuitem"
            className="snooze-menu__item"
            onClick={() => onPick(choice.until)}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </Popover>
  )
}
