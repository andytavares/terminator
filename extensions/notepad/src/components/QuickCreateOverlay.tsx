import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'
import { NoteEditor } from '../editor/NoteEditor'
import type { DiagramListItem } from '../db/types'

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

interface TagChipBarProps {
  tags: string[]
  tagInput: string
  tagInputRef: React.RefObject<HTMLInputElement>
  onTagInput: (val: string) => void
  onAddTag: (val: string) => void
  onRemoveTag: (tag: string) => void
  onTagKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

function TagChipBar({
  tags,
  tagInput,
  tagInputRef,
  onTagInput,
  onAddTag,
  onRemoveTag,
  onTagKeyDown,
}: TagChipBarProps): React.JSX.Element {
  return (
    <div className="notepad-quick-create__tags">
      {tags.map((tag) => (
        <span key={tag} className="notepad-tag-chip-input__chip">
          {tag}
          <button
            type="button"
            className="notepad-tag-chip-input__remove"
            onClick={() => onRemoveTag(tag)}
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
        onChange={(e) => onTagInput(e.target.value)}
        onKeyDown={onTagKeyDown}
        onBlur={() => {
          if (tagInput.trim()) onAddTag(tagInput)
        }}
      />
    </div>
  )
}

export function QuickCreateOverlay(): React.JSX.Element | null {
  const { showQuickCreate, setShowQuickCreate, setNotes, setDiagrams, setFolders } = useNotesStore()
  const [type, setType] = useState<'note' | 'diagram' | 'folder'>('note')
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
    setType('note')
    setShowQuickCreate(false)
  }, [setShowQuickCreate])

  const handleSaveFolder = useCallback(async () => {
    if (saving) return
    const folderName = title.trim()
    if (!folderName) return
    setSaving(true)
    try {
      await window.electronAPI.extensionBridge.invoke('terminator.notepad:folders.create', {
        name: folderName,
      })
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:folders.list',
        {}
      )
      const data = (result as { data?: unknown[] }).data
      if (Array.isArray(data)) setFolders(data as Parameters<typeof setFolders>[0])
      close()
    } catch (err) {
      console.error('[notepad] QuickCreateOverlay: save folder failed', err)
      setSaving(false)
    }
  }, [title, saving, close, setFolders])

  useEffect(() => {
    if (!showQuickCreate) return
    const t = setTimeout(() => titleRef.current?.focus(), 50)
    // Load default tags from settings (notes only)
    window.electronAPI.extension
      .getSettingsValues()
      .then((result) => {
        const values = (result as { values: Record<string, unknown> }).values
        const raw = values['terminator.notepad.defaultTags']
        if (typeof raw === 'string' && raw.trim()) {
          const defaults = raw
            .split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean)
          if (defaults.length > 0) setTags(defaults)
        }
      })
      .catch(() => {
        /* ignore */
      })
    return () => clearTimeout(t)
  }, [showQuickCreate])

  const handleSaveNote = useCallback(async () => {
    if (saving) return
    setSaving(true)
    // Flush any uncommitted tag from the input field (onBlur fires before onClick
    // but React 18 batching means the setTags update may not have applied yet)
    const pendingTag = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    const finalTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags
    const resolvedTitle = title.trim() || deriveTitle(body)
    try {
      await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.create', {
        title: resolvedTitle,
        body,
        tags: finalTags,
      })
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:notes.list',
        { includeArchived: true }
      )
      const data = (result as { data?: unknown[] }).data
      if (Array.isArray(data)) setNotes(data as Parameters<typeof setNotes>[0])
      close()
    } catch (err) {
      console.error('[notepad] QuickCreateOverlay: save note failed', err)
      setSaving(false)
    }
  }, [title, body, tags, tagInput, saving, close, setNotes])

  const handleSaveDiagram = useCallback(async () => {
    if (saving) return
    setSaving(true)
    const pendingTag = tagInput.trim().toLowerCase().replace(/\s+/g, '-')
    const finalTags = pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags
    const resolvedTitle = title.trim() || 'Untitled diagram'
    try {
      const createResult = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagrams.create',
        { title: resolvedTitle, tags: finalTags }
      )
      const created = (createResult as { data?: { id: string } }).data
      const listResult = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagrams.list',
        { includeArchived: true }
      )
      const data = (listResult as { data?: DiagramListItem[] }).data
      if (Array.isArray(data)) {
        setDiagrams(data)
        if (created?.id) useNotesStore.getState().setSelectedDiagram(created.id)
      }
      close()
    } catch (err) {
      console.error('[notepad] QuickCreateOverlay: save diagram failed', err)
      setSaving(false)
    }
  }, [title, tags, tagInput, saving, close, setDiagrams])

  const handleSave = useCallback(() => {
    if (type === 'diagram') return handleSaveDiagram()
    if (type === 'folder') return handleSaveFolder()
    return handleSaveNote()
  }, [type, handleSaveNote, handleSaveDiagram, handleSaveFolder])

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
      <div
        className="notepad-quick-create"
        role="dialog"
        aria-modal="true"
        aria-label={type === 'folder' ? 'New folder' : `New ${type}`}
      >
        <div className="notepad-quick-create__header">
          <div className="notepad-quick-create__type-tabs">
            <button
              className={`notepad-quick-create__type-tab${type === 'note' ? ' notepad-quick-create__type-tab--active' : ''}`}
              onClick={() => setType('note')}
            >
              Note
            </button>
            <button
              className={`notepad-quick-create__type-tab${type === 'diagram' ? ' notepad-quick-create__type-tab--active' : ''}`}
              onClick={() => setType('diagram')}
            >
              Diagram
            </button>
            <button
              className={`notepad-quick-create__type-tab${type === 'folder' ? ' notepad-quick-create__type-tab--active' : ''}`}
              onClick={() => setType('folder')}
            >
              Folder
            </button>
          </div>
          {type === 'note' && (
            <span className="notepad-quick-create__vault-status">
              saved to vault · exports as <code>{exportFilename}</code>
            </span>
          )}
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
        {type === 'note' && (
          <div className="notepad-quick-create__body">
            <NoteEditor
              key={showQuickCreate ? 'open' : 'closed'}
              initialDoc=""
              onChange={setBody}
            />
          </div>
        )}
        <div className="notepad-quick-create__footer">
          {type !== 'folder' && (
            <TagChipBar
              tags={tags}
              tagInput={tagInput}
              tagInputRef={tagInputRef}
              onTagInput={setTagInput}
              onAddTag={addTag}
              onRemoveTag={removeTag}
              onTagKeyDown={handleTagKeyDown}
            />
          )}
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
