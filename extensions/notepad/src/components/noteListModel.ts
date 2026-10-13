// What the note list shows, worked out from the store and the filters, and the
// changes its menus and drag-and-drop make. Kept free of React so the list
// component stays a thin view over it.

import { loadLibrary, useNotesStore } from '../stores/notes.store'
import type { DiagramListItem, NoteListItem, SearchResult, Tag } from '../db/types'

export type ItemKind = 'note' | 'diagram'
type ListedNote = NoteListItem | SearchResult

export type MixedItem =
  | { kind: 'note'; item: ListedNote }
  | { kind: 'diagram'; item: DiagramListItem }

/** An item as the list's menus and drag-and-drop refer to it. */
export interface ItemRef {
  id: string
  type: ItemKind
}

/** Every tag in use, with how many notes and diagrams carry it. */
export function tagsInUse(notes: NoteListItem[], diagrams: DiagramListItem[]): Tag[] {
  const counts = new Map<string, number>()
  const allTagSources = [...notes.flatMap((n) => n.tags), ...diagrams.flatMap((d) => d.tags)]
  for (const name of allTagSources) counts.set(name, (counts.get(name) ?? 0) + 1)
  return Array.from(counts, ([name, noteCount]) => ({ id: `local:${name}`, name, noteCount }))
}

/** The names of the active tag filters, for filtering client-side. */
export function activeTagNamesOf(activeTagIds: string[], tags: Tag[]): string[] {
  return activeTagIds
    .map((id) => {
      const t = tags.find((tg) => tg.id === id)
      return t?.name ?? (id.startsWith('local:') ? id.slice(6) : null)
    })
    .filter((n): n is string => n !== null)
}

function hasAnyTag(tags: string[], names: string[]): boolean {
  return names.length === 0 || names.some((name) => tags.includes(name))
}

/** Diagrams are always filtered client-side: by tag, then by title or tag text. */
function filterDiagrams(diagrams: DiagramListItem[], tagNames: string[], query: string) {
  const q = query.toLowerCase()
  return diagrams
    .filter((d) => hasAnyTag(d.tags, tagNames))
    .filter(
      (d) =>
        !q || d.title.toLowerCase().includes(q) || d.tags.some((t) => t.toLowerCase().includes(q))
    )
}

function sortOrderOf(entry: MixedItem): number {
  return ('sortOrder' in entry.item ? entry.item.sortOrder : undefined) ?? 0
}

/** Notes and diagrams together, by sort order and then most recently updated. */
function mergeSorted(notes: ListedNote[], diagrams: DiagramListItem[]): MixedItem[] {
  const mixed: MixedItem[] = [
    ...notes.map((n) => ({ kind: 'note' as const, item: n })),
    ...diagrams.map((d) => ({ kind: 'diagram' as const, item: d })),
  ]
  return mixed.sort((a, b) => {
    const order = sortOrderOf(a) - sortOrderOf(b)
    if (order !== 0) return order
    return b.item.updatedAt.localeCompare(a.item.updatedAt)
  })
}

export function folderIdOf(entry: MixedItem | undefined): string | null {
  if (!entry || !('folderId' in entry.item)) return null
  return entry.item.folderId ?? null
}

/** What the filters ask of the list. */
export interface ListFilters {
  /** Text search results, or null when there is no text search. */
  searchResults: SearchResult[] | null
  activeTagNames: string[]
  searchQuery: string
}

export interface ListModel {
  activeItems: MixedItem[]
  archivedItems: MixedItem[]
  /** Active items outside any folder, or every active item while filtering. */
  rootActiveItems: MixedItem[]
  isFiltering: boolean
}

/** The list's items: text search via IPC, tag filters client-side. */
export function buildListModel(
  notes: NoteListItem[],
  diagrams: DiagramListItem[],
  filters: ListFilters
): ListModel {
  const { searchResults, activeTagNames, searchQuery } = filters
  const noteItems = (searchResults ?? notes).filter((n) => hasAnyTag(n.tags, activeTagNames))
  const diagramItems = filterDiagrams(diagrams, activeTagNames, searchQuery)
  const activeItems = mergeSorted(
    noteItems.filter((n) => !n.archivedAt),
    diagramItems.filter((d) => !d.archivedAt)
  )
  const archivedItems = mergeSorted(
    noteItems.filter((n) => n.archivedAt),
    diagramItems.filter((d) => d.archivedAt)
  )
  const isFiltering = searchResults !== null || activeTagNames.length > 0
  // When filtering, show everything flat. When not filtering, split by folder.
  const rootActiveItems = isFiltering
    ? activeItems
    : activeItems.filter((e) => folderIdOf(e) === null)
  return { activeItems, archivedItems, rootActiveItems, isFiltering }
}

