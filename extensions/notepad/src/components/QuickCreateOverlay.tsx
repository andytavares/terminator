import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useNotesStore } from '../stores/notes.store'
import { NoteEditor } from '../editor/NoteEditor'
import { noteTitle } from '../db/note-title'
import type { DiagramListItem } from '../db/types'
import { Button, ModalShell, SegmentedControl } from '@terminator/extension-ui'
import { tagEditing, withTag } from './tagEditing'
import { recordUsage } from '@terminator/extension-sdk/renderer'

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

type CreateKind = 'note' | 'diagram' | 'folder'

interface TagChipBarProps {
  tags: string[]
  tagInput: string
  tagInputRef: React.RefObject<HTMLInputElement | null>
  onTagInput: (val: string) => void
  onAddTag: (val: string) => void
  onRemoveTag: (tag: string) => void
  onTagKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
}

/** The overlay's draft and the controls that edit it. */
type QuickCreateDraft = ReturnType<typeof useQuickCreateDraft>

interface DraftProps {
  draft: QuickCreateDraft
}

interface SaveProps extends DraftProps {
  onSave: () => Promise<void>
}

function TagChipBar(props: TagChipBarProps): React.JSX.Element {
  const { tags, tagInput, tagInputRef, onAddTag, onRemoveTag, onTagInput, onTagKeyDown } = props
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
            <X className="tm-icon-sm" />
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
        onBlur={() => tagInput.trim() && onAddTag(tagInput)}
      />
    </div>
  )
}

const CREATE_KINDS = [
  { value: 'note', label: 'Note' },
  { value: 'diagram', label: 'Diagram' },
  { value: 'folder', label: 'Folder' },
] as const

/** Re-lists a collection into the store; resolves to the list, if one came back. */
async function listInto<T>(channel: string, payload: object, store: (items: T[]) => void) {
  const result = await window.electronAPI.extensionBridge.invoke(channel, payload)
  const data = (result as { data?: T[] }).data
  if (Array.isArray(data)) store(data)
  return data
}

async function createFolderAndRelist(name: string): Promise<void> {
  await window.electronAPI.extensionBridge.invoke('terminator.notepad:folders.create', { name })
  await listInto('terminator.notepad:folders.list', {}, useNotesStore.getState().setFolders)
}

interface NewNote {
  title: string
  body: string
  tags: string[]
}

async function createNoteAndRelist(note: NewNote): Promise<void> {
  await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.create', note)
  recordUsage('note-create')
  const { setNotes } = useNotesStore.getState()
  await listInto('terminator.notepad:notes.list', { includeArchived: true }, setNotes)
}

async function createDiagramAndOpen(diagram: Omit<NewNote, 'body'>): Promise<void> {
  const createResult = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:diagrams.create',
    diagram
  )
  recordUsage('diagram-create')
  const created = (createResult as { data?: { id: string } }).data
  const { setDiagrams, setSelectedDiagram } = useNotesStore.getState()
  const data = await listInto<DiagramListItem>(
    'terminator.notepad:diagrams.list',
    { includeArchived: true },
    setDiagrams
  )
  if (Array.isArray(data) && created?.id) setSelectedDiagram(created.id)
}

/** Creates the folder, diagram or note the draft describes. */
async function saveQuickNote(draft: QuickCreateDraft): Promise<void> {
  const { type, title, body } = draft
  // Includes a tag still in the input: onBlur fires before onClick, but React 18
  // batching means its setTags may not have applied yet.
  const tags = withTag(draft.tags, draft.tagInput)
  if (type === 'folder') {
    await createFolderAndRelist(title.trim())
  } else if (type === 'diagram') {
    await createDiagramAndOpen({ title: title.trim() || 'Untitled diagram', tags })
  } else {
    await createNoteAndRelist({ title: title.trim() || noteTitle(body), body, tags })
  }
}

function useQuickCreateDraft() {
  const setShowQuickCreate = useNotesStore((s) => s.setShowQuickCreate)
  const [type, setType] = useState<CreateKind>('note')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)

  const close = useCallback(() => {
    setTitle('')
    setBody('')
    setTags([])
    setTagInput('')
    setSaving(false)
    setType('note')
    setShowQuickCreate(false)
  }, [setShowQuickCreate])

  return {
    ...{ type, setType, title, setTitle, body, setBody },
    ...{ tags, setTags, tagInput, setTagInput, saving, setSaving, close },
  }
}

