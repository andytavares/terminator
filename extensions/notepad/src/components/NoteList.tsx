import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'
import { useFilterStore } from '../stores/filter.store'
import { EmptyState } from './EmptyState'
import type { NoteListItem, SearchResult, Tag } from '../db/types'

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

// ── Context menu ──────────────────────────────────────────────────

interface ContextMenuState {
  noteId: string
  title: string
  tags: string[]
  x: number
  y: number
}

interface EditModalState {
  noteId: string
  title: string
  tags: string[]
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
              onChange(tags.filter((t) => t !== tag))
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

function NoteEditModal({
  state,
  onClose,
  onSaved,
}: {
  state: EditModalState
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(state.title)
  const [tags, setTags] = useState(state.tags)
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      // Fetch current body so autosave doesn't clobber it
      const noteResult = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:notes.get',
        { id: state.noteId }
      )
      const body = (noteResult as { data?: { body: string } }).data?.body ?? ''
      await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.autosave', {
        id: state.noteId,
        title: title.trim() || 'Untitled note',
        body,
        tags,
      })
      onSaved()
      onClose()
    } catch (err) {
      console.error('[notepad] edit note failed', err)
      setSaving(false)
    }
  }

  return (
    <div
      className="notepad-overlay-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="notepad-quick-create" role="dialog" aria-modal="true" aria-label="Edit note">
        <div className="notepad-quick-create__header">
          <span className="notepad-quick-create__heading">Edit Note</span>
          <button className="notepad-btn-icon" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="notepad-quick-create__body">
          <input
            ref={titleRef}
            className="notepad-input"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TagChipInput tags={tags} onChange={setTags} />
        </div>
        <div className="notepad-quick-create__footer">
          <span className="notepad-quick-create__hint">⌘↵ to save · Esc to cancel</span>
          <button className="notepad-btn-ghost" onClick={onClose} disabled={saving}>
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

// ── Note row ──────────────────────────────────────────────────────

function NoteRow({
  note,
  onContextMenu,
}: {
  note: NoteListItem | SearchResult
  onContextMenu: (e: React.MouseEvent, note: NoteListItem | SearchResult) => void
}): React.JSX.Element {
  const { selectedNoteId, setSelected } = useNotesStore()
  const id = note.id
  const isSelected = selectedNoteId === id
  const title = note.title
  const preview = 'bodyPreview' in note ? note.bodyPreview : ''
  const snippet = 'snippet' in note && note.snippet ? note.snippet : ''

  return (
    <button
      className={`notepad-note-row${isSelected ? ' notepad-note-row--selected' : ''}`}
      onClick={() => setSelected(id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, note)
      }}
      aria-selected={isSelected}
    >
      <div className="notepad-note-row__title">{title}</div>
      {(snippet || preview) && (
        <div
          className="notepad-note-row__preview"
          // snippet may contain <mark> from search highlight — safe, comes from our own data
          dangerouslySetInnerHTML={{ __html: snippet || preview.slice(0, 80) }}
        />
      )}
      <div className="notepad-note-row__meta">{formatDate(note.updatedAt)}</div>
    </button>
  )
}

// ── NoteList ──────────────────────────────────────────────────────

export function NoteList(): React.JSX.Element {
  const { notes, setNotes } = useNotesStore()
  const { searchQuery, activeTagId, includeArchived, setQuery, setTag, toggleArchived } =
    useFilterStore()

  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const tagsRef = useRef<Tag[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)

  useEffect(() => {
    const tagMap = new Map<string, { id: string; name: string; count: number }>()
    for (const note of notes) {
      for (const name of note.tags) {
        const existing = tagMap.get(name)
        if (existing) {
          existing.count++
        } else {
          tagMap.set(name, { id: `local:${name}`, name, count: 1 })
        }
      }
    }
    const derived = Array.from(tagMap.values()).map((t) => ({
      id: t.id,
      name: t.name,
      noteCount: t.count,
    }))
    tagsRef.current = derived
    setTags(derived)
  }, [notes])

  const loadTagIds = useCallback(async () => {
    /* v8 ignore next 3 */
    const result = await window.electronAPI.extensionBridge.invoke(
      'terminator.notepad:tags.list',
      {}
    )
    const data = (result as { data?: Tag[] }).data
    if (data) {
      tagsRef.current = data
      setTags(data)
    }
  }, [])

  const handleTagClick = useCallback(
    async (tagName: string) => {
      await loadTagIds()
      const tag = tagsRef.current.find((t) => t.name === tagName)
      if (tag) setTag(activeTagId === tag.id ? null : tag.id)
    },
    [loadTagIds, setTag, activeTagId]
  )

  useEffect(() => {
    /* v8 ignore next */
    if (!searchQuery && !activeTagId) {
      setSearchResults(null)
      return
    }
    const parts: string[] = []
    if (searchQuery) parts.push(searchQuery)
    if (activeTagId) {
      const tag = tags.find((t) => t.id === activeTagId)
      if (tag) parts.push(`tag:${tag.name}`)
    }

    /* v8 ignore next */
    const run = async () => {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:search.query',
        { query: parts.join(' '), includeArchived }
      )
      const data = (result as { data?: SearchResult[] }).data
      if (data) setSearchResults(data)
    }
    void run()
  }, [searchQuery, activeTagId, includeArchived, tags])

  // Close context menu on any click outside
  useEffect(() => {
    if (!contextMenu) return
    function dismiss() {
      setContextMenu(null)
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [contextMenu])

  function handleContextMenu(e: React.MouseEvent, note: NoteListItem | SearchResult) {
    setContextMenu({
      noteId: note.id,
      title: note.title,
      tags: note.tags ?? [],
      x: e.clientX,
      y: e.clientY,
    })
  }

  async function reloadNotes() {
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:notes.list',
        {}
      )
      const data = (result as { data?: unknown[] }).data
      if (Array.isArray(data)) setNotes(data as Parameters<typeof setNotes>[0])
    } catch (err) {
      console.error('[notepad] Failed to reload notes', err)
    }
  }

  const displayNotes = searchResults ?? notes

  return (
    <div className="notepad-note-list">
      <div className="notepad-note-list__search">
        <input
          type="text"
          className="notepad-search-input"
          placeholder="Search notes…"
          value={searchQuery}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {tags.length > 0 && (
        <div className="notepad-tag-sidebar">
          {tags.map((tag) => (
            <button
              key={tag.id}
              className={`notepad-tag-chip${activeTagId === tag.id ? ' notepad-tag-chip--active' : ''}`}
              onClick={() => void handleTagClick(tag.name)}
            >
              {tag.name}
            </button>
          ))}
        </div>
      )}

      {displayNotes.length === 0 ? (
        <EmptyState />
      ) : (
        displayNotes.map((note) => (
          <NoteRow key={note.id} note={note} onContextMenu={handleContextMenu} />
        ))
      )}

      <div className="notepad-note-list__footer">
        <button className="notepad-btn-ghost" onClick={toggleArchived}>
          Include archived
        </button>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="notepad-context-menu"
          style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="notepad-context-menu__item"
            onClick={() => {
              setEditModal({
                noteId: contextMenu.noteId,
                title: contextMenu.title,
                tags: contextMenu.tags,
              })
              setContextMenu(null)
            }}
          >
            Edit title &amp; tags
          </button>
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <NoteEditModal
          state={editModal}
          onClose={() => setEditModal(null)}
          onSaved={() => void reloadNotes()}
        />
      )}
    </div>
  )
}
