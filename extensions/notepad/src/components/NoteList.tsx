import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Folder as FolderIcon,
  Plus,
  Tag as TagIcon,
  X,
} from 'lucide-react'
import { Button, ConfirmDialog, useDismissible } from '@terminator/extension-ui'
import { loadLibrary, useNotesStore } from '../stores/notes.store'
import { useFilterStore } from '../stores/filter.store'
import { EmptyState } from './EmptyState'
import { ItemEditModal, ItemRow, type DragProps, type EditModalState } from './NoteListItems'
import {
  activeTagNamesOf,
  applyDrop,
  buildListModel,
  deleteFolder,
  deleteForGood,
  folderIdOf,
  itemsInFolder,
  moveToFolder,
  noResultsText,
  planDrop,
  renameFolder,
  tagsInUse,
  toggleArchived,
  type DropTarget,
  type ItemRef,
  type ListModel,
  type MixedItem,
} from './noteListModel'
import type { Folder, SearchResult, Tag } from '../db/types'

/** The item a context menu was opened on, and where. */
interface ContextMenuState {
  item: ItemRef
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

/** The list's menus, dialogs and folder state. */
type ListUi = ReturnType<typeof useListUi>

type ListDrag = ReturnType<typeof useListDrag>

/** What the list body needs to render its items. */
interface ListView {
  model: ListModel
  ui: ListUi
  drag: ListDrag
  /** Rows can be dragged only while the list is not a text-search result. */
  canDrag: boolean
}

interface FolderSectionProps {
  folder: Folder
  view: ListView
}

interface TagFilterProps {
  tags: Tag[]
}

interface MenuProps {
  ui: ListUi
  menuRef: React.RefObject<HTMLDivElement>
}

type DragState = ReturnType<typeof useDragState>

interface RowDragContext {
  model: ListModel
  state: DragState
}

interface MenuItemProps {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}

export function NoteList(): React.JSX.Element {
  const { notes, diagrams } = useNotesStore()
  const { searchQuery, activeTagIds } = useFilterStore()
  const searchResults = useSearchResults(searchQuery)
  const tags = useMemo(() => tagsInUse(notes, diagrams), [notes, diagrams])
  const activeTagNames = activeTagNamesOf(activeTagIds, tags)
  const model = buildListModel(notes, diagrams, { searchResults, activeTagNames, searchQuery })
  const ui = useListUi()
  const drag = useListDrag(model)
  const view = { model, ui, drag, canDrag: searchResults === null }

  return (
    <div className="notepad-note-list">
      <SearchBox />
      {tags.length !== 0 && <TagFilter tags={tags} />}
      <ListBody view={view} activeTagNames={activeTagNames} />
      <ListFooter />
      <ListOverlays ui={ui} />
    </div>
  )
}

/**
 * Text search runs over IPC (tags are filtered client-side). A newer query
 * supersedes a pending one; clearing the query drops the results at once.
 */
function useSearchResults(searchQuery: string): SearchResult[] | null {
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null)
  const [resultsQuery, setResultsQuery] = useState(searchQuery)
  if (resultsQuery !== searchQuery) {
    setResultsQuery(searchQuery)
    if (!searchQuery) setSearchResults(null)
  }
  const searchGenRef = useRef(0)

  useEffect(() => {
    const gen = ++searchGenRef.current
    /* v8 ignore next */
    if (!searchQuery) return
    void window.electronAPI.extensionBridge
      .invoke('terminator.notepad:search.query', { query: searchQuery, includeArchived: true })
      .then((result) => {
        if (gen !== searchGenRef.current) return
        const data = (result as { data?: SearchResult[] }).data
        if (data) setSearchResults(data)
      })
  }, [searchQuery])

  return searchResults
}

function useListUi() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null)
  const [editModal, setEditModal] = useState<EditModalState | null>(null)
  const [archivedExpanded, setArchivedExpanded] = useState(false)
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set())
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [folderDeletePending, setFolderDeletePending] = useState<string | null>(null)

  const toggleFolder = (id: string, collapsed?: boolean) =>
    setCollapsedFolderIds((prev) => {
      const next = new Set(prev)
      if (collapsed ?? !next.has(id)) next.add(id)
      else next.delete(id)
      return next
    })
  return {
    ...{ contextMenu, setContextMenu, folderContextMenu, setFolderContextMenu },
    ...{ editModal, setEditModal, archivedExpanded, setArchivedExpanded },
    ...{ collapsedFolderIds, toggleFolder, renamingFolderId, setRenamingFolderId },
    ...{ folderDeletePending, setFolderDeletePending },
  }
}