/** Saves the draft and closes the overlay; a folder needs a name. */
function saveHandler(draft: QuickCreateDraft) {
  return async () => {
    if (draft.saving) return
    if (draft.type === 'folder' && !draft.title.trim()) return
    draft.setSaving(true)
    try {
      await saveQuickNote(draft)
      draft.close()
    } catch (err) {
      console.error(`[notepad] QuickCreateOverlay: save ${draft.type} failed`, err)
      draft.setSaving(false)
    }
  }
}

function defaultTagsOf(values: Record<string, unknown>): string[] {
  const raw = values['terminator.notepad.defaultTags']
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

/** Starts with the configured default tags. */
function useOpenDefaults(open: boolean, draft: QuickCreateDraft) {
  const { setTags } = draft
  useEffect(() => {
    if (!open) return
    window.electronAPI.extension
      .getSettingsValues()
      .then((result) => {
        const defaults = defaultTagsOf((result as { values: Record<string, unknown> }).values)
        if (defaults.length > 0) setTags(defaults)
      })
      .catch(() => {
        /* ignore */
      })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Adding, removing and keyboard-editing the draft's tags. */
function useTagEditing(draft: QuickCreateDraft) {
  const { tags, setTags, tagInput, setTagInput } = draft
  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag))
  }
  return { ...tagEditing({ tags, updateTags: setTags, tagInput, setTagInput }), removeTag }
}

/** The modal shell counts this overlay as an open surface, so double-Escape cannot close Notepad
 *  with the draft in it, and its Escape is the dialog's own close request, which the editor
 *  stopping the key's propagation does not prevent. */
export function QuickCreateOverlay(): React.JSX.Element | null {
  const showQuickCreate = useNotesStore((s) => s.showQuickCreate)
  const draft = useQuickCreateDraft()
  const handleSave = saveHandler(draft)
  useOpenDefaults(showQuickCreate, draft)

  if (!showQuickCreate) return null
  return (
    <ModalShell
      label={draft.type === 'folder' ? 'New folder' : `New ${draft.type}`}
      className="notepad-quick-create"
      onDismiss={draft.close}
    >
      <QuickCreateHeader draft={draft} />
      <div className="notepad-quick-create__divider" />
      <TitleInput draft={draft} onSave={handleSave} />
      <div className="notepad-quick-create__divider" />
      {draft.type === 'note' && (
        <div className="notepad-quick-create__body">
          <NoteEditor key="open" initialDoc="" onChange={draft.setBody} />
        </div>
      )}
      <QuickCreateFooter draft={draft} onSave={handleSave} />
    </ModalShell>
  )
}

function QuickCreateHeader({ draft }: DraftProps): React.JSX.Element {
  return (
    <div className="notepad-quick-create__header">
      <SegmentedControl
        label="Create"
        size="sm"
        options={CREATE_KINDS}
        value={draft.type}
        onChange={draft.setType}
      />
      {draft.type === 'note' && (
        <span className="notepad-quick-create__vault-status">
          saved · exports as <code>{toFilenameSlug(draft.title)}</code>
        </span>
      )}
    </div>
  )
}

/** Focused as the dialog opens (ModalShell's autoFocus), never later: a late focus() would take
 * the keyboard back from whatever had it since, such as Quick actions opened over this. */
function TitleInput({ draft, onSave }: SaveProps): React.JSX.Element {
  return (
    <input
      autoFocus
      className="notepad-quick-create__title-input"
      placeholder="Title"
      value={draft.title}
      onChange={(e) => draft.setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void onSave()
        }
      }}
    />
  )
}

function QuickCreateFooter({ draft, onSave }: SaveProps): React.JSX.Element {
  const tagInputRef = useRef<HTMLInputElement>(null)
  const { addTag, removeTag, handleTagKeyDown } = useTagEditing(draft)
  return (
    <div className="notepad-quick-create__footer">
      {draft.type !== 'folder' && (
        <TagChipBar
          tags={draft.tags}
          tagInput={draft.tagInput}
          tagInputRef={tagInputRef}
          onTagInput={draft.setTagInput}
          onAddTag={addTag}
          onRemoveTag={removeTag}
          onTagKeyDown={handleTagKeyDown}
        />
      )}
      <div className="notepad-quick-create__footer-actions">
        <Button variant="ghost" size="sm" onClick={draft.close} disabled={draft.saving}>
          Cancel <kbd className="tmui-kbd">Esc</kbd>
        </Button>
        <Button variant="primary" size="sm" onClick={() => void onSave()} disabled={draft.saving}>
          {draft.saving ? 'Saving…' : <SaveLabel />}
        </Button>
      </div>
    </div>
  )
}

function SaveLabel(): React.JSX.Element {
  return (
    <>
      Save <kbd className="tmui-kbd">↵</kbd>
    </>
  )
}
