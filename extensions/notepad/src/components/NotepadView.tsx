import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { loadLibrary, useNotesStore } from '../stores/notes.store'
import { useEditorStore } from '../stores/editor.store'
import { useCommentsStore } from '../stores/comments.store'
import { NoteList } from './NoteList'
import { NoteOutline } from './NoteOutline'
import { EmptyState } from './EmptyState'
import { DiagramView } from './DiagramView'
import { ExportDialog } from './ExportDialog'
import { SearchOverlay } from './SearchOverlay'
import { NoteEditor, applyExternalDoc, scrollToPosition } from '../editor/NoteEditor'
import { ORIGIN_ID, onForeignNoteChange } from '../editor/noteSync'
import { reanchorAfterSave, reanchorComments, schedulePersist } from './noteComments'
import { useNotepadSettings, useNotepadSettingsStore } from '../stores/settings.store'
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
import type { EditorView } from '@codemirror/view'
import type { Comment, NoteListItem } from '../db/types'
import { noteTitle } from '../db/note-title'

type TimerRef = React.MutableRefObject<ReturnType<typeof setTimeout> | null>

/** Which of the panel's optional surfaces are showing. */
type PanelToggles = ReturnType<typeof usePanelToggles>

async function importNotes(onDone: () => void): Promise<void> {
  const result = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:export.pickFolder',
    {}
  )
  const folder = (result as { data: string | null }).data
  if (!folder) return
  await window.electronAPI.extensionBridge
    .invoke('terminator.notepad:import.run', { folder })
    .catch(console.error)
  onDone()
}

async function reloadNoteList(): Promise<void> {
  const result = await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.list', {
    includeArchived: true,
  })
  const data = (result as { data?: NoteListItem[] }).data
  if (Array.isArray(data)) useNotesStore.getState().setNotes(data)
}

export function NotepadView(): React.JSX.Element {
  const toggles = usePanelToggles()
  useNotepadSettings()
  const { selectedNoteId, selectedDiagramId, notes, diagrams } = useNotesStore()
  // The session outlives the editor pane: it flushes an edit when a diagram is
  // opened and keeps cached bodies current while none is showing.
  const session = useNoteSession(selectedNoteId)
  useNotepadShortcuts(toggles)
  useListsAndSelectionPush()

  const search = toggles.showSearch && (
    <SearchOverlay onClose={() => toggles.setShowSearch(false)} />
  )
  if (notes.length === 0 && diagrams.length === 0) {
    return <EmptyNotepad search={search} />
  }

  if (selectedDiagramId) return <DiagramWorkspace search={search} diagramId={selectedDiagramId} />
  return <NoteWorkspace toggles={toggles} search={search} session={session} />
}

/** A selected diagram's canvas, in place of the editor pane. */
function DiagramWorkspace(props: { search: React.ReactNode; diagramId: string }) {
  const { search, diagramId } = props
  return (
    <div className="notepad-view">
      {search}
      <div className="notepad-view__sidebar">
        <NoteList />
      </div>
      <div className="notepad-view__editor notepad-view__editor--diagram">
        <DiagramView key={diagramId} diagramId={diagramId} />
      </div>
    </div>
  )
}

function usePanelToggles() {
  const [showExport, setShowExport] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showComments, setShowComments] = useState(true)
  const [showOutline, setShowOutline] = useState(true)
  const [readingMode, setReadingMode] = useState(false)
  return {
    ...{ showExport, setShowExport, showSearch, setShowSearch },
    ...{ showComments, setShowComments, showOutline, setShowOutline, readingMode, setReadingMode },
  }
}

function EmptyNotepad({ search }: { search: React.ReactNode }): React.JSX.Element {
  const setShowQuickCreate = useNotesStore((s) => s.setShowQuickCreate)
  return (
    <div className="notepad-view notepad-view--empty-screen">
      {search}
      <EmptyState
        onNewNote={() => setShowQuickCreate(true)}
        onImport={() => void importNotes(() => void reloadNoteList())}
      />
    </div>
  )
}

