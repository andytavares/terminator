import React from 'react'
import { Dialog } from '@terminator/extension-ui'

interface Props {
  onClose: () => void
}

const ROWS: Array<{ key: string; label: string }> = [
  { key: 'k', label: 'Next hunk' },
  { key: 'j', label: 'Previous hunk' },
  { key: 'Space', label: 'Mark hunk read, next hunk' },
  { key: 'c', label: 'Comment on line' },
  { key: 'l', label: 'Later: revisit after the last hunk' },
  { key: '⌘↵', label: 'Submit review' },
]

/** S3: the keyboard-shortcut sheet, opened from the footer and the header menu. */
export function KeyboardHelp({ onClose }: Props) {
  return (
    <Dialog title="Keyboard" size="wide" onDismiss={onClose} actions={[]}>
      <div className="rc-keys-overlay">
        <ul className="rc-keys">
          {ROWS.map((row) => (
            <li key={row.label}>
              <span className="rc-kbd">{row.key}</span>
              {row.label}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}
