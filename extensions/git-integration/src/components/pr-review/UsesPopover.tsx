import React, { useState } from 'react'
import { Button, Popover } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk'
import './view-menu.css'

/** @internal */
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

function UsesList(props: { uses: Use[]; onPeek: () => void }) {
  return (
    <>
      <ul className="vm-uses-list">
        {props.uses.map((u) => (
          <li key={u.symbol}>
            <span>{u.symbol}</span>
            <span className={u.read ? 'vm-note' : 'vm-note vm-note--warn'}>
              {u.read ? `step ${u.definedInStep} · read` : `step ${u.definedInStep} · not read`}
            </span>
          </li>
        ))}
      </ul>
      <Button size="sm" className="vm-block" onClick={props.onPeek}>
        Peek definition
        <kbd className="tmui-kbd">g d</kbd>
      </Button>
    </>
  )
}

function labelsFor(uses: Use[]) {
  const unread = uses.filter((u) => !u.read).length
  const countText = `Uses ${uses.length} ${plural(uses.length, 'symbol')} from this PR`
  return { countText, fullText: `${countText} · ${unread} not yet read`, unread }
}

/** File-header "Uses" button: the reading-order symbols this file depends on. */
export function UsesPopover({ uses, compact, onPeekDefinition }: UsesPopoverProps) {
  const [open, setOpen] = useState(false)
  if (uses.length === 0) return null
  const { countText, fullText, unread } = labelsFor(uses)
  const label = compact || unread === 0 ? countText : fullText
  const peek = () => {
    setOpen(false)
    onPeekDefinition()
  }
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
        <Popover label="Uses" align="end" onDismiss={() => setOpen(false)} className="vm-popover">
          <UsesList uses={uses} onPeek={peek} />
        </Popover>
      )}
    </div>
  )
}
