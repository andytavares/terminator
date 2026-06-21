import React, { useEffect, useRef, useState } from 'react'
import {
  X,
  LayoutTemplate,
  ChevronRight,
  ChevronDown,
  Folder,
  Tag as TagIcon,
  Check,
} from 'lucide-react'
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
  folderId: string | null
  x: number
  y: number
}

interface FolderContextMenuState {
  folderId: string
  folderName: string
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

// ── Drag helpers ─────────────────────────────────────────────────

interface DragProps {
  draggable: boolean
  dragOverPosition: 'before' | 'after' | null
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}

// ── Note row ──────────────────────────────────────────────────────

function NoteRow({
  note,
  onContextMenu,
  dimmed,
  dragProps,
}: {
  note: NoteListItem | SearchResult
  onContextMenu: (e: React.MouseEvent, note: NoteListItem | SearchResult) => void
  dimmed?: boolean
  dragProps?: DragProps
}): React.JSX.Element {
  const { selectedNoteId, setSelected } = useNotesStore()
  const id = note.id
  const isSelected = selectedNoteId === id
  const title = note.title

  const tagList = note.tags ?? []
  const dragOverClass =
    dragProps?.dragOverPosition === 'before'
      ? ' notepad-note-row--drag-over-before'
      : dragProps?.dragOverPosition === 'after'
        ? ' notepad-note-row--drag-over-after'
        : ''

  return (
    <button
      className={`notepad-note-row${isSelected ? ' notepad-note-row--selected' : ''}${dimmed ? ' notepad-note-row--dimmed' : ''}${dragOverClass}`}
      draggable={dragProps?.draggable}
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
      onDragStart={dragProps?.onDragStart}
      onDragOver={dragProps?.onDragOver}
      onDragLeave={dragProps?.onDragLeave}
      onDrop={dragProps?.onDrop}
      onDragEnd={dragProps?.onDragEnd}
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
  dragProps,
}: {
  diagram: DiagramListItem
  onContextMenu: (e: React.MouseEvent, diagram: DiagramListItem) => void
  dimmed?: boolean
  dragProps?: DragProps
}): React.JSX.Element {
  const { selectedDiagramId, setSelectedDiagram } = useNotesStore()
  const isSelected = selectedDiagramId === diagram.id
  const dragOverClass =
    dragProps?.dragOverPosition === 'before'
      ? ' notepad-note-row--drag-over-before'
      : dragProps?.dragOverPosition === 'after'
        ? ' notepad-note-row--drag-over-after'
        : ''

  return (
    <button
      className={`notepad-note-row notepad-note-row--diagram${isSelected ? ' notepad-note-row--selected' : ''}${dimmed ? ' notepad-note-row--dimmed' : ''}${dragOverClass}`}
      draggable={dragProps?.draggable}
      onClick={() => setSelectedDiagram(diagram.id)}
      onDoubleClick={() => {
        window.electronAPI.extensionBridge
          .invoke('terminator.notepad:diagrams.openWindow', { id: diagram.id })
          .catch(console.error)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, diagram)
      }}
      onDragStart={dragProps?.onDragStart}
      onDragOver={dragProps?.onDragOver}
      onDragLeave={dragProps?.onDragLeave}
      onDrop={dragProps?.onDrop}
      onDragEnd={dragProps?.onDragEnd}
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
    folders,
    setFolders,
    selectedNoteId,
    setSelected,
    setShowQuickCreate,
  } = useNotesStore()
  const { searchQuery, activeTagIds, setQuery, toggleTag, clearTags } = useFilterStore()

  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const tagsRef = useRef<Tag[]>([])
  const searchGenRef = useRef(0)
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false)
  const tagDropdownRef = useRef<HTMLDivElement>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set())
  const [folderRenameState, setFolderRenameState] = useState<{ id: string; name: string } | null>(
    null
  )

  // Drag-and-drop state
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragType, setDragType] = useState<'note' | 'diagram' | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: string; before: boolean } | null>(null)
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null)

  useEffect(() => {
    const previousTags = tagsRef.current
    const tagMap = new Map<string, { id: string; name: string; count: number }>()
    const allTagSources = [...notes.flatMap((n) => n.tags), ...diagrams.flatMap((d) => d.tags)]
    for (const name of allTagSources) {
      const existing = tagMap.get(name)
      if (existing) {
        existing.count++
      } else {
        const known = previousTags.find((t) => t.name === name)
        tagMap.set(name, { id: known?.id ?? `local:${name}`, name, count: 1 })
      }
    }
    const derived = Array.from(tagMap.values()).map((t) => ({
      id: t.id,
      name: t.name,
      noteCount: t.count,
    }))
    tagsRef.current = derived
    setTags(derived)
  }, [notes, diagrams])

  // Close tag dropdown when clicking outside
  useEffect(() => {
    if (!tagDropdownOpen) return
    function onMouseDown(e: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [tagDropdownOpen])

  // Text search via IPC (tags are filtered client-side)
  useEffect(() => {
    /* v8 ignore next */
    if (!searchQuery) {
      ++searchGenRef.current
      setSearchResults(null)
      return
    }
    /* v8 ignore next */
    const gen = ++searchGenRef.current
    const run = async () => {
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:search.query',
        { query: searchQuery, includeArchived: true }
      )
      if (gen !== searchGenRef.current) return
      const data = (result as { data?: SearchResult[] }).data
      if (data) setSearchResults(data)
    }
    void run()
  }, [searchQuery])

  // Close context menus on any click outside
  useEffect(() => {
    if (!contextMenu && !folderContextMenu) return
    function dismiss() {
      setContextMenu(null)
      setFolderContextMenu(null)
    }
    document.addEventListener('mousedown', dismiss)
    return () => document.removeEventListener('mousedown', dismiss)
  }, [contextMenu, folderContextMenu])

  function handleContextMenu(e: React.MouseEvent, note: NoteListItem | SearchResult) {
    setContextMenu({
      itemId: note.id,
      itemType: 'note',
      title: note.title,
      tags: note.tags ?? [],
      isArchived: !!note.archivedAt,
      folderId: ('folderId' in note ? note.folderId : null) ?? null,
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
      folderId: diagram.folderId ?? null,
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
      const [notesResult, diagramsResult, foldersResult] = await Promise.all([
        window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.list', {
          includeArchived: true,
        }),
        window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.list', {
          includeArchived: true,
        }),
        window.electronAPI.extensionBridge.invoke('terminator.notepad:folders.list', {}),
      ])
      const notesData = (notesResult as { data?: unknown[] }).data
      if (Array.isArray(notesData)) setNotes(notesData as Parameters<typeof setNotes>[0])
      const diagramsData = (diagramsResult as { data?: unknown[] }).data
      if (Array.isArray(diagramsData))
        setDiagrams(diagramsData as Parameters<typeof setDiagrams>[0])
      const foldersData = (foldersResult as { data?: unknown[] }).data
      if (Array.isArray(foldersData)) setFolders(foldersData as Parameters<typeof setFolders>[0])
    } catch (err) {
      console.error('[notepad] Failed to reload', err)
    }
  }

  // Resolve active tag names for client-side filtering
  const activeTagNames = activeTagIds
    .map((id) => {
      const t = tags.find((tg) => tg.id === id)
      return t?.name ?? (id.startsWith('local:') ? id.slice(6) : null)
    })
    .filter((n): n is string => n !== null)

  // Notes: text search via IPC; tag filter client-side
  const filteredNoteItems: (NoteListItem | SearchResult)[] = (() => {
    const base = searchResults !== null ? (searchResults as SearchResult[]) : notes
    if (activeTagNames.length === 0) return base
    return base.filter((n) => activeTagNames.some((name) => n.tags.includes(name)))
  })()

  const activeNotes = filteredNoteItems.filter((n) => !n.archivedAt)
  const archivedNotes = filteredNoteItems.filter((n) => n.archivedAt)

  // Diagrams: always filtered client-side
  const filteredDiagrams = (() => {
    let result = diagrams
    if (activeTagNames.length > 0) {
      result = result.filter((d) => activeTagNames.some((name) => d.tags.includes(name)))
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (d) => d.title.toLowerCase().includes(q) || d.tags.some((t) => t.toLowerCase().includes(q))
      )
    }
    return result
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
    return mixed.sort((a, b) => {
      const aOrder = ('sortOrder' in a.item ? a.item.sortOrder : undefined) ?? 0
      const bOrder = ('sortOrder' in b.item ? b.item.sortOrder : undefined) ?? 0
      if (aOrder !== bOrder) return aOrder - bOrder
      return b.item.updatedAt.localeCompare(a.item.updatedAt)
    })
  }

  const activeItems = mergeSorted(activeNotes, activeDiagrams)
  const archivedItems = mergeSorted(archivedNotes, archivedDiagrams)

  const isFiltering = searchResults !== null || activeTagNames.length > 0

  // When filtering, show everything flat. When not filtering, split by folder.
  const rootActiveItems = isFiltering
    ? activeItems
    : activeItems.filter((e) => {
        const folderId = 'folderId' in e.item ? e.item.folderId : null
        return folderId === null
      })

  function getItemsInFolder(folderId: string): MixedItem[] {
    return activeItems.filter((e) => {
      const itemFolderId = 'folderId' in e.item ? e.item.folderId : null
      return itemFolderId === folderId
    })
  }

  function toggleFolder(id: string) {
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleMoveToFolder(
    itemId: string,
    itemType: 'note' | 'diagram',
    folderId: string | null
  ) {
    await window.electronAPI.extensionBridge
      .invoke('terminator.notepad:folders.move', {
        items: [{ id: itemId, type: itemType }],
        folderId,
      })
      .catch(console.error)
    await reloadAll()
  }

  async function handleFolderRename(folderId: string, name: string) {
    await window.electronAPI.extensionBridge
      .invoke('terminator.notepad:folders.rename', { id: folderId, name })
      .catch(console.error)
    setFolderRenameState(null)
    await reloadAll()
  }

  async function handleFolderDelete(folderId: string) {
    const ok = window.confirm(
      'Delete this folder? Notes and diagrams inside will be moved to the root.'
    )
    if (!ok) return
    await window.electronAPI.extensionBridge
      .invoke('terminator.notepad:folders.delete', { id: folderId })
      .catch(console.error)
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev)
      next.delete(folderId)
      return next
    })
    await reloadAll()
  }

  function renderMixedItem(entry: MixedItem) {
    if (entry.kind === 'diagram') {
      return (
        <DiagramRow
          key={entry.item.id}
          diagram={entry.item as DiagramListItem}
          onContextMenu={handleDiagramContextMenu}
          dragProps={searchResults === null ? makeDragProps(entry.item.id, 'diagram') : undefined}
        />
      )
    }
    return (
      <NoteRow
        key={entry.item.id}
        note={entry.item as NoteListItem | SearchResult}
        onContextMenu={handleContextMenu}
        dragProps={searchResults === null ? makeDragProps(entry.item.id, 'note') : undefined}
      />
    )
  }

  function makeDragProps(id: string, type: 'note' | 'diagram'): DragProps {
    return {
      draggable: searchResults === null,
      dragOverPosition: dropTarget?.id === id ? (dropTarget.before ? 'before' : 'after') : null,
      onDragStart(e) {
        setDragId(id)
        setDragType(type)
        e.dataTransfer.effectAllowed = 'move'
      },
      onDragOver(e) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const rect = e.currentTarget.getBoundingClientRect()
        const before = e.clientY < rect.top + rect.height / 2
        setDropTarget((prev) => (prev?.id === id && prev.before === before ? prev : { id, before }))
      },
      onDragLeave() {
        setDropTarget((prev) => (prev?.id === id ? null : prev))
      },
      onDrop(e) {
        e.preventDefault()
        e.stopPropagation()
        if (!dragId || !dragType || !dropTarget) {
          setDragId(null)
          setDragType(null)
          setDropTarget(null)
          return
        }

        const draggedEntry = activeItems.find((en) => en.item.id === dragId)
        const dropEntry = activeItems.find((en) => en.item.id === dropTarget.id)

        const draggedFolderId =
          draggedEntry && 'folderId' in draggedEntry.item ? draggedEntry.item.folderId : null
        const dropFolderId =
          dropEntry && 'folderId' in dropEntry.item ? dropEntry.item.folderId : null

        // Determine the item set to reorder within
        const sameGroup = draggedFolderId === dropFolderId
        const baseItems = dropFolderId === null ? rootActiveItems : getItemsInFolder(dropFolderId)
        const ordered = baseItems.map((en) => ({ id: en.item.id, type: en.kind }))

        // If dragged item is in a different group, inject it into the destination list
        const fromIdx = ordered.findIndex((i) => i.id === dragId)
        const dropIdx = ordered.findIndex((i) => i.id === dropTarget.id)

        if (dropIdx === -1) {
          setDragId(null)
          setDragType(null)
          setDropTarget(null)
          return
        }

        const newOrder = [...ordered]
        if (fromIdx !== -1) newOrder.splice(fromIdx, 1)
        const newDropIdx = newOrder.findIndex((i) => i.id === dropTarget.id)
        newOrder.splice(dropTarget.before ? newDropIdx : newDropIdx + 1, 0, {
          id: dragId,
          type: dragType,
        })

        setDragId(null)
        setDragType(null)
        setDropTarget(null)

        const ops: Promise<unknown>[] = [
          window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.reorder', {
            items: newOrder,
          }),
        ]
        if (!sameGroup) {
          ops.push(
            window.electronAPI.extensionBridge.invoke('terminator.notepad:folders.move', {
              items: [{ id: dragId, type: dragType }],
              folderId: dropFolderId,
            })
          )
        }
        Promise.all(ops)
          .then(() => reloadAll())
          .catch(console.error)
      },
      onDragEnd() {
        setDragId(null)
        setDragType(null)
        setDropTarget(null)
        setFolderDropTarget(null)
      },
    }
  }

  function makeFolderDropProps(folderId: string) {
    return {
      isOver: folderDropTarget === folderId,
      onDragOver(e: React.DragEvent) {
        if (!dragId) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setFolderDropTarget(folderId)
        setDropTarget(null)
      },
      onDragLeave() {
        setFolderDropTarget((prev) => (prev === folderId ? null : prev))
      },
      onDrop(e: React.DragEvent) {
        e.preventDefault()
        if (!dragId || !dragType) {
          setDragId(null)
          setDragType(null)
          setFolderDropTarget(null)
          return
        }
        const id = dragId
        const type = dragType
        setDragId(null)
        setDragType(null)
        setFolderDropTarget(null)
        setDropTarget(null)
        e.stopPropagation()
        window.electronAPI.extensionBridge
          .invoke('terminator.notepad:folders.move', {
            items: [{ id, type }],
            folderId,
          })
          .then(() => reloadAll())
          .catch(console.error)
      },
    }
  }

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
        <div className="notepad-tag-filter" ref={tagDropdownRef}>
          <button
            className={`notepad-tag-filter__btn${activeTagIds.length > 0 ? ' notepad-tag-filter__btn--active' : ''}`}
            onClick={() => setTagDropdownOpen((v) => !v)}
          >
            <TagIcon size={11} />
            {activeTagIds.length > 0
              ? `${activeTagIds.length} tag${activeTagIds.length > 1 ? 's' : ''}`
              : 'Tags'}
            {activeTagIds.length > 0 && (
              <span
                className="notepad-tag-filter__clear-x"
                role="button"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  clearTags()
                }}
              >
                <X size={10} />
              </span>
            )}
          </button>
          {tagDropdownOpen && (
            <div className="notepad-tag-filter__dropdown">
              {[...tags]
                .sort((a, b) => {
                  const aActive = activeTagIds.includes(a.id) ? 0 : 1
                  const bActive = activeTagIds.includes(b.id) ? 0 : 1
                  return aActive - bActive
                })
                .map((tag) => {
                  const isActive = activeTagIds.includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      className={`notepad-tag-filter__option${isActive ? ' notepad-tag-filter__option--active' : ''}`}
                      onClick={() => toggleTag(tag.id)}
                    >
                      <span className="notepad-tag-filter__check">
                        {isActive && <Check size={10} />}
                      </span>
                      <span className="notepad-tag-filter__hash">#</span>
                      {tag.name}
                      <span className="notepad-tag-filter__count">{tag.noteCount}</span>
                    </button>
                  )
                })}
            </div>
          )}
        </div>
      )}

      <div
        className="notepad-note-list__notes"
        onDragOver={(e) => {
          if (!dragId) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropTarget(null)
          setFolderDropTarget(null)
        }}
        onDrop={(e) => {
          if (!dragId || !dragType) return
          e.preventDefault()
          // Check if the item was in a folder
          const draggedEntry = activeItems.find((entry) => entry.item.id === dragId)
          const draggedFolderId =
            draggedEntry && 'folderId' in draggedEntry.item ? draggedEntry.item.folderId : null
          if (draggedFolderId === null) {
            setDragId(null)
            setDragType(null)
            return
          }
          const id = dragId
          const type = dragType
          setDragId(null)
          setDragType(null)
          window.electronAPI.extensionBridge
            .invoke('terminator.notepad:folders.move', {
              items: [{ id, type }],
              folderId: null,
            })
            .then(() => reloadAll())
            .catch(console.error)
        }}
      >
        {activeItems.length === 0 &&
        archivedItems.length === 0 &&
        (folders.length === 0 || isFiltering) ? (
          isFiltering ? (
            <div className="notepad-note-list__no-results">
              No results
              {activeTagNames.length > 0 && ` for ${activeTagNames.map((n) => `#${n}`).join(', ')}`}
              {searchQuery && activeTagNames.length > 0
                ? ` matching "${searchQuery}"`
                : searchQuery
                  ? ` for "${searchQuery}"`
                  : ''}
            </div>
          ) : (
            <EmptyState />
          )
        ) : (
          <>
            {rootActiveItems.map((entry) => renderMixedItem(entry))}

            {!isFiltering &&
              folders.map((folder) => {
                const folderItems = getItemsInFolder(folder.id)
                const isCollapsed = collapsedFolderIds.has(folder.id)
                const isRenaming = folderRenameState?.id === folder.id
                const folderDrop = makeFolderDropProps(folder.id)
                return (
                  <div key={folder.id} className="notepad-folder-section">
                    <div
                      className={`notepad-folder-header${folderDrop.isOver ? ' notepad-folder-header--drop-target' : ''}`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setFolderContextMenu({
                          folderId: folder.id,
                          folderName: folder.name,
                          x: e.clientX,
                          y: e.clientY,
                        })
                      }}
                      onDragOver={folderDrop.onDragOver}
                      onDragLeave={folderDrop.onDragLeave}
                      onDrop={folderDrop.onDrop}
                    >
                      <button
                        className="notepad-folder-header__toggle"
                        onClick={() => toggleFolder(folder.id)}
                        aria-label={
                          isCollapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`
                        }
                      >
                        {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <Folder size={12} className="notepad-folder-header__icon" />
                        {isRenaming ? (
                          <input
                            className="notepad-folder-header__rename-input"
                            autoFocus
                            defaultValue={folder.name}
                            onBlur={(e) =>
                              void handleFolderRename(folder.id, e.target.value || folder.name)
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter')
                                void handleFolderRename(
                                  folder.id,
                                  e.currentTarget.value || folder.name
                                )
                              if (e.key === 'Escape') setFolderRenameState(null)
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <span className="notepad-folder-header__name">{folder.name}</span>
                        )}
                        <span className="notepad-folder-header__count">{folderItems.length}</span>
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="notepad-folder-items">
                        {folderItems.length === 0 ? (
                          <div className="notepad-folder-empty">Empty</div>
                        ) : (
                          folderItems.map((entry) => renderMixedItem(entry))
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
          </>
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
          {folders.length > 0 && !contextMenu.isArchived && (
            <>
              <div className="notepad-context-menu__separator" />
              {contextMenu.folderId !== null && (
                <button
                  className="notepad-context-menu__item"
                  onClick={() => {
                    const { itemId, itemType } = contextMenu
                    setContextMenu(null)
                    void handleMoveToFolder(itemId, itemType, null)
                  }}
                >
                  Remove from folder
                </button>
              )}
              {folders
                .filter((f) => f.id !== contextMenu.folderId)
                .map((f) => (
                  <button
                    key={f.id}
                    className="notepad-context-menu__item"
                    onClick={() => {
                      const { itemId, itemType } = contextMenu
                      setContextMenu(null)
                      void handleMoveToFolder(itemId, itemType, f.id)
                    }}
                  >
                    Move to {f.name}
                  </button>
                ))}
            </>
          )}
        </div>
      )}

      {/* Folder context menu */}
      {folderContextMenu && (
        <div
          className="notepad-context-menu"
          style={{ position: 'fixed', top: folderContextMenu.y, left: folderContextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="notepad-context-menu__item"
            onClick={() => {
              setFolderRenameState({
                id: folderContextMenu.folderId,
                name: folderContextMenu.folderName,
              })
              setFolderContextMenu(null)
            }}
          >
            Rename
          </button>
          <button
            className="notepad-context-menu__item notepad-context-menu__item--danger"
            onClick={() => {
              const { folderId } = folderContextMenu
              setFolderContextMenu(null)
              void handleFolderDelete(folderId)
            }}
          >
            Delete folder
          </button>
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