/** Cmd+Alt+M toggles the comment margin and Cmd+Shift+F opens search, only while this view is
 *  focused. Matched on e.code, not e.key: macOS Option+M types 'µ'. Why not globalShortcut, and
 *  why the chord must stay: README.md, "Why the editor behaves as it does". */
function useNotepadShortcuts(toggles: PanelToggles): void {
  const { setShowComments, setReadingMode, setShowExport, setShowSearch } = toggles
  useEffect(() => {
    const handlers: Record<string, () => void> = {
      'notepad:toggleComments': () => setShowComments((v) => !v),
      'notepad:toggleEditorMode': () => setReadingMode((v) => !v),
      'notepad:openExport': () => setShowExport(true),
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const action = shortcutAction(e)
      if (!action) return
      e.preventDefault()
      if (action === 'comments') handlers['notepad:toggleComments']()
      else setShowSearch(true)
    }
    for (const name of Object.keys(handlers)) window.addEventListener(name, handlers[name])
    document.addEventListener('keydown', onKeyDown)
    return () => {
      for (const name of Object.keys(handlers)) window.removeEventListener(name, handlers[name])
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [setShowComments, setReadingMode, setShowExport, setShowSearch])
}

function shortcutAction(e: KeyboardEvent): 'comments' | 'search' | null {
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.altKey && e.code === 'KeyM') return 'comments'
  // With Shift held, Control reports the capital letter
  // (https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/key).
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') return 'search'
  return null
}

/** Loads the lists on mount; the open-in-window push selects its note. The main process activates
 *  the tab: a call to the core registry from here reached a bundled copy and moved nothing. */
function useListsAndSelectionPush(): void {
  useEffect(() => {
    void loadLibrary()
  }, [])
  useEffect(() => {
    return window.electronAPI.extensionBridge.on(
      'terminator.notepad:selectNote',
      (data: unknown) => {
        const id = (data as { id?: string })?.id
        if (id) useNotesStore.getState().setSelected(id)
      }
    )
  }, [])
}

interface NoteWorkspaceProps {
  toggles: PanelToggles
  search: React.ReactNode
  session: NoteSession
}

/** The sidebar, the open note's editor, and its outline and comment rail. */
function NoteWorkspace({ toggles, search, session }: NoteWorkspaceProps) {
  const { selectedNoteId } = session
  return (
    <div className="notepad-view">
      {search}
      <div className="notepad-view__sidebar">
        <NoteList />
      </div>
      <div className="notepad-view__editor">
        <NotepadToolbar toggles={toggles} />
        {toggles.showExport && (
          <ExportDialog
            onClose={() => toggles.setShowExport(false)}
            noteId={selectedNoteId ?? undefined}
          />
        )}
        {selectedNoteId ? (
          <NoteEditorPane session={session} readingMode={toggles.readingMode} />
        ) : (
          <div className="notepad-view__no-selection">Select a note to start editing</div>
        )}
      </div>
      <NotepadRail session={session} toggles={toggles} />
    </div>
  )
}

/** The open note's editor state: its body, autosave, comments and their layout. */
function useNoteSession(selectedNoteId: string | null) {
  const comments = useCommentsStore((s) => s.comments)
  const editorViewRef: ViewRef = useRef<EditorView | null>(null)
  const commentPanelRef = useRef<HTMLDivElement>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const draft = useCommentDraft()
  const hover = useCommentHover()
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)

  const cards = useCommentCards(editorViewRef, comments, { noteId: selectedNoteId })
  useMarginScrollSync(editorViewRef, commentPanelRef, selectedNoteId)
  const loadedNoteId = useOpenNote(selectedNoteId, autosaveTimerRef, activeIdRef)
  useForeignNoteAdoption(activeIdRef, editorViewRef)
  const scheduleAutosave = useAutosave(selectedNoteId, autosaveTimerRef)

  return {
    ...{ selectedNoteId, loadedNoteId, editorViewRef, commentPanelRef, scheduleAutosave },
    ...{ draft, hover, activeCommentId, setActiveCommentId, ...cards },
  }
}

type NoteSession = ReturnType<typeof useNoteSession>

/** Loads the selected note's body and comments, and flushes an unsaved edit on leaving a note.
 *  Resolves to the id of the note whose body is in the editor. */
