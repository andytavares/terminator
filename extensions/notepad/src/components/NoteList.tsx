import React, { useEffect, useRef, useState, useCallback } from 'react'
import { X, LayoutTemplate } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'
import { useFilterStore } from '../stores/filter.store'
import { EmptyState } from './EmptyState'
import type { NoteListItem, DiagramListItem, SearchResult, Tag } from '../db/types'

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
  itemId: string
  itemType: 'note' | 'diagram'
  title: string
  tags: string[]
  isArchived: boolean
  x: number
  y: number
}

interface EditModalState {
  itemId: string
  itemType: 'note' | 'diagram'
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

function ItemEditModal({
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
      if (state.itemType === 'diagram') {
        await window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.autosave', {
          id: state.itemId,
          title: title.trim() || 'Untitled diagram',
          tags,
        })
      } else {
        const noteResult = await window.electronAPI.extensionBridge.invoke(
          'terminator.notepad:notes.get',
          { id: state.itemId }
        )
        const body = (noteResult as { data?: { body: string } }).data?.body ?? ''
        await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.autosave', {
          id: state.itemId,
          title: title.trim() || 'Untitled note',
          body,
          tags,
        })
      }
      onSaved()
      onClose()
    } catch (err) {
      console.error('[notepad] edit item failed', err)
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
      <div
        className="notepad-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${state.itemType}`}
      >
        <div className="notepad-dialog__header">
          <span className="notepad-dialog__title">
            Edit {state.itemType === 'diagram' ? 'Diagram' : 'Note'}
          </span>
          <button className="notepad-btn-icon" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="notepad-dialog__body">
          <input
            ref={titleRef}
            className="notepad-input"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void handleSave()
            }}
          />
          <TagChipInput tags={tags} onChange={setTags} />
        </div>
        <div className="notepad-dialog__footer">
          <span className="notepad-dialog__hint">⌘↵ save · Esc cancel</span>
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

// ── DiagramRow ───────────────────────────────────────────────────

