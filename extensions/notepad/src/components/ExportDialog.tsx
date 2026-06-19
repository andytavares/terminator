import React, { useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'

type ExportScope = 'all' | 'note'
type CommentFormat = 'sidecar' | 'inline' | 'both'

function previewSlug(title: string, id: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) +
    '-' +
    id.slice(0, 8) +
    '.md'
  )
}

interface ExportDialogProps {
  onClose: () => void
  noteId?: string
}

export function ExportDialog({ onClose, noteId }: ExportDialogProps): React.JSX.Element {
  const { notes } = useNotesStore()
  const previewNote = noteId ? notes.find((n) => n.id === noteId) : notes[0]
  const [folder, setFolder] = useState('~/Documents/Terminator Notes')
  const [scope, setScope] = useState<ExportScope>('all')
  const [includeFrontmatter, setIncludeFrontmatter] = useState(true)
  const [commentFormat, setCommentFormat] = useState<CommentFormat>('sidecar')
  const [overwriteById, setOverwriteById] = useState(true)
  const [running, setRunning] = useState(false)
  const [exportResult, setExportResult] = useState<{ count: number; time: string } | null>(null)

  const scopeCount = scope === 'all' ? notes.length : 1

  const pickFolder = useCallback(async () => {
    const result = await window.electronAPI.extensionBridge.invoke(
      'terminator.notepad:export.pickFolder',
      {}
    )
    const data = (result as { data: string | null }).data
    if (data) setFolder(data)
  }, [])

  const handleExport = useCallback(async () => {
    if (!folder || running) return
    if (scope === 'note' && !noteId) return
    setRunning(true)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:export.run',
        {
          folder,
          scope,
          ...(scope === 'note' && noteId ? { noteId } : {}),
          includeFrontmatter,
          commentFormat,
          overwriteById,
        }
      )
      const data = (result as { data?: { exported: number } }).data
      const now = new Date()
      const time = `${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
      setExportResult({ count: data?.exported ?? 0, time })
    } finally {
      setRunning(false)
    }
  }, [folder, scope, noteId, running, includeFrontmatter, commentFormat, overwriteById])

  const commentFormatLabels: Record<CommentFormat, string> = {
    sidecar: 'Sidecar JSON',
    inline: 'Inline HTML',
    both: 'Both',
  }

  return (
    <div
      className="notepad-overlay-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="notepad-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export notes"
      >
        {/* Header */}
        <div className="notepad-export-dialog__header">
          <span className="notepad-export-dialog__title">Export to markdown</span>
          <button className="notepad-btn-icon" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="notepad-export-dialog__body">
          {/* Destination folder */}
          <div className="notepad-export-dialog__field">
            <div className="notepad-export-dialog__field-label">Destination folder</div>
            <div className="notepad-export-dialog__folder-row">
              <input
                className="notepad-export-dialog__folder-input"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                spellCheck={false}
                aria-label="Destination folder"
              />
              <button
                className="notepad-export-dialog__choose-btn"
                onClick={() => void pickFolder()}
                aria-label="Choose folder"
              >
                Choose…
              </button>
            </div>
          </div>

          {/* Scope */}
          <div className="notepad-export-dialog__field">
            <div className="notepad-export-dialog__field-label">Scope</div>
            <div className="notepad-segmented notepad-export-dialog__scope-tabs">
              <button
                className={`notepad-segmented__btn${scope === 'all' ? ' notepad-segmented__btn--active' : ''}`}
                onClick={() => setScope('all')}
              >
                All notes ({notes.length})
              </button>
              {noteId && (
                <button
                  className={`notepad-segmented__btn${scope === 'note' ? ' notepad-segmented__btn--active' : ''}`}
                  onClick={() => setScope('note')}
                >
                  Selected (1)
                </button>
              )}
            </div>
          </div>

          {/* YAML frontmatter toggle */}
          <div className="notepad-export-dialog__toggle-row">
            <span>
              Include YAML frontmatter{' '}
              <span className="notepad-export-dialog__toggle-desc">(id, title, tags, dates)</span>
            </span>
            <button
              className={`notepad-toggle${includeFrontmatter ? ' notepad-toggle--on' : ''}`}
              onClick={() => setIncludeFrontmatter((v) => !v)}
              role="switch"
              aria-checked={includeFrontmatter}
              aria-label="Include YAML frontmatter"
            />
          </div>

          {/* Export comments format */}
          <div className="notepad-export-dialog__toggle-row">
            <span>Export comments</span>
            <div className="notepad-segmented">
              {(['sidecar', 'inline', 'both'] as CommentFormat[]).map((f) => (
                <button
                  key={f}
                  className={`notepad-segmented__btn${commentFormat === f ? ' notepad-segmented__btn--active' : ''}`}
                  onClick={() => setCommentFormat(f)}
                >
                  {commentFormatLabels[f]}
                </button>
              ))}
            </div>
          </div>

          {/* Overwrite toggle */}
          <div className="notepad-export-dialog__toggle-row">
            <span>
              Overwrite existing by id{' '}
              <span className="notepad-export-dialog__toggle-desc">(idempotent re-export)</span>
            </span>
            <button
              className={`notepad-toggle${overwriteById ? ' notepad-toggle--on' : ''}`}
              onClick={() => setOverwriteById((v) => !v)}
              role="switch"
              aria-checked={overwriteById}
              aria-label="Overwrite existing by id"
            />
          </div>

          {/* Preview box */}
          {previewNote && (
            <div className="notepad-export-dialog__preview">
              <div className="notepad-export-dialog__preview-line notepad-export-dialog__preview-filename">
                {previewSlug(previewNote.title, previewNote.id)}
              </div>
              <div className="notepad-export-dialog__preview-line">---</div>
              {includeFrontmatter && (
                <div className="notepad-export-dialog__preview-line">
                  id: {previewNote.id.slice(0, 8)}… · title: {previewNote.title} · tags: [
                  {previewNote.tags.join(', ')}]
                </div>
              )}
              <div className="notepad-export-dialog__preview-line">---</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="notepad-export-dialog__footer">
          <span className="notepad-export-dialog__footer-meta">
            {exportResult
              ? `Last export: ${exportResult.time} → ${exportResult.count} files`
              : `${scopeCount} ${scopeCount === 1 ? 'note' : 'notes'} will be exported`}
          </span>
          <button className="notepad-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="notepad-btn-primary"
            onClick={() => void handleExport()}
            disabled={!folder || running}
            aria-label="Export"
          >
            {running ? 'Exporting…' : `Export ${scopeCount} ${scopeCount === 1 ? 'note' : 'notes'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
