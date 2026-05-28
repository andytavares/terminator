import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X, Eye, Pencil } from 'lucide-react'
import { renderMarkdown } from '../utils/markdown'

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

const SECTIONS: Section[] = [
  {
    key: 'description',
    label: 'Description',
    placeholder: 'What does this task involve? Markdown supported.',
  },
  {
    key: 'acceptanceCriteria',
    label: 'Acceptance Criteria',
    placeholder: '- [ ] Criterion one\n- [ ] Criterion two',
  },
  {
    key: 'devHints',
    label: 'Dev Hints',
    placeholder: 'Implementation notes, links, gotchas… Markdown supported.',
  },
]

interface SectionEditorProps {
  label: string
  value: string
  placeholder: string
  onSave: (val: string) => Promise<void>
}

function SectionEditor({ label, value, placeholder, onSave }: SectionEditorProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.setSelectionRange(draft.length, draft.length)
    }
  }, [editing])

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      void handleSave()
    }
  }

  return (
    <div className="tv-detail__section">
      <div className="tv-detail__section-header">
        <span className="tv-detail__section-label">{label}</span>
        <button
          className="tv-btn tv-btn--icon"
          onClick={() => {
            if (editing) {
              void handleSave()
            } else {
              setEditing(true)
            }
          }}
          title={editing ? 'Preview' : 'Edit'}
          disabled={saving}
        >
          {editing ? <Eye size={13} /> : <Pencil size={13} />}
        </button>
      </div>

      {editing ? (
        <div className="tv-detail__editor">
          <textarea
            ref={textareaRef}
            className="tv-detail__textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={6}
          />
          <div className="tv-detail__editor-actions">
            <button
              className="tv-btn tv-btn--primary tv-btn--xs"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? '…' : 'Save'}
            </button>
            <button
              className="tv-btn tv-btn--ghost tv-btn--xs"
              onClick={() => {
                setDraft(value)
                setEditing(false)
              }}
            >
              Cancel
            </button>
            <span className="tv-detail__editor-hint">⌘↵ to save · Esc to cancel</span>
          </div>
        </div>
      ) : (
        <div
          className={`tv-detail__preview${!value.trim() ? ' tv-detail__preview--empty' : ''}`}
          onClick={(e) => {
            const anchor = (e.target as HTMLElement).closest('a')
            if (anchor?.href) {
              e.preventDefault()
              e.stopPropagation()
              window.electronAPI.shell.openExternal(anchor.href).catch(() => {})
              return
            }
            setEditing(true)
          }}
          title="Click to edit"
        >
          {value.trim() ? (
            <div
              className="tv-detail__markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }}
            />
          ) : (
            <span className="tv-detail__empty-hint">{placeholder.split('\n')[0]}</span>
          )}
        </div>
      )}
    </div>
  )
}

interface TaskDetailPanelProps {
  taskId: string
  taskText: string
  onClose: () => void
}

export function TaskDetailPanel({ taskId, taskText, onClose }: TaskDetailPanelProps) {
  const [detail, setDetail] = useState<TaskDetail>({
    description: '',
    acceptanceCriteria: '',
    devHints: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'task-vault:vault:get-task-detail',
        { taskId }
      )
      if (result && typeof result === 'object' && 'error' in result) {
        setError((result as { error: string }).error)
      } else if (result && typeof result === 'object') {
        const r = result as { description: string; acceptanceCriteria: string; devHints: string }
        setDetail({
          description: r.description ?? '',
          acceptanceCriteria: r.acceptanceCriteria ?? '',
          devHints: r.devHints ?? '',
        })
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void loadDetail()
  }, [loadDetail])

  async function handleSaveField(field: keyof TaskDetail, value: string) {
    const updated = { ...detail, [field]: value }
    setDetail(updated)
    await window.electronAPI.extensionBridge.invoke('task-vault:vault:save-task-detail', {
      taskId,
      description: updated.description,
      acceptanceCriteria: updated.acceptanceCriteria,
      devHints: updated.devHints,
    })
  }

  return (
    <div className="tv-detail-panel">
      <div className="tv-detail-panel__header">
        <span className="tv-detail-panel__title" title={taskText}>
          {taskText}
        </span>
        <button className="tv-btn tv-btn--icon" onClick={onClose} title="Close detail panel">
          <X size={14} />
        </button>
      </div>

      <div className="tv-detail-panel__body">
        {loading && <div className="tv-detail-panel__loading">Loading…</div>}
        {error && <div className="tv-detail-panel__error">{error}</div>}
        {!loading && !error && (
          <>
            {SECTIONS.map((s) => (
              <SectionEditor
                key={s.key}
                label={s.label}
                value={detail[s.key]}
                placeholder={s.placeholder}
                onSave={(val) => handleSaveField(s.key, val)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