function useOpenNote(noteId: string | null, autosaveTimerRef: TimerRef, activeIdRef: IdRef) {
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null)
  const anchorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!noteId) return
    activeIdRef.current = noteId
    // Clear stale comments immediately so the previous note's anchors don't
    // get applied to the newly mounted editor before the new note loads.
    useCommentsStore.getState().setComments([])
    loadNoteAndComments(noteId, { activeIdRef, anchorTimerRef, onLoaded: setLoadedNoteId }).catch(
      (err) => console.error('[notepad] Failed to load note', err)
    )
    return () => flushUnsavedNote(noteId, autosaveTimerRef)
  }, [noteId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => clearTimers([autosaveTimerRef, anchorTimerRef])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return loadedNoteId
}

type IdRef = React.MutableRefObject<string | null>

/** Where a note load records what it opened. */
interface NoteLoad {
  activeIdRef: IdRef
  anchorTimerRef: TimerRef
  onLoaded: (noteId: string) => void
}

/** Reads the body from the in-session cache when there is one, so a cleanup flush cannot race
 *  this read, then re-anchors the comments to it. Does nothing once another note is open. */
async function loadNoteAndComments(noteId: string, load: NoteLoad): Promise<void> {
  const { activeIdRef, anchorTimerRef } = load
  const cachedBody = useNotesStore.getState().bodyCache[noteId]
  const [note, commentsResult] = await Promise.all([
    readNoteBody(noteId, cachedBody),
    window.electronAPI.extensionBridge.invoke('terminator.notepad:comments.list', {
      noteId,
      includeResolved: true,
    }),
  ])

  if (!note || activeIdRef.current !== noteId) return
  // Populate the cache on first DB fetch so future navigate-backs skip the round-trip
  if (cachedBody === undefined) useNotesStore.getState().setBodyCache(noteId, note.body)
  useEditorStore.getState().setActiveNote(noteId, note.body)
  load.onLoaded(noteId)

  const reanchored = reanchorComments(
    (commentsResult as { data?: Comment[] }).data ?? [],
    note.body
  )
  useCommentsStore.getState().setComments(reanchored.comments)
  schedulePersist(anchorTimerRef, reanchored)
}

async function readNoteBody(noteId: string, cachedBody: string | undefined) {
  if (cachedBody !== undefined) return { body: cachedBody }
  const result = await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.get', {
    id: noteId,
  })
  return (result as { data?: { body: string } }).data
}

/** Stops the pending timers, as the view goes away. */
function clearTimers(timers: TimerRef[]): void {
  for (const timer of timers) if (timer.current) clearTimeout(timer.current)
}

/** Checks isDirty, not the timer: a fired timer whose save is in flight or failed is null while
 *  the edit is unsaved. The body is cached so navigating back never reads stale DB data. */
function flushUnsavedNote(noteId: string, autosaveTimerRef: TimerRef): void {
  const { bodyDraft, isDirty } = useEditorStore.getState()
  if (autosaveTimerRef.current) {
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = null
  }
  if (!isDirty) return
  useNotesStore.getState().setBodyCache(noteId, bodyDraft)
  const n = useNotesStore.getState().notes.find((x) => x.id === noteId)
  window.electronAPI.extensionBridge
    .invoke('terminator.notepad:notes.autosave', {
      id: noteId,
      title: noteTitle(bodyDraft),
      body: bodyDraft,
      tags: n?.tags ?? [],
      originId: ORIGIN_ID,
    })
    .catch((err) => console.error('[notepad] flush autosave failed', err))
}

/** Adopts bodies another surface saved, so the panel never serves or re-saves a stale copy. A
 *  local edit in flight is newer, so it is left alone: its own save wins and re-broadcasts. */