function contextMenuFor(e: React.MouseEvent, entry: MixedItem): ContextMenuState {
  const { item } = entry
  return {
    item: { id: item.id, type: entry.kind },
    title: item.title,
    tags: item.tags ?? [],
    isArchived: !!item.archivedAt,
    folderId: folderIdOf(entry),
    x: e.clientX,
    y: e.clientY,
  }
}

// ── Drag and drop ─────────────────────────────────────────────────

/** The dragged item and the two kinds of drop target. */
function useDragState() {
  const [dragged, setDragged] = useState<ItemRef | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const [folderDropTarget, setFolderDropTarget] = useState<string | null>(null)
  const endDrag = () => {
    setDragged(null)
    setDropTarget(null)
    setFolderDropTarget(null)
  }
  return {
    ...{ dragged, setDragged, dropTarget, setDropTarget },
    ...{ folderDropTarget, setFolderDropTarget, endDrag },
  }
}

/**
 * Reordering by dropping beside an item, moving into a folder by dropping on
 * its header, and out of one by dropping on the list. Rows and headers stop a
 * dragover once handled: the list behind clears every drop target on dragover.
 */
function useListDrag(model: ListModel) {
  const state = useDragState()
  return {
    state,
    rowDragProps: (item: ItemRef, canDrag: boolean) =>
      rowDragProps(item, canDrag, { model, state }),
    folderDropProps: (folderId: string) => folderDropProps(folderId, state),
    listDropHandlers: listDropHandlers(model, state),
  }
}

/** Moves the dragged item into a folder (or the root, with null), then ends the drag. */
function dropInto(state: DragState, folderId: string | null): void {
  const item = state.dragged
  state.endDrag()
  if (item) moveToFolder(item, folderId).catch(console.error)
}

function dragOverPosition(target: DropTarget | null, id: string): DragProps['dragOverPosition'] {
  if (!target || target.id !== id) return null
  if (target.before) return 'before'
  return 'after'
}

function rowDragProps(item: ItemRef, canDrag: boolean, ctx: RowDragContext) {
  const { state } = ctx
  if (!canDrag) return undefined
  const props: DragProps = {
    draggable: canDrag,
    dragOverPosition: dragOverPosition(state.dropTarget, item.id),
    onDragStart(e) {
      state.setDragged(item)
      e.dataTransfer.effectAllowed = 'move'
    },
    onDragOver: (e) => markDropBeside(e, item, state),
    onDragLeave: () => state.setDropTarget((prev) => (prev?.id === item.id ? null : prev)),
    onDrop: (e) => dropBeside(e, ctx),
    onDragEnd: state.endDrag,
  }
  return props
}

/** Marks the drop as before or after the row, by which half the pointer is over. */
function markDropBeside(e: React.DragEvent, item: ItemRef, state: DragState): void {
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  const rect = e.currentTarget.getBoundingClientRect()
  const before = e.clientY < rect.top + rect.height / 2
  state.setDropTarget((prev) =>
    prev?.id === item.id && prev.before === before ? prev : { id: item.id, before }
  )
}

function dropBeside(e: React.DragEvent, ctx: RowDragContext): void {
  const { model, state } = ctx
  e.preventDefault()
  e.stopPropagation()
  const { dragged, dropTarget } = state
  const plan = dragged && dropTarget ? planDrop(model, dragged, dropTarget) : null
  state.endDrag()
  if (dragged && plan) applyDrop(dragged, plan).catch(console.error)
}

function folderDropProps(folderId: string, state: DragState) {
  return {
    isOver: state.folderDropTarget === folderId,
    onDragOver(e: React.DragEvent) {
      if (!state.dragged) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      state.setFolderDropTarget(folderId)
      state.setDropTarget(null)
    },
    onDragLeave: () => state.setFolderDropTarget((prev) => (prev === folderId ? null : prev)),
    onDrop(e: React.DragEvent) {
      e.preventDefault()
      e.stopPropagation()
      dropInto(state, folderId)
    },
  }
}

/** Dropping on the list itself takes an item out of its folder. */
function listDropHandlers(model: ListModel, state: DragState) {
  return {
    onDragOver(e: React.DragEvent) {
      if (!state.dragged) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      state.setDropTarget(null)
      state.setFolderDropTarget(null)
    },
    onDrop(e: React.DragEvent) {
      const { dragged } = state
      if (!dragged) return
      e.preventDefault()
      const entry = model.activeItems.find((en) => en.item.id === dragged.id)
      if (folderIdOf(entry) === null) state.endDrag()
      else dropInto(state, null)
    },
  }
}

