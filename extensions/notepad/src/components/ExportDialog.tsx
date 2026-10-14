import React, { useState, useCallback, useEffect } from 'react'
import { Button, Dialog } from '@terminator/extension-ui'
import { useNotesStore } from '../stores/notes.store'
import type { NoteListItem } from '../db/types'

type ExportScope = 'all' | 'note'
type CommentFormat = 'sidecar' | 'inline' | 'both'

/** What the dialog exports, and how. */
interface ExportOptions {
  folder: string
  scope: ExportScope
  includeFrontmatter: boolean
  commentFormat: CommentFormat
  overwriteById: boolean
  includeDiagrams: boolean
}

interface ExportResult {
  notes: number
  diagrams: number
  time: string
}

type OptionsUpdate = (patch: Partial<ExportOptions>) => void

interface ExportDialogProps {
  onClose: () => void
  noteId?: string
}

interface OptionFieldProps {
  options: ExportOptions
  update: OptionsUpdate
}

interface ToggleRowProps {
  label: string
  description: string
  checked: boolean
  onToggle: () => void
}

const DEFAULT_OPTIONS: ExportOptions = {
  folder: '~/Documents/Terminator Notes',
  scope: 'all',
  includeFrontmatter: true,
  commentFormat: 'sidecar',
  overwriteById: true,
  includeDiagrams: true,
}

const COMMENT_FORMAT_LABELS: Record<CommentFormat, string> = {
  sidecar: 'Sidecar JSON',
  inline: 'Inline HTML',
  both: 'Both',
}

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

const COMMENT_FORMATS: readonly CommentFormat[] = ['sidecar', 'inline', 'both']

/** The export folder and comment format Notepad's settings choose, where they choose one. */
function settingsDefaults(values: Record<string, unknown>): Partial<ExportOptions> {
  const folder = values['terminator.notepad.exportPath']
  const format = values['terminator.notepad.commentExportFormat'] as CommentFormat
  return {
    ...(typeof folder === 'string' && folder.trim() ? { folder } : {}),
    ...(COMMENT_FORMATS.includes(format) ? { commentFormat: format } : {}),
  }
}

/** Starts the options on the export folder and comment format set in Notepad's settings, once read. */
function useExportSettings(setOptions: React.Dispatch<React.SetStateAction<ExportOptions>>): void {
  useEffect(() => {
    void window.electronAPI.extension
      .getSettingsValues()
      .then(({ values }) =>
        setOptions((previous) => ({ ...previous, ...settingsDefaults(values) }))
      )
      .catch(() => {})
  }, [setOptions])
}

function segmentClass(active: boolean): string {
  return `notepad-segmented__btn${active ? ' notepad-segmented__btn--active' : ''}`
}

function noteCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'note' : 'notes'}`
}

/** How many notes and diagrams the chosen scope exports. */
function useExportCounts(options: ExportOptions) {
  const { notes, diagrams } = useNotesStore()
  const scopeCount = options.scope === 'all' ? notes.filter((n) => !n.archivedAt).length : 1
  const exportsDiagrams = options.scope === 'all' && options.includeDiagrams
  const diagramCount = exportsDiagrams ? diagrams.filter((d) => !d.archivedAt).length : 0
  return { scopeCount, diagramCount }
}

export function ExportDialog({ onClose, noteId }: ExportDialogProps): React.JSX.Element {
  const { notes } = useNotesStore()
  const previewNote = noteId ? notes.find((n) => n.id === noteId) : notes[0]
  const [options, setOptions] = useState<ExportOptions>(DEFAULT_OPTIONS)
  const updateOptions: OptionsUpdate = (patch) =>
    setOptions((previous) => ({ ...previous, ...patch }))
  useExportSettings(setOptions)
  const { running, exportResult, handleExport } = useExportRun(options, noteId)

  const { scopeCount, diagramCount } = useExportCounts(options)
  const exportLabel = running ? 'Exporting…' : `Export ${noteCountLabel(scopeCount)}`

  return (
    <Dialog
      title="Export to markdown"
      onDismiss={onClose}
      actions={[
        { label: 'Cancel', onSelect: onClose },
        { label: exportLabel, tone: 'primary', onSelect: () => void handleExport() },
      ]}
    >
      <div className="notepad-export-dialog__body">
        <ExportOptionFields options={options} update={updateOptions} noteId={noteId} />
        {previewNote && <ExportPreview note={previewNote} options={options} />}
      </div>
      <p className="notepad-export-dialog__footer-meta">
        {exportResult ? lastExportText(exportResult) : pendingExportText(scopeCount, diagramCount)}
      </p>
    </Dialog>
  )
}

function lastExportText(result: ExportResult): string {
  const diagramsText = result.diagrams > 0 ? `, ${result.diagrams} diagrams` : ''
  return `Last export: ${result.time} → ${result.notes} notes${diagramsText}`
}

function pendingExportText(scopeCount: number, diagramCount: number): string {
  const diagramsText = diagramCount > 0 ? ` + ${diagramCount} diagrams` : ''
  return `${noteCountLabel(scopeCount)}${diagramsText} will be exported`
}

/** Running the export with the chosen options, and what it reported last. */
function useExportRun(options: ExportOptions, noteId: string | undefined) {
  const [running, setRunning] = useState(false)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)

  const handleExport = useCallback(async () => {
    if (!options.folder || running) return
    if (options.scope === 'note' && !noteId) return
    setRunning(true)
    try {
      setExportResult(await runExport(options, noteId))
    } finally {
      setRunning(false)
    }
  }, [options, noteId, running])

  return { running, exportResult, handleExport }
}

async function runExport(
  options: ExportOptions,
  noteId: string | undefined
): Promise<ExportResult> {
  const { scope } = options
  const result = await window.electronAPI.extensionBridge.invoke('terminator.notepad:export.run', {
    folder: options.folder,
    scope,
    ...(scope === 'note' && noteId ? { noteId } : {}),
    includeFrontmatter: options.includeFrontmatter,
    commentFormat: options.commentFormat,
    overwriteById: options.overwriteById,
    includeDiagrams: scope === 'all' ? options.includeDiagrams : false,
  })
  const data = (result as { data?: { exported: number; diagrams: number } }).data
  return { notes: data?.exported ?? 0, diagrams: data?.diagrams ?? 0, time: exportTime(new Date()) }
}

function exportTime(now: Date): string {
  const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${day}, ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`
}