function useForeignNoteAdoption(activeIdRef: IdRef, editorViewRef: ViewRef): void {
  useEffect(() => {
    return onForeignNoteChange((event) => {
      const notesStore = useNotesStore.getState()
      notesStore.setBodyCache(event.id, event.body)
      notesStore.patchNote(event.id, {
        title: event.title,
        updatedAt: event.updatedAt,
        bodyPreview: event.body.slice(0, 120),
        tags: event.tags,
      })
      if (event.id !== activeIdRef.current) return
      if (useEditorStore.getState().isDirty) return
      applyExternalDoc(editorViewRef.current, event.body)
      useEditorStore.getState().setActiveNote(event.id, event.body)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Saves an edit once typing pauses. */
function useAutosave(noteId: string | null, autosaveTimerRef: TimerRef) {
  return useCallback(
    (newBody: string) => {
      if (!noteId) return
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = setTimeout(
        () => void autosaveNote(noteId, newBody),
        useNotepadSettingsStore.getState().autosaveMs
      )
    },
    [noteId] // eslint-disable-line react-hooks/exhaustive-deps
  )
}

/** Saves the body, then keeps the sidebar and body cache in step and re-anchors comments. */
async function autosaveNote(noteId: string, body: string): Promise<void> {
  const editor = useEditorStore.getState()
  editor.markSaving()
  const note = useNotesStore.getState().notes.find((n) => n.id === noteId)
  const derivedTitle = noteTitle(body)
  try {
    const saved = await window.electronAPI.extensionBridge.invoke(
      'terminator.notepad:notes.autosave',
      { id: noteId, title: derivedTitle, body, tags: note?.tags ?? [], originId: ORIGIN_ID }
    )
    editor.markSaved()
    const notesStore = useNotesStore.getState()
    notesStore.patchNote(noteId, {
      // A title set by hand is kept by the save, so the stored one is shown.
      title: (saved as { data?: { title?: string } }).data?.title ?? derivedTitle,
      updatedAt: new Date().toISOString(),
      bodyPreview: body.slice(0, 120),
    })
    notesStore.setBodyCache(noteId, body)
    await reanchorAfterSave(useEditorStore.getState().bodyDraft)
  } catch (err) {
    console.error('[notepad] Autosave failed', err)
    editor.markError()
  }
}

function saveStatusLabel(isDirty: boolean, saveStatus: string): string {
  if (isDirty) return 'Unsaved'
  if (saveStatus === 'saving') return 'Saving…'
  if (saveStatus === 'saved') return 'Saved'
  if (saveStatus === 'error') return 'Save failed'
  return ''
}

interface ToggleButtonProps {
  on: boolean
  onClick: () => void
  labels: [on: string, off: string]
  titles: [on: string, off: string]
}

function ToggleButton(props: ToggleButtonProps): React.JSX.Element {
  const { on, onClick, labels, titles } = props
  return (
    <Button variant="ghost" size="sm" onClick={onClick} title={on ? titles[0] : titles[1]}>
      {on ? labels[0] : labels[1]}
    </Button>
  )
}

function NotepadToolbar({ toggles }: { toggles: PanelToggles }): React.JSX.Element {
  const { isDirty, saveStatus, previewMode, togglePreviewMode } = useEditorStore()
  return (
    <div className="notepad-view__toolbar">
      <span className="notepad-view__save-status">{saveStatusLabel(isDirty, saveStatus)}</span>
      <ToggleButton
        on={previewMode}
        onClick={togglePreviewMode}
        labels={['Markdown', 'Live']}
        titles={['Show raw markdown source', 'Show the rendered live preview']}
      />
      <PanelToggleButtons toggles={toggles} />
      <Button variant="ghost" size="sm" onClick={() => toggles.setShowExport(true)}>
        Export
      </Button>
    </div>
  )
}

function PanelToggleButtons({ toggles }: { toggles: PanelToggles }): React.JSX.Element {
  const { readingMode, showOutline, showComments } = toggles
  return (
    <>
      <ToggleButton
        on={readingMode}
        onClick={() => toggles.setReadingMode((v) => !v)}
        labels={['Edit', 'Read']}
        titles={['Switch to edit mode', 'Switch to reading mode']}
      />
      <ToggleButton
        on={showOutline}
        onClick={() => toggles.setShowOutline((v) => !v)}
        labels={['Hide outline', 'Outline']}
        titles={['Hide the heading outline', 'Show the heading outline']}
      />
      <ToggleButton
        on={showComments}
        onClick={() => toggles.setShowComments((v) => !v)}
        labels={['Hide comments', 'Show comments']}
        titles={['Hide comments', 'Show comments']}
      />
    </>
  )
}

/** Shows "View comment" over the hovered anchor; going to a comment flashes its card. */
function useAnchorHover(session: NoteSession, editorWrapRef: React.RefObject<HTMLDivElement>) {
  const { hover, setActiveCommentId } = session

  function handleEditorMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const hovered = hoveredAnchor(e)
    if (!hovered) return
    hover.cancelHoverHide()
    const wrapRect = editorWrapRef.current?.getBoundingClientRect()
    const anchorRect = hovered.anchor.getBoundingClientRect()
    if (wrapRect) hover.setCommentHover({ id: hovered.id, top: anchorRect.top - wrapRect.top })
  }

  function goToComment(id: string) {
    hover.cancelHoverHide()
    hover.setCommentHover(null)
    setActiveCommentId(id)
    setTimeout(() => setActiveCommentId(null), 1600)
  }

  return { handleEditorMouseOver, goToComment }
}

/** A local edit marks the note unsaved and schedules its save; a new view gets the highlights. */
function editorCallbacks(session: NoteSession) {
  return {
    onChange: (newBody: string) => {
      useEditorStore.getState().markDirty(newBody)
      session.scheduleAutosave(newBody)
    },
    onAnchorsReady: (getView: () => EditorView | null) => {
      const v = getView()
      session.editorViewRef.current = v
      if (v && session.selectedNoteId) applyStoredAnchors(v)
    },
  }
}

function NoteEditorPane(props: { session: NoteSession; readingMode: boolean }) {
  const { session } = props
  const editorWrapRef = useRef<HTMLDivElement>(null)
  const { handleEditorMouseOver, goToComment } = useAnchorHover(session, editorWrapRef)

  return (
    <div
      ref={editorWrapRef}
      className="notepad-view__editor-wrap"
      onMouseOver={handleEditorMouseOver}
      onMouseLeave={session.hover.scheduleHoverHide}
    >
      {/* Mounted once the selected note's body is in: an editor mounted before then
          is replaced when it arrives, and what was typed into it is lost. */}
      {session.loadedNoteId === session.selectedNoteId && (
        <LoadedNoteEditor {...props} onGoToComment={goToComment} />
      )}
    </div>
  )
}

interface LoadedNoteEditorProps {
  session: NoteSession
  readingMode: boolean
  onGoToComment: (commentId: string) => void
}

/** The editor on the loaded note's body, with its comment overlays. */
function LoadedNoteEditor({ session, readingMode, onGoToComment }: LoadedNoteEditorProps) {
  const { draft, hover } = session
  const { bodyDraft, previewMode } = useEditorStore()
  const { onChange, onAnchorsReady } = editorCallbacks(session)
  return (
    <>
      <NoteEditor
        key={session.loadedNoteId}
        initialDoc={bodyDraft}
        onChange={onChange}
        onAnchorsReady={onAnchorsReady}
        onSelectionChange={draft.onSelectionChange}
        readOnly={readingMode}
        sourceMode={!previewMode}
      />
      <EditorCommentOverlays draft={draft} hover={hover} onGoToComment={onGoToComment} />
    </>
  )
}

function NotepadRail(props: { session: NoteSession; toggles: PanelToggles }) {
  const { session, toggles } = props
  const { selectedNoteId, editorViewRef, commentPanelRef } = session
  const { showOutline, showComments } = toggles
  return (
    <div className="notepad-view__rail" hidden={!selectedNoteId || (!showOutline && !showComments)}>
      {selectedNoteId && showOutline && (
        <NoteOutline
          onSelect={(pos) => scrollToPosition(editorViewRef.current, pos)}
          onClose={() => toggles.setShowOutline(false)}
        />
      )}
      <div className="notepad-view__comments" ref={commentPanelRef} hidden={!showComments}>
        {selectedNoteId && (
          <CommentColumn
            noteId={selectedNoteId}
            draft={session.draft}
            viewRef={editorViewRef}
            anchorTops={session.anchorTops}
            containerHeight={session.panelContentHeight}
            activeCommentId={session.activeCommentId}
          />
        )}
      </div>
    </div>
  )
}