// ── Search and tag filter ─────────────────────────────────────────

function SearchBox(): React.JSX.Element {
  const { searchQuery, setQuery } = useFilterStore()
  return (
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
  )
}

function tagButtonLabel(count: number): string {
  if (count === 0) return 'Tags'
  if (count === 1) return '1 tag'
  return String(count) + ' tags'
}

/** The ref wraps the trigger too, so clicking it to close does not reopen. */
function TagFilter({ tags }: TagFilterProps): React.JSX.Element {
  const { activeTagIds, clearTags } = useFilterStore()
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  useDismissible({
    ref: dropdownRef,
    onDismiss: () => setOpen(false),
    manageFocus: false,
    enabled: open,
  })
  return (
    <div className="notepad-tag-filter" ref={dropdownRef}>
      <Button size="sm" icon={TagIcon} onClick={() => setOpen((v) => !v)}>
        {tagButtonLabel(activeTagIds.length)}
        {activeTagIds.length !== 0 && <ClearTagsButton onClear={clearTags} />}
      </Button>
      {open && <TagOptions tags={tags} />}
    </div>
  )
}

function ClearTagsButton({ onClear }: { onClear: () => void }): React.JSX.Element {
  return (
    <span
      className="notepad-tag-filter__clear-x"
      role="button"
      onMouseDown={(e) => {
        e.stopPropagation()
        onClear()
      }}
    >
      <X className="tm-icon-sm" />
    </span>
  )
}

/** Active tags first. */
function TagOptions({ tags }: TagFilterProps): React.JSX.Element {
  const { activeTagIds, toggleTag } = useFilterStore()
  const rank = (tag: Tag) => (activeTagIds.includes(tag.id) ? 0 : 1)
  return (
    <div className="notepad-tag-filter__dropdown">
      {[...tags]
        .sort((a, b) => rank(a) - rank(b))
        .map((tag) => (
          <TagOption
            key={tag.id}
            tag={tag}
            isActive={activeTagIds.includes(tag.id)}
            onToggle={() => toggleTag(tag.id)}
          />
        ))}
    </div>
  )
}

function TagOption(props: { tag: Tag; isActive: boolean; onToggle: () => void }) {
  const { tag, isActive, onToggle } = props
  const modifier = isActive ? ' notepad-tag-filter__option--active' : ''
  return (
    <button className={'notepad-tag-filter__option' + modifier} onClick={onToggle}>
      <span className="notepad-tag-filter__check">
        {isActive && <Check className="tm-icon-sm" />}
      </span>
      <span className="notepad-tag-filter__hash">#</span>
      {tag.name}
      <span className="notepad-tag-filter__count">{tag.noteCount}</span>
    </button>
  )
}

// ── List body ─────────────────────────────────────────────────────

function ListBody(props: { view: ListView; activeTagNames: string[] }): React.JSX.Element {
  const { view, activeTagNames } = props
  const { model } = view
  const folders = useNotesStore((s) => s.folders)
  const searchQuery = useFilterStore((s) => s.searchQuery)
  const isEmpty = model.activeItems.length === 0 && model.archivedItems.length === 0
  const showsNothing = isEmpty && (folders.length === 0 || model.isFiltering)

  return (
    <div className="notepad-note-list__notes" {...view.drag.listDropHandlers}>
      {showsNothing && model.isFiltering && (
        <div className="notepad-note-list__no-results">
          {noResultsText(activeTagNames, searchQuery)}
        </div>
      )}
      {showsNothing && !model.isFiltering && <EmptyState />}
      {!showsNothing && <ActiveItems view={view} folders={folders} />}
      <ArchivedSection view={view} />
    </div>
  )
}

function ActiveItems(props: { view: ListView; folders: Folder[] }): React.JSX.Element {
  const { view, folders } = props
  return (
    <>
      {view.model.rootActiveItems.map((entry) => (
        <ListRow key={entry.item.id} entry={entry} view={view} />
      ))}
      {!view.model.isFiltering &&
        folders.map((folder) => <FolderSection key={folder.id} folder={folder} view={view} />)}
    </>
  )
}

function ListRow(props: { entry: MixedItem; view: ListView; dimmed?: boolean }) {
  const { entry, view, dimmed } = props
  const item = { id: entry.item.id, type: entry.kind }
  return (
    <ItemRow
      entry={entry}
      onContextMenu={(e, en) => view.ui.setContextMenu(contextMenuFor(e, en))}
      dimmed={dimmed}
      dragProps={dimmed ? undefined : view.drag.rowDragProps(item, view.canDrag)}
    />
  )
}

