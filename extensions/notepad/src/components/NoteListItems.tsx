// A row in the note list, for a note or a diagram, and the dialog that edits
// an item's title and tags.

import React, { useRef, useState } from 'react'
import { LayoutTemplate, X } from 'lucide-react'
import { Dialog, RelativeTime } from '@terminator/extension-ui'
import { useNotesStore } from '../stores/notes.store'
import type { ItemKind, MixedItem } from './noteListModel'
import { tagEditing } from './tagEditing'

/** The drag-and-drop wiring of one row. */
export interface DragProps {
  draggable: boolean
  dragOverPosition: 'before' | 'after' | null
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}

interface ItemRowProps {
  entry: MixedItem
  onContextMenu: (e: React.MouseEvent, entry: MixedItem) => void
  dimmed?: boolean
  dragProps?: DragProps
}

/** What an item is being edited to. */
export interface EditModalState {
  itemId: string
  itemType: ItemKind
  title: string
  tags: string[]
}

interface ItemEditModalProps {
  state: EditModalState
  onClose: () => void
  onSaved: () => void
}

interface TagChipInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
}

/** The row's selection and its double-click window, by kind. */
const ROW_KINDS = {
  note: {
    modifier: '',
    openChannel: 'terminator.notepad:notes.openWindow',
    selectItem: (id: string) => useNotesStore.getState().setSelected(id),
  },
  diagram: {
    modifier: ' notepad-note-row--diagram',
    openChannel: 'terminator.notepad:diagrams.openWindow',
    selectItem: (id: string) => useNotesStore.getState().setSelectedDiagram(id),
  },
}

function noteRowClassName(entry: MixedItem, isSelected: boolean, props: ItemRowProps): string {
  const position = props.dragProps?.dragOverPosition
  return [
    'notepad-note-row',
    ROW_KINDS[entry.kind].modifier,
    isSelected ? ' notepad-note-row--selected' : '',
    props.dimmed ? ' notepad-note-row--dimmed' : '',
    position ? ` notepad-note-row--drag-over-${position}` : '',
  ].join('')
}

/** A note or diagram: click selects it, double-click opens it in its own window. */
export function NoteOrDiagramRow(props: ItemRowProps): React.JSX.Element {
  const { entry, dragProps } = props
  const kind = ROW_KINDS[entry.kind]
  const selectedId = useNotesStore((s) =>
    entry.kind === 'note' ? s.selectedNoteId : s.selectedDiagramId
  )
  const isSelected = selectedId === entry.item.id
  return (
    <button
      aria-selected={isSelected}
      className={noteRowClassName(entry, isSelected, props)}
      draggable={dragProps?.draggable}
      onClick={() => kind.selectItem(entry.item.id)}
      onDoubleClick={() => {
        window.electronAPI.extensionBridge
          .invoke(kind.openChannel, { id: entry.item.id })
          .catch(console.error)
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        props.onContextMenu(e, entry)
      }}
      {...dragHandlers(dragProps)}
    >
      <ItemRowText entry={entry} />
    </button>
  )
}

function dragHandlers(dragProps: DragProps | undefined) {
  return {
    onDragStart: dragProps?.onDragStart,
    onDragOver: dragProps?.onDragOver,
    onDragLeave: dragProps?.onDragLeave,
    onDrop: dragProps?.onDrop,
    onDragEnd: dragProps?.onDragEnd,
  }
}

function ItemRowText({ entry }: { entry: MixedItem }): React.JSX.Element {
  const tagList = entry.item.tags ?? []
  return (
    <>
      <div className="notepad-note-row__title">
        {entry.kind === 'diagram' && (
          <LayoutTemplate className="notepad-note-row__diagram-icon tm-icon-sm" />
        )}
        {entry.item.title}
      </div>
      <div className="notepad-note-row__meta-line">
        <span className="notepad-note-row__time">
          <RelativeTime value={entry.item.updatedAt} />
        </span>
        <InlineTags tags={tagList} />
      </div>
    </>
  )
}

function InlineTags({ tags }: { tags: string[] }): React.JSX.Element | null {
  if (tags.length === 0) return null
  return (
    <>
      <span className="notepad-note-row__dot">·</span>
      <span className="notepad-note-row__tags-inline">
        {tags
          .slice(0, 3)
          .map((t) => `#${t}`)
          .join(' ')}
      </span>
    </>
  )
}

