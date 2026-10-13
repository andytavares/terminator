import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@terminator/extension-ui'
import type { EditorView } from '@codemirror/view'
import { useEditorStore } from '../stores/editor.store'
import { useCommentsStore } from '../stores/comments.store'
import { NoteOutline } from './NoteOutline'
import { NoteEditor, applyExternalDoc, scrollToPosition } from '../editor/NoteEditor'
import { ORIGIN_ID, onForeignNoteChange } from '../editor/noteSync'
import {
  AUTOSAVE_DELAY_MS,
  reanchorAfterSave,
  reanchorComments,
  schedulePersist,
} from './noteComments'
import {
  CommentColumn,
  EditorCommentOverlays,
  applyStoredAnchors,
  hoveredAnchor,
  useCommentCards,
  useCommentDraft,
  useCommentHover,
  useMarginScrollSync,
  type ViewRef,
} from './noteSurface'
import type { Comment } from '../db/types'
import { noteTitle } from '../db/note-title'

const NOTE_ID = new URLSearchParams(window.location.search).get('noteId') ?? ''

interface NoteData {
  id: string
  title: string
  body: string
  tags: string[]
}

type SetNote = React.Dispatch<React.SetStateAction<NoteData | null>>
type TimerRef = React.MutableRefObject<ReturnType<typeof setTimeout> | null>

function setWindowTitle(title: string): void {
  document.title = title || 'Note'
}

export function NoteWindowView(): React.JSX.Element {
  const noteWindow = useNoteWindow()
  const { note, loadError } = noteWindow

  if (loadError) {
    return <div className="notepad-window-loading">{loadError}</div>
  }
  if (!note) {
    return <div className="notepad-window-loading">Loading…</div>
  }

  return (
    <div className="notepad-window">
      <WindowTitlebar note={note} noteWindow={noteWindow} />
      <div className="notepad-window__body">
        <WindowEditorPane noteWindow={noteWindow} note={note} />
        <WindowRail noteWindow={noteWindow} />
      </div>
    </div>
  )
}

function WindowRail({ noteWindow }: { noteWindow: NoteWindow }): React.JSX.Element {
  const { showOutline, setShowOutline, editorViewRef, commentPanelRef, draft } = noteWindow
  const { anchorTops, panelContentHeight, activeCommentId } = noteWindow
  return (
    <div className="notepad-view__rail">
      {showOutline && (
        <NoteOutline
          onSelect={(pos) => scrollToPosition(editorViewRef.current, pos)}
          onClose={() => setShowOutline(false)}
        />
      )}
      <div className="notepad-view__comments" ref={commentPanelRef}>
        <CommentColumn
          noteId={NOTE_ID}
          draft={draft}
          viewRef={editorViewRef}
          anchorTops={anchorTops}
          containerHeight={panelContentHeight}
          activeCommentId={activeCommentId}
        />
      </div>
    </div>
  )
}

/** The window's note, its comments and their layout, and saving. */
function useNoteWindow() {
  const [note, setNote] = useState<NoteData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(NOTE_ID ? null : 'No note ID provided')
  const [showOutline, setShowOutline] = useState(true)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const comments = useCommentsStore((s) => s.comments)
  const editorViewRef: ViewRef = useRef<EditorView | null>(null)
  const commentPanelRef = useRef<HTMLDivElement>(null)

  useLoadWindowNote(setNote, setLoadError)
  const cards = useCommentCards(editorViewRef, comments, {
    noteId: NOTE_ID,
    panelRef: commentPanelRef,
  })
  useMarginScrollSync(editorViewRef, commentPanelRef, note)
  useAdoptPanelSaves(editorViewRef, setNote)
  const scheduleAutosave = useWindowAutosave(note, setNote, editorViewRef)

  return {
    ...{ note, loadError, showOutline, setShowOutline, activeCommentId, setActiveCommentId },
    ...{ editorViewRef, commentPanelRef, scheduleAutosave, ...cards },
    ...{ draft: useCommentDraft(), hover: useCommentHover() },
  }
}

type NoteWindow = ReturnType<typeof useNoteWindow>

