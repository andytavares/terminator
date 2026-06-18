import React from 'react'
import { Pencil } from 'lucide-react'

interface EmptyStateProps {
  onNewNote?: () => void
  onImport?: () => void
}

export function EmptyState({ onNewNote, onImport }: EmptyStateProps): React.JSX.Element {
  return (
    <div className="notepad-empty-state">
      <span className="notepad-empty-state__icon">
        <Pencil size={36} />
      </span>
      <h2 className="notepad-empty-state__heading">No notes yet</h2>
      <p className="notepad-empty-state__desc">
        Capture your first note from anywhere in Terminator — even mid-command. Notes live in a
        local SQLite vault and export to plain markdown whenever you want.
      </p>
      <div className="notepad-empty-state__buttons">
        <button className="notepad-btn-primary notepad-empty-state__new" onClick={onNewNote}>
          New note <kbd className="notepad-kbd notepad-kbd--inline">⌘⇧N</kbd>
        </button>
        {onImport && (
          <button className="notepad-btn-outline" onClick={onImport}>
            Import a folder…
          </button>
        )}
      </div>
      <p className="notepad-empty-state__tip">
        Tip: press <kbd className="notepad-kbd">⌘⇧N</kbd> anytime — the overlay opens over your
        terminal.
      </p>
    </div>
  )
}