export function itemsInFolder(model: ListModel, folderId: string): MixedItem[] {
  return model.activeItems.filter((e) => folderIdOf(e) === folderId)
}

/** Explains an empty filtered list. */
export function noResultsText(activeTagNames: string[], searchQuery: string): string {
  let text = 'No results'
  if (activeTagNames.length > 0) text += ` for ${activeTagNames.map((n) => `#${n}`).join(', ')}`
  if (searchQuery && activeTagNames.length > 0) text += ` matching "${searchQuery}"`
  else if (searchQuery) text += ` for "${searchQuery}"`
  return text
}

/** Where a dragged item is dropped: beside another item, before or after it. */
export interface DropTarget {
  id: string
  before: boolean
}

/** The order to write after a drop, and the folder the dropped item now belongs to. */
export interface DropPlan {
  newOrder: ItemRef[]
  dropFolderId: string | null
  /** The item stayed in its folder (or at the root). */
  sameGroup: boolean
}

/** Reorders the group the drop target is in, moving the dragged item into it. */
export function planDrop(model: ListModel, dragged: ItemRef, target: DropTarget): DropPlan | null {
  const draggedFolderId = folderIdOf(model.activeItems.find((en) => en.item.id === dragged.id))
  const dropFolderId = folderIdOf(model.activeItems.find((en) => en.item.id === target.id))
  const baseItems =
    dropFolderId === null ? model.rootActiveItems : itemsInFolder(model, dropFolderId)
  const ordered: ItemRef[] = baseItems.map((en) => ({ id: en.item.id, type: en.kind }))
  if (!ordered.some((i) => i.id === target.id)) return null

  const newOrder = ordered.filter((i) => i.id !== dragged.id)
  const newDropIdx = newOrder.findIndex((i) => i.id === target.id)
  newOrder.splice(target.before ? newDropIdx : newDropIdx + 1, 0, dragged)
  return { newOrder, dropFolderId, sameGroup: draggedFolderId === dropFolderId }
}

/** Writes a drop: the new order, and the folder move when the item changed group. */
export async function applyDrop(dragged: ItemRef, plan: DropPlan): Promise<void> {
  const bridge = window.electronAPI.extensionBridge
  const ops: Promise<unknown>[] = [
    bridge.invoke('terminator.notepad:notes.reorder', { items: plan.newOrder }),
  ]
  if (!plan.sameGroup) {
    ops.push(
      bridge.invoke('terminator.notepad:folders.move', {
        items: [dragged],
        folderId: plan.dropFolderId,
      })
    )
  }
  await Promise.all(ops)
  await loadLibrary()
}

/** Moves an item into a folder, or out to the root with null. */
export async function moveToFolder(item: ItemRef, folderId: string | null): Promise<void> {
  await window.electronAPI.extensionBridge
    .invoke('terminator.notepad:folders.move', { items: [item], folderId })
    .catch(console.error)
  await loadLibrary()
}

function channelBase(type: ItemKind): string {
  return type === 'diagram' ? 'terminator.notepad:diagrams' : 'terminator.notepad:notes'
}

export async function toggleArchived(item: ItemRef, isArchived: boolean): Promise<void> {
  const action = isArchived ? 'restore' : 'archive'
  await window.electronAPI.extensionBridge
    .invoke(`${channelBase(item.type)}.${action}`, { id: item.id })
    .catch(console.error)
  await loadLibrary()
}

/** Deletes an archived item for good, once confirmed, and drops it from the selection. */
export async function deleteForGood(item: ItemRef, isArchived: boolean): Promise<void> {
  if (!isArchived) {
    window.alert(`Archive this ${item.type} before deleting it.`)
    return
  }
  const ok = window.confirm(`Permanently delete this ${item.type}? This cannot be undone.`)
  if (!ok) return
  await window.electronAPI.extensionBridge
    .invoke(`${channelBase(item.type)}.hardDelete`, { id: item.id })
    .catch(console.error)
  const store = useNotesStore.getState()
  if (item.type === 'note' && store.selectedNoteId === item.id) store.setSelected(null)
  if (item.type === 'diagram' && store.selectedDiagramId === item.id) {
    store.setSelectedDiagram(null)
  }
  await loadLibrary()
}

/** Renames a folder; the caller reloads the lists once it has closed the rename. */
export async function renameFolder(folderId: string, name: string): Promise<void> {
  await window.electronAPI.extensionBridge
    .invoke('terminator.notepad:folders.rename', { id: folderId, name })
    .catch(console.error)
}

export async function deleteFolder(folderId: string): Promise<void> {
  await window.electronAPI.extensionBridge
    .invoke('terminator.notepad:folders.delete', { id: folderId })
    .catch(console.error)
  await loadLibrary()
}