function DiagramRow({
  diagram,
  onContextMenu,
  dimmed,
}: {
  diagram: DiagramListItem
  onContextMenu: (e: React.MouseEvent, diagram: DiagramListItem) => void
  dimmed?: boolean
}): React.JSX.Element {
  const { selectedDiagramId, setSelectedDiagram } = useNotesStore()
  const isSelected = selectedDiagramId === diagram.id

  return (
    <button
      className={`notepad-note-row notepad-note-row--diagram${isSelected ? ' notepad-note-row--selected' : ''}${dimmed ? ' notepad-note-row--dimmed' : ''}`}
      onClick={() => setSelectedDiagram(diagram.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, diagram)
      }}
      aria-selected={isSelected}
    >
      <div className="notepad-note-row__title">
        <LayoutTemplate size={12} className="notepad-note-row__diagram-icon" />
        {diagram.title}
      </div>
      <div className="notepad-note-row__meta-line">
        <span className="notepad-note-row__time">{relativeTime(diagram.updatedAt)}</span>
        {diagram.tags && diagram.tags.length > 0 && (
          <>
            <span className="notepad-note-row__dot">·</span>
            <span className="notepad-note-row__tags-inline">
              {diagram.tags
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
  const {
    notes,
    setNotes,
    diagrams,
    setDiagrams,
    selectedNoteId,
    setSelected,
    setShowQuickCreate,
  } = useNotesStore()
  const { searchQuery, activeTagId, setQuery, setTag } = useFilterStore()

  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const tagsRef = useRef<Tag[]>([])
  const searchGenRef = useRef(0)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)

  useEffect(() => {
    const previousTags = tagsRef.current
    const tagMap = new Map<string, { id: string; name: string; count: number }>()
    for (const note of notes) {
      for (const name of note.tags) {
        const existing = tagMap.get(name)
        if (existing) {
          existing.count++
        } else {
          const known = previousTags.find((t) => t.name === name)
          tagMap.set(name, { id: known?.id ?? `local:${name}`, name, count: 1 })
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
      const tagName = tag?.name ?? (activeTagId.startsWith('local:') ? activeTagId.slice(6) : null)
      if (tagName) parts.push(`tag:${tagName}`)
    }

    /* v8 ignore next */
    const gen = ++searchGenRef.current
    const run = async () => {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:search.query',
        { query: parts.join(' '), includeArchived: true }
      )
      if (gen !== searchGenRef.current) return
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
      itemId: note.id,
      itemType: 'note',
      title: note.title,
      tags: note.tags ?? [],
      isArchived: !!note.archivedAt,
      x: e.clientX,
      y: e.clientY,
    })
  }

  function handleDiagramContextMenu(e: React.MouseEvent, diagram: DiagramListItem) {
    setContextMenu({
      itemId: diagram.id,
      itemType: 'diagram',
      title: diagram.title,
      tags: diagram.tags,
      isArchived: !!diagram.archivedAt,
      x: e.clientX,
      y: e.clientY,
    })
  }

  async function handleArchiveToggle(
    itemId: string,
    itemType: 'note' | 'diagram',
    isArchived: boolean
  ) {
    const baseChannel =
      itemType === 'diagram' ? 'terminator.notepad:diagrams' : 'terminator.notepad:notes'
    const action = isArchived ? 'restore' : 'archive'
    await window.electronAPI.extensionBridge
      .invoke(`${baseChannel}.${action}`, { id: itemId })
      .catch(console.error)
    await reloadAll()
  }

  async function handleDelete(itemId: string, itemType: 'note' | 'diagram', isArchived: boolean) {
    if (!isArchived) {
      window.alert(`Archive this ${itemType} before deleting it.`)
      return
    }
    const ok = window.confirm(`Permanently delete this ${itemType}? This cannot be undone.`)
    if (!ok) return
    const channel =
      itemType === 'diagram'
        ? 'terminator.notepad:diagrams.hardDelete'
        : 'terminator.notepad:notes.hardDelete'
    await window.electronAPI.extensionBridge.invoke(channel, { id: itemId }).catch(console.error)
    if (itemType === 'note' && selectedNoteId === itemId) setSelected(null)
    if (itemType === 'diagram' && useNotesStore.getState().selectedDiagramId === itemId)
      useNotesStore.getState().setSelectedDiagram(null)
    await reloadAll()
  }

  async function reloadAll() {
    try {
      const [notesResult, diagramsResult] = await Promise.all([
        window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.list', {
          includeArchived: true,
        }),
        window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.list', {
          includeArchived: true,
        }),
      ])
      const notesData = (notesResult as { data?: unknown[] }).data
      if (Array.isArray(notesData)) setNotes(notesData as Parameters<typeof setNotes>[0])
      const diagramsData = (diagramsResult as { data?: unknown[] }).data
      if (Array.isArray(diagramsData))
        setDiagrams(diagramsData as Parameters<typeof setDiagrams>[0])
    } catch (err) {
      console.error('[notepad] Failed to reload', err)
    }
  }

  // Merge notes + diagrams sorted by updatedAt descending
  const allNoteItems = (searchResults ?? notes) as (NoteListItem | SearchResult)[]
  const activeNotes = allNoteItems.filter((n) => !n.archivedAt)
  const archivedNotes = allNoteItems.filter((n) => n.archivedAt)

  // When a search/tag filter is active, filter diagrams client-side to match
  const filteredDiagrams = (() => {
    if (!searchResults) return diagrams
    const q = searchQuery.toLowerCase()
    const activeTagName = (() => {
      if (!activeTagId) return null
      const tag = tags.find((t) => t.id === activeTagId)
      return tag?.name ?? (activeTagId.startsWith('local:') ? activeTagId.slice(6) : null)
    })()
    return diagrams.filter((d) => {
      const matchesQuery = !q || d.title.toLowerCase().includes(q)
      const matchesTag = !activeTagName || d.tags.includes(activeTagName)
      return matchesQuery && matchesTag
    })
  })()

  const activeDiagrams = filteredDiagrams.filter((d) => !d.archivedAt)
  const archivedDiagrams = filteredDiagrams.filter((d) => d.archivedAt)

  type MixedItem =
    | { kind: 'note'; item: NoteListItem | SearchResult }
    | { kind: 'diagram'; item: DiagramListItem }

  function mergeSorted(
    noteItems: (NoteListItem | SearchResult)[],
    diagramItems: DiagramListItem[]
  ): MixedItem[] {
    const mixed: MixedItem[] = [
      ...noteItems.map((n) => ({ kind: 'note' as const, item: n })),
      ...diagramItems.map((d) => ({ kind: 'diagram' as const, item: d })),
    ]
    return mixed.sort((a, b) => b.item.updatedAt.localeCompare(a.item.updatedAt))
  }

  const activeItems = mergeSorted(activeNotes, activeDiagrams)
  const archivedItems = mergeSorted(archivedNotes, archivedDiagrams)

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
        {activeItems.length === 0 && archivedItems.length === 0 ? (
          searchResults !== null ? (
            <div className="notepad-note-list__no-results">
              No results for "{searchQuery || activeTagId}"
            </div>
          ) : (
            <EmptyState />
          )
        ) : (
          activeItems.map((entry) =>
            entry.kind === 'diagram' ? (
              <DiagramRow
                key={entry.item.id}
                diagram={entry.item as DiagramListItem}
                onContextMenu={handleDiagramContextMenu}
              />
            ) : (
              <NoteRow
                key={entry.item.id}
                note={entry.item as NoteListItem | SearchResult}
                onContextMenu={handleContextMenu}
              />
            )
          )
        )}

        {archivedItems.length > 0 && (
          <>
            <button
              className="notepad-archived-toggle"
              onClick={() => setArchivedExpanded((v) => !v)}
            >
              {archivedExpanded ? '▼' : '▶'} Archived ({archivedItems.length})
            </button>
            {archivedExpanded &&
              archivedItems.map((entry) =>
                entry.kind === 'diagram' ? (
                  <DiagramRow
                    key={entry.item.id}
                    diagram={entry.item as DiagramListItem}
                    onContextMenu={handleDiagramContextMenu}
                    dimmed
                  />
                ) : (
                  <NoteRow
                    key={entry.item.id}
                    note={entry.item as NoteListItem | SearchResult}
                    onContextMenu={handleContextMenu}
                    dimmed
                  />
                )
              )}
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
                itemId: contextMenu.itemId,
                itemType: contextMenu.itemType,
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
              const { itemId, itemType, isArchived } = contextMenu
              setContextMenu(null)
              void handleArchiveToggle(itemId, itemType, isArchived)
            }}
          >
            {contextMenu.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          {contextMenu.isArchived && (
            <button
              className="notepad-context-menu__item notepad-context-menu__item--danger"
              onClick={() => {
                const { itemId, itemType, isArchived } = contextMenu
                setContextMenu(null)
                void handleDelete(itemId, itemType, isArchived)
              }}
            >
              Delete
            </button>
          )}
        </div>
      )}

      {/* Edit modal */}
      {editModal && (
        <ItemEditModal
          state={editModal}
          onClose={() => setEditModal(null)}
          onSaved={() => void reloadAll()}
        />
      )}
    </div>
  )
}