function ExportOptionFields(props: OptionFieldProps & { noteId?: string }): React.JSX.Element {
  const { options, update } = props
  return (
    <>
      <FolderField options={options} update={update} />
      <ScopeField options={options} update={update} noteId={props.noteId} />
      <ExportToggles options={options} update={update} />
    </>
  )
}

function ExportToggles({ options, update }: OptionFieldProps): React.JSX.Element {
  return (
    <>
      {options.scope === 'all' && (
        <ToggleRow
          label="Include diagrams"
          description="(saved as .excalidraw files in diagrams/)"
          checked={options.includeDiagrams}
          onToggle={() => update({ includeDiagrams: !options.includeDiagrams })}
        />
      )}
      <ToggleRow
        label="Include YAML frontmatter"
        description="(id, title, tags, dates)"
        checked={options.includeFrontmatter}
        onToggle={() => update({ includeFrontmatter: !options.includeFrontmatter })}
      />
      <CommentFormatField options={options} update={update} />
      <ToggleRow
        label="Overwrite existing by id"
        description="(idempotent re-export)"
        checked={options.overwriteById}
        onToggle={() => update({ overwriteById: !options.overwriteById })}
      />
    </>
  )
}

function FolderField({ options, update }: OptionFieldProps): React.JSX.Element {
  const pickFolder = async () => {
    const result = await window.electronAPI.extensionBridge.invoke(
      'terminator.notepad:export.pickFolder',
      {}
    )
    const data = (result as { data: string | null }).data
    if (data) update({ folder: data })
  }
  return (
    <div className="notepad-export-dialog__field">
      <div className="notepad-export-dialog__field-label">Destination folder</div>
      <div className="notepad-export-dialog__folder-row">
        <input
          className="tmui-input notepad-export-dialog__folder-input"
          value={options.folder}
          onChange={(e) => update({ folder: e.target.value })}
          spellCheck={false}
          aria-label="Destination folder"
        />
        <Button onClick={() => void pickFolder()} aria-label="Choose folder">
          Choose…
        </Button>
      </div>
    </div>
  )
}

function ScopeField(props: OptionFieldProps & { noteId?: string }): React.JSX.Element {
  const { options, update, noteId } = props
  const { notes } = useNotesStore()
  return (
    <div className="notepad-export-dialog__field">
      <div className="notepad-export-dialog__field-label">Scope</div>
      <div className="notepad-segmented notepad-export-dialog__scope-tabs">
        <button
          className={segmentClass(options.scope === 'all')}
          onClick={() => update({ scope: 'all' })}
        >
          All notes ({notes.filter((n) => !n.archivedAt).length})
        </button>
        {noteId && (
          <button
            className={segmentClass(options.scope === 'note')}
            onClick={() => update({ scope: 'note' })}
          >
            Selected (1)
          </button>
        )}
      </div>
    </div>
  )
}

function ToggleRow(props: ToggleRowProps): React.JSX.Element {
  const { label, description, checked, onToggle } = props
  return (
    <div className="notepad-export-dialog__toggle-row">
      <span>
        {label} <span className="notepad-export-dialog__toggle-desc">{description}</span>
      </span>
      <button
        className={`notepad-toggle${checked ? ' notepad-toggle--on' : ''}`}
        onClick={onToggle}
        role="switch"
        aria-checked={checked}
        aria-label={label}
      />
    </div>
  )
}

function CommentFormatField({ options, update }: OptionFieldProps): React.JSX.Element {
  return (
    <div className="notepad-export-dialog__toggle-row">
      <span>Export comments</span>
      <div className="notepad-segmented">
        {(['sidecar', 'inline', 'both'] as CommentFormat[]).map((f) => (
          <button
            key={f}
            className={segmentClass(options.commentFormat === f)}
            onClick={() => update({ commentFormat: f })}
          >
            {COMMENT_FORMAT_LABELS[f]}
          </button>
        ))}
      </div>
    </div>
  )
}

function ExportPreview(props: { note: NoteListItem; options: ExportOptions }): React.JSX.Element {
  const { note, options } = props
  return (
    <div className="notepad-export-dialog__preview">
      <div className="notepad-export-dialog__preview-line notepad-export-dialog__preview-filename">
        {previewSlug(note.title, note.id)}
      </div>
      <div className="notepad-export-dialog__preview-line">---</div>
      {options.includeFrontmatter && (
        <div className="notepad-export-dialog__preview-line">
          id: {note.id.slice(0, 8)}… · title: {note.title} · tags: [{note.tags.join(', ')}]
        </div>
      )}
      <div className="notepad-export-dialog__preview-line">---</div>
    </div>
  )
}
