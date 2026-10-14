import React from 'react'
import { Pencil } from 'lucide-react'
import { Button } from '@terminator/extension-ui'

interface EmptyStateProps {
  onNewNote?: () => void
  onImport?: () => void
}

export function EmptyState({ onNewNote, onImport }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="notepad-empty-state">
      <span className="notepad-empty-state__icon">
        <Pencil aria-hidden="true" />
      </span>
      <h2 className="notepad-empty-state__heading">No notes yet</h2>
      <p className="notepad-empty-state__desc">
        Capture your first note from anywhere in Terminator — even mid-command. Notes are kept on
        this machine and export to plain markdown whenever you want.
      </p>
      <div className="notepad-empty-state__buttons">
        <Button variant="primary" onClick={onNewNote}>
          New note <kbd className="tmui-kbd">⌘⇧N</kbd>
        </Button>
        {onImport && <Button onClick={onImport}>Import a folder…</Button>}
      </div>
      <p className="notepad-empty-state__tip">
        Tip: press <kbd className="notepad-kbd">⌘⇧N</kbd> anytime — the overlay opens over your
        terminal.
      </p>
    </div>
  )
}
