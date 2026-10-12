import React, { useState } from 'react'
import { Button, Popover } from '@terminator/extension-ui'
import './view-menu.css'

export interface Use {
  symbol: string
  definedInStep: number
  read: boolean
}

export interface UsesPopoverProps {
  uses: Use[]
  compact?: boolean
  onPeekDefinition: () => void
}

/** File-header "Uses" button: the reading-order symbols this file depends on. */
export function UsesPopover({ uses, compact, onPeekDefinition }: UsesPopoverProps) {
  const [open, setOpen] = useState(false)
  if (uses.length === 0) return null

  const unread = uses.filter((u) => !u.read).length
  const fullText = `Uses ${uses.length} · ${unread} unread`
  const label = compact || unread === 0 ? `Uses ${uses.length}` : fullText

  return (
    <div className="vm">
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="true"
        aria-expanded={open}
        title={fullText}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </Button>
      {open && (
        <Popover label="Uses" onDismiss={() => setOpen(false)} className="vm-popover">
          <ul className="vm-uses-list">
            {uses.map((u) => (
              <li key={u.symbol}>
                <span>{u.symbol}</span>
                <span className={u.read ? 'vm-note' : 'vm-note vm-note--warn'}>
                  {u.read ? `step ${u.definedInStep} · read` : `step ${u.definedInStep} · not read`}
                </span>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            className="vm-block"
            onClick={() => {
              setOpen(false)
              onPeekDefinition()
            }}
          >
            Peek definition
            <kbd className="tmui-kbd">g d</kbd>
          </Button>
        </Popover>
      )}
    </div>
  )
}