function FolderSection({ folder, view }: FolderSectionProps): React.JSX.Element {
  const { ui, drag } = view
  const folderItems = itemsInFolder(view.model, folder.id)
  const isCollapsed = ui.collapsedFolderIds.has(folder.id)
  const folderDrop = drag.folderDropProps(folder.id)
  const dropModifier = folderDrop.isOver ? ' notepad-folder-header--drop-target' : ''

  return (
    <div className="notepad-folder-section">
      <div
        className={'notepad-folder-header' + dropModifier}
        onContextMenu={(e) => {
          e.preventDefault()
          const { clientX: x, clientY: y } = e
          ui.setFolderContextMenu({ folderId: folder.id, folderName: folder.name, x, y })
        }}
        onDragOver={folderDrop.onDragOver}
        onDragLeave={folderDrop.onDragLeave}
        onDrop={folderDrop.onDrop}
      >
        <FolderToggle folder={folder} view={view} count={folderItems.length} />
      </div>
      {!isCollapsed && <FolderItems items={folderItems} view={view} />}
    </div>
  )
}

function FolderItems(props: { items: MixedItem[]; view: ListView }): React.JSX.Element {
  const { items, view } = props
  return (
    <div className="notepad-folder-items">
      {items.length === 0 && <div className="notepad-folder-empty">Empty</div>}
      {items.map((entry) => (
        <ListRow key={entry.item.id} entry={entry} view={view} />
      ))}
    </div>
  )
}

function FolderToggle(props: FolderSectionProps & { count: number }): React.JSX.Element {
  const { folder, view, count } = props
  const { ui } = view
  const isCollapsed = ui.collapsedFolderIds.has(folder.id)
  const Chevron = isCollapsed ? ChevronRight : ChevronDown
  const label = (isCollapsed ? 'Expand ' : 'Collapse ') + folder.name
  return (
    <button
      aria-label={label}
      className="notepad-folder-header__toggle"
      onClick={() => ui.toggleFolder(folder.id)}
    >
      <Chevron className="tm-icon-sm" />
      <FolderIcon className="notepad-folder-header__icon tm-icon-sm" />
      {ui.renamingFolderId === folder.id ? (
        <FolderRenameInput folder={folder} ui={ui} />
      ) : (
        <span className="notepad-folder-header__name">{folder.name}</span>
      )}
      <span className="notepad-folder-header__count">{count}</span>
    </button>
  )
}

function FolderRenameInput({ folder, ui }: { folder: Folder; ui: ListUi }): React.JSX.Element {
  const commit = async (value: string) => {
    await renameFolder(folder.id, value || folder.name)
    ui.setRenamingFolderId(null)
    await loadLibrary()
  }
  return (
    <input
      className="notepad-folder-header__rename-input"
      autoFocus={true}
      defaultValue={folder.name}
      onBlur={(e) => void commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void commit(e.currentTarget.value)
        if (e.key === 'Escape') ui.setRenamingFolderId(null)
      }}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function ArchivedSection({ view }: { view: ListView }): React.JSX.Element | null {
  const { archivedItems } = view.model
  const { archivedExpanded, setArchivedExpanded } = view.ui
  if (archivedItems.length === 0) return null
  const Chevron = archivedExpanded ? ChevronDown : ChevronRight
  return (
    <>
      <button
        aria-expanded={archivedExpanded}
        type="button"
        className="notepad-archived-toggle"
        onClick={() => setArchivedExpanded((v) => !v)}
      >
        <Chevron aria-hidden="true" className="tm-icon-sm" />
        Archived ({archivedItems.length})
      </button>
      {archivedExpanded &&
        archivedItems.map((entry) => (
          <ListRow key={entry.item.id} entry={entry} view={view} dimmed={true} />
        ))}
    </>
  )
}

function ListFooter(): React.JSX.Element {
  const setShowQuickCreate = useNotesStore((s) => s.setShowQuickCreate)
  return (
    <div className="notepad-note-list__footer">
      <Button
        variant="ghost"
        size="sm"
        icon={Download}
        onClick={() => window.dispatchEvent(new CustomEvent('notepad:openExport'))}
      >
        Export
      </Button>
      <Button variant="primary" size="sm" icon={Plus} onClick={() => setShowQuickCreate(true)}>
        New <kbd className="tmui-kbd">⌘⇧N</kbd>
      </Button>
    </div>
  )
}

// ── Menus and dialogs ─────────────────────────────────────────────

function ListOverlays({ ui }: { ui: ListUi }): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const { setContextMenu, setFolderContextMenu, folderDeletePending } = ui
  useDismissible({
    ref: menuRef,
    onDismiss: () => {
      setContextMenu(null)
      setFolderContextMenu(null)
    },
    manageFocus: false,
    enabled: ui.contextMenu !== null || ui.folderContextMenu !== null,
  })

  return (
    <>
      {ui.contextMenu && <ItemContextMenu ui={ui} menuRef={menuRef} />}
      {ui.folderContextMenu && <FolderContextMenu ui={ui} menuRef={menuRef} />}
      {ui.editModal && (
        <ItemEditModal
          state={ui.editModal}
          onClose={() => ui.setEditModal(null)}
          onSaved={() => void loadLibrary()}
        />
      )}
      {folderDeletePending && <FolderDeleteConfirm ui={ui} folderId={folderDeletePending} />}
    </>
  )
}