/** Loads the note named in the URL with its comments, re-anchoring them to its body. */
function useLoadWindowNote(setNote: SetNote, setLoadError: (error: string) => void) {
  const anchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (!NOTE_ID) return
    loadWindowNote(anchorTimerRef)
      .then((data) => (data ? setNote(data) : setLoadError('Note not found')))
      .catch((err) => setLoadError(String(err)))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

async function loadWindowNote(anchorTimerRef: TimerRef): Promise<NoteData | null> {
  const bridge = window.electronAPI.extensionBridge
  const [noteResult, commentsResult] = await Promise.all([
    bridge.invoke('terminator.notepad:notes.get', { id: NOTE_ID }),
    bridge.invoke('terminator.notepad:comments.list', { noteId: NOTE_ID, includeResolved: true }),
  ])
  const data = (noteResult as { data?: NoteData }).data
  if (!data) return null
  useEditorStore.getState().setActiveNote(data.id, data.body)
  setWindowTitle(data.title)

  const reanchored = reanchorComments(
    (commentsResult as { data?: Comment[] }).data ?? [],
    data.body
  )
  useCommentsStore.getState().setComments(reanchored.comments)
  schedulePersist(anchorTimerRef, reanchored)
  return data
}

/**
 * Adopts bodies saved by the docked panel so this window and the panel never
 * hold different content for the same note. A local edit still in flight
 * outranks the push.
 */
function useAdoptPanelSaves(editorViewRef: ViewRef, setNote: SetNote): void {
  useEffect(() => {
    return onForeignNoteChange((event) => {
      if (event.id !== NOTE_ID) return
      if (useEditorStore.getState().isDirty) return
      applyExternalDoc(editorViewRef.current, event.body)
      useEditorStore.getState().setActiveNote(event.id, event.body)
      setNote((n) => (n ? { ...n, title: event.title, tags: event.tags } : n))
      setWindowTitle(event.title)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Saves an edit once typing pauses; a failure is left for the main window to retry. */
function useWindowAutosave(note: NoteData | null, setNote: SetNote, editorViewRef: ViewRef) {
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  return useCallback(
    (newBody: string) => {
      if (!note) return
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = setTimeout(async () => {
        const title = await saveWindowNote(note, newBody)
        if (title === null) return
        setNote((n) => (n ? { ...n, title } : n))
        setWindowTitle(title)
        useEditorStore.getState().markSaved()
        await reanchorAfterSave(editorViewRef.current?.state.doc.toString() ?? newBody)
      }, AUTOSAVE_DELAY_MS)
    },
    [note] // eslint-disable-line react-hooks/exhaustive-deps
  )
}

/** Resolves to the saved title, or null when the save failed. */
async function saveWindowNote(note: NoteData, body: string): Promise<string | null> {
  useEditorStore.getState().markSaving()
  const title = noteTitle(body)
  try {
    const saved = await window.electronAPI.extensionBridge.invoke(
      'terminator.notepad:notes.autosave',
      { id: note.id, title, body, tags: note.tags, originId: ORIGIN_ID }
    )
    // A title set by hand is kept by the save, so the stored one is shown.
    return (saved as { data?: { title?: string } }).data?.title ?? title
  } catch {
    return null
  }
}

interface WindowTitlebarProps {
  note: NoteData
  noteWindow: NoteWindow
}

function WindowTitlebar({ note, noteWindow }: WindowTitlebarProps): React.JSX.Element {
  const { saveStatus } = useEditorStore()
  const statusLabel = { saving: 'Saving…', saved: 'Saved' }[saveStatus as string] ?? ''
  return (
    <div className="notepad-window__titlebar">
      <span className="notepad-window__title">{note.title || 'Untitled'}</span>
      <div className="notepad-window__titlebar-right">
        <ViewModeButtons noteWindow={noteWindow} />
        <NoteTags tags={note.tags} />
        <span className={`notepad-window__status notepad-window__status--${saveStatus}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  )
}

function ViewModeButtons({ noteWindow }: { noteWindow: NoteWindow }): React.JSX.Element {
  const { showOutline, setShowOutline } = noteWindow
  const { previewMode, togglePreviewMode } = useEditorStore()
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={togglePreviewMode}
        title={previewMode ? 'Show raw markdown source' : 'Show the rendered live preview'}
      >
        {previewMode ? 'Markdown' : 'Live'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowOutline((v) => !v)}
        title={showOutline ? 'Hide the heading outline' : 'Show the heading outline'}
      >
        {showOutline ? 'Hide outline' : 'Outline'}
      </Button>
    </>
  )
}

function NoteTags({ tags }: { tags: string[] }): React.JSX.Element | null {
  if (tags.length === 0) return null
  return (
    <div className="notepad-window__tags">
      {tags.map((t) => (
        <span key={t} className="notepad-window__tag">
          #{t}
        </span>
      ))}
    </div>
  )
}

/** A local edit marks the note unsaved, so it outranks a foreign push, and schedules its save. */
function windowEditorCallbacks(noteWindow: NoteWindow) {
  const { editorViewRef, scheduleAutosave } = noteWindow
  return {
    onChange: (newBody: string) => {
      useEditorStore.getState().markDirty(newBody)
      scheduleAutosave(newBody)
    },
    onAnchorsReady: (getView: () => EditorView | null) => {
      editorViewRef.current = getView()
      if (editorViewRef.current) applyStoredAnchors(editorViewRef.current)
    },
  }
}

/** The view-comment button is positioned from the card layout, level with its card. */
function WindowEditorPane(props: { noteWindow: NoteWindow; note: NoteData }): React.JSX.Element {
  const { noteWindow, note } = props
  const { draft, hover, anchorTops, setActiveCommentId } = noteWindow
  const { bodyDraft, previewMode } = useEditorStore()
  const { onChange, onAnchorsReady } = windowEditorCallbacks(noteWindow)

  function handleEditorMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const hovered = hoveredAnchor(e)
    if (!hovered) return
    hover.cancelHoverHide()
    hover.setCommentHover({ id: hovered.id, top: anchorTops[hovered.id] ?? 0 })
  }

  return (
    <div
      className="notepad-view__editor-wrap"
      onMouseOver={handleEditorMouseOver}
      onMouseLeave={hover.scheduleHoverHide}
    >
      <NoteEditor
        key={note.id}
        initialDoc={bodyDraft}
        onChange={onChange}
        onAnchorsReady={onAnchorsReady}
        onSelectionChange={draft.onSelectionChange}
        sourceMode={!previewMode}
      />
      <EditorCommentOverlays draft={draft} hover={hover} onGoToComment={setActiveCommentId} />
    </div>
  )
}
