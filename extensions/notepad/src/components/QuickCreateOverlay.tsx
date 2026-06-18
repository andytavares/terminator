import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'

function deriveTitle(body: string): string {
  const headingMatch = /^#{1,6}\s+(.+)/m.exec(body)
  if (headingMatch) return headingMatch[1].trim()
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)
  if (firstLine) return firstLine.trim().slice(0, 120)
  return 'Untitled note'
}

function TagChipInput({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}): React.JSX.Element {
  const [inputVal, setInputVal] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addTag(raw: string) {
    const trimmed = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setInputVal('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputVal)
    } else if (e.key === 'Backspace' && inputVal === '' && tags.length > 0) {
      onChange(tags.slice(0, -1))
    }
  }

  function removeTag(tag: string) {
    onChange(tags.filter((t) => t !== tag))
  }

  return (
    <div className="notepad-tag-chip-input" onClick={() => inputRef.current?.focus()}>
      {tags.map((tag) => (
        <span key={tag} className="notepad-tag-chip-input__chip">
          {tag}
          <button
            type="button"
            className="notepad-tag-chip-input__remove"
            onClick={(e) => {
              e.stopPropagation()
              removeTag(tag)
            }}
            aria-label={`Remove tag ${tag}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        className="notepad-tag-chip-input__field"
        placeholder={tags.length === 0 ? 'Add tags…' : ''}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (inputVal.trim()) addTag(inputVal)
        }}
      />
    </div>
  )
}

export function QuickCreateOverlay(): React.JSX.Element | null {
  const { showQuickCreate, setShowQuickCreate, setNotes } = useNotesStore()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => {
    setTitle('')
    setBody('')
    setTags([])
    setSaving(false)
    setShowQuickCreate(false)
  }, [setShowQuickCreate])

  // Focus title input once when overlay opens — NOT in the keyboard effect
  useEffect(() => {
    if (!showQuickCreate) return
    const t = setTimeout(() => titleRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [showQuickCreate])

  const handleSave = useCallback(async () => {
    if (saving) return
    setSaving(true)
    const resolvedTitle = title.trim() || deriveTitle(body)
    try {
      await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.create', {
        title: resolvedTitle,
        body,
        tags,
      })
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:notes.list',
        {}
      )
      const data = (result as { data?: unknown[] }).data
      if (Array.isArray(data)) setNotes(data as Parameters<typeof setNotes>[0])
      close()
    } catch (err) {
      console.error('[notepad] QuickCreateOverlay: save failed', err)
      setSaving(false)
    }
  }, [title, body, tags, saving, close, setNotes])

  // Keyboard shortcuts — separate from focus effect so they don't interfere
  useEffect(() => {
    if (!showQuickCreate) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleSave()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showQuickCreate, close, handleSave])

  if (!showQuickCreate) return null

  return (
    <div
      className="notepad-overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="notepad-quick-create" role="dialog" aria-modal="true" aria-label="New note">
        <div className="notepad-quick-create__header">
          <span className="notepad-quick-create__heading">New Note</span>
          <button className="notepad-btn-icon" onClick={close} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="notepad-quick-create__body">
          <input
            ref={titleRef}
            className="notepad-input"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="notepad-textarea"
            placeholder="Start writing your note…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
          />
          <TagChipInput tags={tags} onChange={setTags} />
        </div>
        <div className="notepad-quick-create__footer">
          <span className="notepad-quick-create__hint">⌘↵ to save · Esc to cancel</span>
          <button className="notepad-btn-ghost" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            className="notepad-btn-primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
