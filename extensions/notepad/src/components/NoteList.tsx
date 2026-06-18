import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'
import { useFilterStore } from '../stores/filter.store'
import { EmptyState } from './EmptyState'
import type { NoteListItem, SearchResult, Tag } from '../db/types'

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(iso).getDay()]
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Context menu ──────────────────────────────────────────────────

interface ContextMenuState {
  noteId: string
  title: string
  tags: string[]
  isArchived: boolean
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
  dimmed,
}: {
  note: NoteListItem | SearchResult
  onContextMenu: (e: React.MouseEvent, note: NoteListItem | SearchResult) => void
  dimmed?: boolean
}): React.JSX.Element {
  const { selectedNoteId, setSelected } = useNotesStore()
  const id = note.id
  const isSelected = selectedNoteId === id
  const title = note.title

  const tagList = note.tags ?? []

  return (
    <button
      className={`notepad-note-row${isSelected ? ' notepad-note-row--selected' : ''}${dimmed ? ' notepad-note-row--dimmed' : ''}`}
      onClick={() => setSelected(id)}
      onDoubleClick={() => {
        window.electronAPI.extensionBridge
          .invoke('terminator.notepad:notes.openWindow', { id })
          .catch(console.error)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, note)
      }}
      aria-selected={isSelected}
    >
      <div className="notepad-note-row__title">{title}</div>
      <div className="notepad-note-row__meta-line">
        <span className="notepad-note-row__time">{relativeTime(note.updatedAt)}</span>
        {tagList.length > 0 && (
          <>
            <span className="notepad-note-row__dot">·</span>
            <span className="notepad-note-row__tags-inline">
              {tagList
                .slice(0, 3)
                .map((t) => `#${t}`)
                .join(' ')}
            </span>
          </>
        )}
      </div>
    </button>
  )
}

// ── NoteList ──────────────────────────────────────────────────────

export function NoteList(): React.JSX.Element {
  const { notes, setNotes, selectedNoteId, setSelected, setShowQuickCreate } = useNotesStore()
  const { searchQuery, activeTagId, setQuery, setTag } = useFilterStore()

  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const tagsRef = useRef<Tag[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)

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
        { query: parts.join(' '), includeArchived: true }
      )
      const data = (result as { data?: SearchResult[] }).data
      if (data) setSearchResults(data)
    }
    void run()
  }, [searchQuery, activeTagId, tags])

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
      isArchived: !!note.archivedAt,
      x: e.clientX,
      y: e.clientY,
    })
  }

  async function handleArchiveToggle(noteId: string, isArchived: boolean) {
    const channel = isArchived
      ? 'terminator.notepad:notes.restore'
      : 'terminator.notepad:notes.archive'
    await window.electronAPI.extensionBridge.invoke(channel, { id: noteId }).catch(console.error)
    await reloadNotes()
  }

  async function handleDelete(noteId: string, isArchived: boolean) {
    if (!isArchived) {
      window.alert('Archive this note before deleting it.')
      return
    }
    const ok = window.confirm('Permanently delete this note? This cannot be undone.')
    if (!ok) return
    await window.electronAPI.extensionBridge
      .invoke('terminator.notepad:notes.hardDelete', { id: noteId })
      .catch(console.error)
    if (selectedNoteId === noteId) setSelected(null)
    await reloadNotes()
  }

  async function reloadNotes() {
    try {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:notes.list',
        { includeArchived: true }
      )
      const data = (result as { data?: unknown[] }).data
      if (Array.isArray(data)) setNotes(data as Parameters<typeof setNotes>[0])
    } catch (err) {
      console.error('[notepad] Failed to reload notes', err)
    }
  }

  const allNotes = searchResults ?? notes
  const activeNotes = allNotes.filter((n) => !n.archivedAt)
  const archivedNotes = allNotes.filter((n) => n.archivedAt)

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
        <kbd className="notepad-search-kbd">⌘⇧F</kbd>
      </div>

      {tags.length > 0 && (
        <div className="notepad-tag-sidebar">
          {tags.map((tag) => (
            <button
              key={tag.id}
              className={`notepad-tag-chip${activeTagId === tag.id ? ' notepad-tag-chip--active' : ''}`}
              onClick={() => void handleTagClick(tag.name)}
            >
              <span className="notepad-tag-chip__hash">#</span>
              {tag.name}
              <span className="notepad-tag-chip__count">{tag.noteCount}</span>
            </button>
          ))}
        </div>
      )}

      <div className="notepad-note-list__notes">
        {activeNotes.length === 0 && archivedNotes.length === 0 ? (
          <EmptyState />
        ) : (
          activeNotes.map((note) => (
            <NoteRow key={note.id} note={note} onContextMenu={handleContextMenu} />
          ))
        )}

        {archivedNotes.length > 0 && (
          <>
            <button
              className="notepad-archived-toggle"
              onClick={() => setArchivedExpanded((v) => !v)}
            >
              {archivedExpanded ? '▼' : '▶'} Archived ({archivedNotes.length})
            </button>
            {archivedExpanded &&
              archivedNotes.map((note) => (
                <NoteRow key={note.id} note={note} onContextMenu={handleContextMenu} dimmed />
              ))}
          </>
        )}
      </div>

      <div className="notepad-note-list__footer">
        <button
          className="notepad-btn-export"
          onClick={() => window.dispatchEvent(new CustomEvent('notepad:openExport'))}
        >
          ↓ Export
        </button>
        <button
          className="notepad-btn-primary notepad-btn-new"
          onClick={() => setShowQuickCreate(true)}
        >
          + New <kbd className="notepad-kbd notepad-kbd--inline">⌘⇧N</kbd>
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
          <button
            className="notepad-context-menu__item"
            onClick={() => {
              const { noteId, isArchived } = contextMenu
              setContextMenu(null)
              void handleArchiveToggle(noteId, isArchived)
            }}
          >
            {contextMenu.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            className="notepad-context-menu__item notepad-context-menu__item--danger"
            onClick={() => {
              const { noteId, isArchived } = contextMenu
              setContextMenu(null)
              void handleDelete(noteId, isArchived)
            }}
          >
            Delete
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
