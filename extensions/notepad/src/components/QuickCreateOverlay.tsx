import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'
import { NoteEditor } from '../editor/NoteEditor'

function toFilenameSlug(title: string): string {
  return (
    (title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'new-note') + '.md'
  )
}

function deriveTitle(body: string): string {
  const headingMatch = /^#{1,6}\s+(.+)/m.exec(body)
  if (headingMatch) return headingMatch[1].trim()
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)
  if (firstLine) return firstLine.trim().slice(0, 120)
  return 'Untitled note'
}

export function QuickCreateOverlay(): React.JSX.Element | null {
  const { showQuickCreate, setShowQuickCreate, setNotes } = useNotesStore()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)

  const exportFilename = toFilenameSlug(title)

  const close = useCallback(() => {
    setTitle('')
    setBody('')
    setTags([])
    setTagInput('')
    setSaving(false)
    setShowQuickCreate(false)
  }, [setShowQuickCreate])

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
        { includeArchived: true }
      )
      const data = (result as { data?: unknown[] }).data
      if (Array.isArray(data)) setNotes(data as Parameters<typeof setNotes>[0])
      close()
    } catch (err) {
      console.error('[notepad] QuickCreateOverlay: save failed', err)
      setSaving(false)
    }
  }, [title, body, tags, saving, close, setNotes])

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

  function addTag(raw: string) {
    const trimmed = raw.trim().toLowerCase().replace(/\s+/g, '-')
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed])
    }
    setTagInput('')
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1))
    }
  }

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
          <span className="notepad-quick-create__heading">New note</span>
          <span className="notepad-quick-create__vault-status">
            saved to vault · exports as <code>{exportFilename}</code>
          </span>
        </div>
        <div className="notepad-quick-create__divider" />
        <input
          ref={titleRef}
          className="notepad-quick-create__title-input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="notepad-quick-create__divider" />
        <div className="notepad-quick-create__body">
          <NoteEditor key={showQuickCreate ? 'open' : 'closed'} initialDoc="" onChange={setBody} />
        </div>
        <div className="notepad-quick-create__footer">
          <div className="notepad-quick-create__tags">
            {tags.map((tag) => (
              <span key={tag} className="notepad-tag-chip-input__chip">
                {tag}
                <button
                  type="button"
                  className="notepad-tag-chip-input__remove"
                  onClick={() => removeTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              ref={tagInputRef}
              className="notepad-quick-create__tag-input"
              placeholder="# add tag…"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => {
                if (tagInput.trim()) addTag(tagInput)
              }}
            />
          </div>
          <div className="notepad-quick-create__footer-actions">
            <button className="notepad-quick-create__cancel-link" onClick={close} disabled={saving}>
              cancel <kbd className="notepad-kbd notepad-kbd--inline">Esc</kbd>
            </button>
            <button
              className="notepad-btn-primary"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? (
                'Saving…'
              ) : (
                <>
                  Save <kbd className="notepad-kbd notepad-kbd--inline">⌘↵</kbd>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
