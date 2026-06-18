import React, { useState, useCallback } from 'react'
import { FolderOpen, X } from 'lucide-react'

type ExportScope = 'all' | 'note'

interface ExportDialogProps {
  onClose: () => void
  noteId?: string
}

export function ExportDialog({ onClose, noteId }: ExportDialogProps): React.JSX.Element {
  const [folder, setFolder] = useState<string | null>(null)
  const [scope, setScope] = useState<ExportScope>('all')
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  const pickFolder = useCallback(async () => {
    const result = await window.electronAPI.extensionBridge.invoke(
      'terminator.notepad:export.pickFolder',
      {}
    )
    const data = (result as { data: string | null }).data
    if (data) setFolder(data)
  }, [])

  const handleExport = useCallback(async () => {
    if (!folder) return
    setRunning(true)
    try {
      await window.electronAPI.extensionBridge.invoke('terminator.notepad:export.run', {
        folder,
        scope,
        ...(scope === 'note' && noteId ? { noteId } : {}),
      })
      setDone(true)
    } finally {
      setRunning(false)
    }
  }, [folder, scope, noteId])

  return (
    <div className="notepad-export-dialog" role="dialog" aria-label="Export notes">
      <div className="notepad-export-dialog__header">
        <span className="notepad-export-dialog__title">Export Notes</span>
        <button
          className="notepad-btn-ghost notepad-export-dialog__close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      <div className="notepad-export-dialog__body">
        <div className="notepad-export-dialog__folder-row">
          <button
            className="notepad-btn-ghost notepad-export-dialog__pick"
            onClick={pickFolder}
            aria-label="Choose folder"
          >
            <FolderOpen size={14} />
            Choose folder
          </button>
          {folder && <span className="notepad-export-dialog__folder-path">{folder}</span>}
        </div>

        <fieldset className="notepad-export-dialog__scope">
          <legend>Scope</legend>
          {(['all', 'note'] as ExportScope[]).map((s) => (
            <label key={s} className="notepad-export-dialog__scope-option">
              <input
                type="radio"
                name="scope"
                value={s}
                checked={scope === s}
                onChange={() => setScope(s)}
              />
              {s === 'all' ? 'All notes' : 'Current note'}
            </label>
          ))}
        </fieldset>

        {done && <div className="notepad-export-dialog__success">Export complete.</div>}
      </div>

      <div className="notepad-export-dialog__footer">
        <button className="notepad-btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          className="notepad-btn-primary notepad-export-dialog__export"
          onClick={handleExport}
          disabled={!folder || running}
          aria-label="Export"
        >
          Export
        </button>
      </div>
    </div>
  )
}
