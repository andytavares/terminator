import React from 'react'
import { Dialog } from '@terminator/extension-ui'

interface Props {
  onClose: () => void
}

const ROWS: Array<{ keys: string[]; label: string }> = [
  { keys: ['k', 'j'], label: 'Next / previous hunk' },
  { keys: [']', '['], label: 'Next / previous file' },
  { keys: ['}', '{'], label: 'Next / previous chapter' },
  { keys: ['n'], label: 'Next unviewed' },
  { keys: ['v'], label: 'Mark file viewed' },
  { keys: ['s'], label: 'Since my review / whole PR' },
  { keys: ['c'], label: 'Cycle comments' },
  { keys: ['⇧C'], label: 'Agent notes on / off' },
  { keys: ['a'], label: 'Ask agent on selection' },
  { keys: ['e'], label: 'Explain selection' },
  { keys: ['r'], label: 'Comment on line' },
  { keys: ['m'], label: 'Private note' },
  { keys: ['g', 'd'], label: 'Peek definition' },
  { keys: ['t'], label: 'Hide file list' },
  { keys: ['i'], label: 'Insights panel' },
  { keys: ['⌘↵'], label: 'Submit review' },
]

/** S3: the "?" keyboard-shortcut sheet. */
export function KeyboardHelp({ onClose }: Props) {
  return (
    <Dialog title="Keyboard" size="wide" onDismiss={onClose} actions={[]}>
      <div className="rc-keys-overlay">
        <div className="rc-keys">
          {ROWS.map((row) => (
            <div key={row.label}>
              {row.keys.map((k) => (
                <span key={k} className="rc-kbd">
                  {k}
                </span>
              ))}
              {row.label}
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  )
}