/** The tag being typed: Enter or comma adds it, Backspace on empty removes the last. */
function useTagDraft({ tags, onChange }: TagChipInputProps) {
  const [tagInput, setTagInput] = useState('')
  const applyTagChange = (change: (tags: string[]) => string[]) => {
    const next = change(tags)
    if (next !== tags) onChange(next)
  }
  return {
    tagInput,
    setTagInput,
    ...tagEditing({ tags, updateTags: applyTagChange, tagInput, setTagInput }),
  }
}

function TagChipInput(props: TagChipInputProps): React.JSX.Element {
  const { tags, onChange } = props
  const { tagInput, setTagInput, addTag, handleTagKeyDown } = useTagDraft(props)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="notepad-tag-chip-input" onClick={() => inputRef.current?.focus()}>
      <TagChips tags={tags} onChange={onChange} />
      <input
        ref={inputRef}
        className="notepad-tag-chip-input__field"
        placeholder={tags.length === 0 ? 'Add tags…' : ''}
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        onKeyDown={handleTagKeyDown}
        onBlur={() => tagInput.trim() && addTag(tagInput)}
      />
    </div>
  )
}

function TagChips({ tags, onChange }: TagChipInputProps): React.JSX.Element {
  return (
    <>
      {tags.map((tag) => (
        <span key={tag} className="notepad-tag-chip-input__chip">
          {tag}
          <button
            aria-label={`Remove tag ${tag}`}
            type="button"
            className="notepad-tag-chip-input__remove"
            onClick={(e) => {
              e.stopPropagation()
              onChange(tags.filter((t) => t !== tag))
            }}
          >
            <X className="tm-icon-sm" />
          </button>
        </span>
      ))}
    </>
  )
}

/** Saves the edited title and tags; a note keeps its stored body. */
async function saveItemEdit(state: EditModalState, title: string, tags: string[]) {
  const bridge = window.electronAPI.extensionBridge
  if (state.itemType === 'diagram') {
    await bridge.invoke('terminator.notepad:diagrams.autosave', {
      id: state.itemId,
      title: title.trim() || 'Untitled diagram',
      tags,
    })
    return
  }
  const noteResult = await bridge.invoke('terminator.notepad:notes.get', { id: state.itemId })
  const body = (noteResult as { data?: { body: string } }).data?.body ?? ''
  await bridge.invoke('terminator.notepad:notes.autosave', {
    id: state.itemId,
    title: title.trim() || 'Untitled note',
    body,
    tags,
    // Editing only the tags leaves a derived title deriving.
    titleSetByHand: title.trim() !== state.title,
  })
}

/** The edited title and tags, and saving them once. */
function useItemEdit(props: ItemEditModalProps) {
  const { state, onClose, onSaved } = props
  const [title, setTitle] = useState(state.title)
  const [tags, setTags] = useState(state.tags)
  const [saving, setSaving] = useState(false)

  async function submitItemEdit() {
    if (saving) return
    setSaving(true)
    try {
      await saveItemEdit(state, title, tags)
      onSaved()
      onClose()
    } catch (err) {
      console.error('[notepad] edit item failed', err)
      setSaving(false)
    }
  }
  return { title, setTitle, tags, setTags, saving, submitItemEdit }
}

function editDialogActions(saving: boolean, onClose: () => void, onSave: () => Promise<void>) {
  return [
    { label: 'Cancel', onSelect: onClose, disabled: saving },
    {
      label: saving ? 'Saving…' : 'Save',
      tone: 'primary' as const,
      submit: true,
      shortcut: '↵',
      disabled: saving,
      onSelect: onSave,
    },
  ]
}

export function ItemEditModal(props: ItemEditModalProps): React.JSX.Element {
  const { state, onClose } = props
  const { title, setTitle, tags, setTags, saving, submitItemEdit } = useItemEdit(props)
  return (
    <Dialog
      title={state.itemType === 'diagram' ? 'Edit diagram' : 'Edit note'}
      onDismiss={onClose}
      actions={editDialogActions(saving, onClose, submitItemEdit)}
    >
      <div className="notepad-edit-fields">
        <input
          aria-label="Title"
          autoFocus={true}
          className="notepad-input"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <TagChipInput tags={tags} onChange={setTags} />
      </div>
    </Dialog>
  )
}