function FolderDeleteConfirm(props: { ui: ListUi; folderId: string }): React.JSX.Element {
  const { ui, folderId } = props
  return (
    <ConfirmDialog
      title="Delete folder?"
      description="Notes and diagrams inside will be moved to the root."
      confirmLabel="Delete"
      danger={true}
      onConfirm={() => {
        ui.setFolderDeletePending(null)
        ui.toggleFolder(folderId, false)
        void deleteFolder(folderId)
      }}
      onClose={() => ui.setFolderDeletePending(null)}
    />
  )
}

function MenuItem({ onClick, danger, children }: MenuItemProps): React.JSX.Element {
  const modifier = danger ? ' notepad-context-menu__item--danger' : ''
  return (
    <button className={'notepad-context-menu__item' + modifier} onClick={onClick}>
      {children}
    </button>
  )
}

/** Closes the item menu, then acts on the item it was opened on. */
function itemMenuAction(ui: ListUi, action: (menu: ContextMenuState) => void) {
  return () => {
    const menu = ui.contextMenu
    ui.setContextMenu(null)
    if (menu) action(menu)
  }
}

function ItemContextMenu({ ui, menuRef }: MenuProps): React.JSX.Element | null {
  const menu = ui.contextMenu
  if (!menu) return null
  const editItem = ({ item, title, tags }: ContextMenuState) =>
    ui.setEditModal({ itemId: item.id, itemType: item.type, title, tags })
  return (
    <div
      ref={menuRef}
      className="notepad-context-menu"
      style={{ position: 'fixed', top: menu.y, left: menu.x }}
    >
      <MenuItem onClick={itemMenuAction(ui, editItem)}>Edit title &amp; tags</MenuItem>
      <MenuItem onClick={itemMenuAction(ui, (m) => void toggleArchived(m.item, m.isArchived))}>
        {menu.isArchived ? 'Unarchive' : 'Archive'}
      </MenuItem>
      {menu.isArchived && (
        <MenuItem
          danger={true}
          onClick={itemMenuAction(ui, (m) => void deleteForGood(m.item, true))}
        >
          Delete
        </MenuItem>
      )}
      {!menu.isArchived && <FolderMoves ui={ui} menu={menu} />}
    </div>
  )
}

function FolderContextMenu({ ui, menuRef }: MenuProps): React.JSX.Element | null {
  const menu = ui.folderContextMenu
  if (!menu) return null
  const close = (then: () => void) => () => {
    ui.setFolderContextMenu(null)
    then()
  }
  return (
    <div
      ref={menuRef}
      className="notepad-context-menu"
      style={{ position: 'fixed', top: menu.y, left: menu.x }}
    >
      <MenuItem onClick={close(() => ui.setRenamingFolderId(menu.folderId))}>Rename</MenuItem>
      <MenuItem danger={true} onClick={close(() => ui.setFolderDeletePending(menu.folderId))}>
        Delete folder
      </MenuItem>
    </div>
  )
}

function FolderMoves(props: { ui: ListUi; menu: ContextMenuState }): React.JSX.Element | null {
  const { ui, menu } = props
  const folders = useNotesStore((s) => s.folders)
  if (folders.length === 0) return null
  const moveTo = (folderId: string | null) =>
    itemMenuAction(ui, (m) => void moveToFolder(m.item, folderId))
  const inFolder = menu.folderId !== null
  return (
    <>
      <div className="notepad-context-menu__separator" />
      {inFolder && <MenuItem onClick={moveTo(null)}>Remove from folder</MenuItem>}
      {folders
        .filter((f) => f.id !== menu.folderId)
        .map((f) => (
          <MenuItem key={f.id} onClick={moveTo(f.id)}>
            Move to {f.name}
          </MenuItem>
        ))}
    </>
  )
}
