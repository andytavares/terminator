import React, { useEffect, useRef, useState } from 'react'
import { X, Eye, Pencil } from 'lucide-react'
import { Button, IconButton, Markdown } from '@terminator/extension-ui'
import { openInBrowser } from '@terminator/extension-sdk/renderer'

interface TaskDetail {
  description: string
  acceptanceCriteria: string
  devHints: string
}

interface Section {
  key: keyof TaskDetail
  label: string
  placeholder: string
}

interface SectionEditorProps {
  label: string
  value: string
  placeholder: string
  onSave: (val: string) => Promise<void>
}

type Draft = ReturnType<typeof useSectionDraft>

interface EditorProps {
  d: Draft
  placeholder: string
}

interface PreviewProps {
  value: string
  placeholder: string
  onEdit: () => void
}

interface TaskDetailPanelProps {
  taskId: string
  taskText: string
  onClose: () => void
}

type TaskDetailOutcome = { detail: TaskDetail } | { error: string } | Record<string, never>

const SECTIONS: Section[] = [
  {
    key: 'description',
    label: 'Description',
    placeholder: 'What does this task involve? Markdown supported.',
  },
  {
    key: 'acceptanceCriteria',
    label: 'Acceptance criteria',
    placeholder: '- [ ] Criterion one\n- [ ] Criterion two',
  },
  {
    key: 'devHints',
    label: 'Dev hints',
    placeholder: 'Implementation notes, links, gotchas… Markdown supported.',
  },
]

/** A section's draft, whether it is being edited, and its save, reset when the value changes. */
function useSectionDraft(value: string, onSave: (val: string) => Promise<void>) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [draftSource, setDraftSource] = useState(value)
  if (draftSource !== value) {
    setDraftSource(value)
    setDraft(value)
    setEditing(false)
  }

  async function save() {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function cancel() {
    setDraft(value)
    setEditing(false)
  }

  return { editing, setEditing, draft, setDraft, saving, save, cancel }
}

/** Moves focus into the textarea, caret at the end, when editing starts. */
function useFocusAtEnd(textareaRef: React.RefObject<HTMLTextAreaElement | null>, d: Draft) {
  useEffect(() => {
    if (d.editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(d.draft.length, d.draft.length)
    }
  }, [d.editing]) // eslint-disable-line react-hooks/exhaustive-deps
}

function SectionTextEditor({ d, placeholder }: EditorProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  useFocusAtEnd(textareaRef, d)
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') d.cancel()
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void d.save()
  }
  return (
    <div className="tv-detail__editor">
      <textarea
        ref={textareaRef}
        className="tv-detail__textarea"
        value={d.draft}
        onChange={(e) => d.setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={6}
      />
      <div className="tv-detail__editor-actions">
        <Button variant="primary" size="sm" onClick={() => void d.save()} disabled={d.saving}>
          {d.saving ? '…' : 'Save'}
        </Button>
        <Button variant="ghost" size="sm" onClick={d.cancel}>
          Cancel
        </Button>
        <span className="tv-detail__editor-hint">⌘↵ to save · Esc to cancel</span>
      </div>
    </div>
  )
}

/** The rendered section; clicking it edits, except on a link, which opens itself. */
function SectionPreview({ value, placeholder, onEdit }: PreviewProps): React.JSX.Element {
  const empty = !value.trim()
  return (
    <div
      className={`tv-detail__preview${empty ? ' tv-detail__preview--empty' : ''}`}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return
        onEdit()
      }}
      title="Click to edit"
    >
      {empty ? (
        <span className="tv-detail__empty-hint">{placeholder.split('\n')[0]}</span>
      ) : (
        <Markdown fetchesNothing className="tv-detail__markdown" onOpenLink={openInBrowser}>
          {value}
        </Markdown>
      )}
    </div>
  )
}

function SectionEditor(props: SectionEditorProps) {
  const { label, value, placeholder, onSave } = props
  const d = useSectionDraft(value, onSave)
  const toggleSectionEdit = () => (d.editing ? void d.save() : d.setEditing(true))
  return (
    <div className="tv-detail__section">
      <div className="tv-detail__section-header">
        <span className="tv-detail__section-label">{label}</span>
        <IconButton
          icon={d.editing ? Eye : Pencil}
          label={d.editing ? 'Preview' : 'Edit'}
          size="sm"
          onClick={toggleSectionEdit}
          disabled={d.saving}
        />
      </div>
      {d.editing ? (
        <SectionTextEditor d={d} placeholder={placeholder} />
      ) : (
        <SectionPreview value={value} placeholder={placeholder} onEdit={() => d.setEditing(true)} />
      )}
    </div>
  )
}

function toDetail(r: Partial<TaskDetail>): TaskDetail {
  return {
    description: r.description ?? '',
    acceptanceCriteria: r.acceptanceCriteria ?? '',
    devHints: r.devHints ?? '',
  }
}

async function fetchTaskDetail(taskId: string): Promise<TaskDetailOutcome> {
  try {
    const result = await window.electronAPI.extensionBridge.invoke(
      'task-vault:vault:get-task-detail',
      { taskId }
    )
    if (!result || typeof result !== 'object') return {}
    if ('error' in result) return { error: (result as { error: string }).error }
    return { detail: toDetail(result as Partial<TaskDetail>) }
  } catch (err) {
    return { error: String(err) }
  }
}

const EMPTY_DETAIL: TaskDetail = { description: '', acceptanceCriteria: '', devHints: '' }

/** The task's detail, loaded per task id, and the save that writes all fields back. */
function useTaskDetail(taskId: string) {
  const [detail, setDetail] = useState<TaskDetail>(EMPTY_DETAIL)
  const [loaded, setLoaded] = useState<{ taskId: string; error: string | null } | null>(null)
  const loading = loaded?.taskId !== taskId
  const error = loaded && !loading ? loaded.error : null

  useEffect(() => {
    let current = true
    void fetchTaskDetail(taskId).then((outcome) => {
      if (!current) return
      if ('detail' in outcome) setDetail(outcome.detail)
      setLoaded({ taskId, error: 'error' in outcome ? outcome.error : null })
    })
    return () => {
      current = false
    }
  }, [taskId])

  async function saveField(field: keyof TaskDetail, value: string) {
    const updated = { ...detail, [field]: value }
    setDetail(updated)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:save-task-detail', {
      taskId,
      ...updated,
    })
  }

  return { detail, loading, error, saveField: saveField }
}

export function TaskDetailPanel({ taskId, taskText, onClose }: TaskDetailPanelProps) {
  const { detail, loading, error, saveField } = useTaskDetail(taskId)
  return (
    <div className="tv-detail-panel">
      <div className="tv-detail-panel__header">
        <span className="tv-detail-panel__title" title={taskText}>
          {taskText}
        </span>
        <IconButton icon={X} label="Close detail panel" size="sm" onClick={onClose} />
      </div>
      <div className="tv-detail-panel__body">
        {loading && <div className="tv-detail-panel__loading">Loading…</div>}
        {error && <div className="tv-detail-panel__error">{error}</div>}
        {!loading &&
          !error &&
          SECTIONS.map((s) => (
            <SectionEditor
              key={s.key}
              label={s.label}
              value={detail[s.key]}
              placeholder={s.placeholder}
              onSave={(val) => saveField(s.key, val)}
            />
          ))}
      </div>
    </div>
  )
}
