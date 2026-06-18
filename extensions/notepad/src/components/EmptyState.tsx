import React from 'react'
import { FileText, FolderOpen } from 'lucide-react'

export function EmptyState({ onImport }: { onImport?: () => void }): React.JSX.Element {
  return (
    <div className="notepad-empty-state">
      <FileText size={40} className="notepad-empty-state__icon" />
      <h2 className="notepad-empty-state__heading">No notes yet</h2>
      <p className="notepad-empty-state__hint">
        Press <kbd className="notepad-kbd">Cmd+Shift+N</kbd> to create your first note
      </p>
      {onImport && (
        <button onClick={onImport} className="notepad-btn-ghost notepad-empty-state__import">
          <FolderOpen size={14} />
          Import folder…
        </button>
      )}
    </div>
  )
}
