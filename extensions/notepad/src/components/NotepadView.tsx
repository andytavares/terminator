import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { loadLibrary, useNotesStore } from '../stores/notes.store'
import { useEditorStore } from '../stores/editor.store'
import { useCommentsStore } from '../stores/comments.store'
import { NoteList } from './NoteList'
import { NoteOutline } from './NoteOutline'
import { EmptyState } from './EmptyState'
import { DiagramView } from './DiagramView'
import { CommentMargin } from './CommentMargin'
import { CommentComposer } from './CommentComposer'
import { ExportDialog } from './ExportDialog'
import { SearchOverlay } from './SearchOverlay'
import {
  NoteEditor,
  applyExternalDoc,
  scrollToAnchor,
  scrollToPosition,
  setEditorHoverAnchor,
  type SelectionAnchor,
} from '../editor/NoteEditor'
import { ORIGIN_ID, onForeignNoteChange } from '../editor/noteSync'
import type { Comment } from '../db/types'
import { adoptLoadedComments, reanchorAfterSave } from './comment-anchors'
import { useCommentCards } from './use-comment-cards'
import { noteTitle } from '../db/note-title'

const AUTOSAVE_DELAY_MS = 800
const ANCHOR_DEBOUNCE_MS = 2000

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

export function NotepadView(): React.JSX.Element {
  const [showExport, setShowExport] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showComments, setShowComments] = useState(true)
  const [showOutline, setShowOutline] = useState(true)
  const [readingMode, setReadingMode] = useState(false)
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null)
  const [pendingAnchor, setPendingAnchor] = useState<SelectionAnchor | null>(null)
  const [composingAnchor, setComposingAnchor] = useState<SelectionAnchor | null>(null)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentHover, setCommentHover] = useState<{ id: string; top: number } | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { selectedNoteId, selectedDiagramId, notes, setNotes, setShowQuickCreate } = useNotesStore()
  const {
    bodyDraft,
    isDirty,
    saveStatus,
    previewMode,
    setActiveNote,
    markDirty,
    markSaving,
    markSaved,
    markError,
    togglePreviewMode,
  } = useEditorStore()
  const { comments, setComments } = useCommentsStore()
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const { editorViewRef, onEditorReady, cards, commentPanelRef } = useCommentCards(
    comments,
    selectedNoteId
  )
  const editorWrapRef = useRef<HTMLDivElement>(null)

  // Load note + diagram + folder lists on mount
  useEffect(() => {
    void loadLibrary()
  }, [])

  // Load selected note body and comments
  useEffect(() => {
    if (!selectedNoteId) return
    const noteId = selectedNoteId
    activeIdRef.current = noteId
    // Clear stale comments immediately so the previous note's anchors don't
    // get applied to the newly mounted editor before the new note loads.
    setComments([])

    async function loadNoteAndComments() {
      try {
        // Use the in-session body cache when available so content is never lost
        // due to a race between a cleanup flush and this DB read.
        const cachedBody = useNotesStore.getState().bodyCache[noteId]

        const [bodyResult, commentsResult] = await Promise.all([
          cachedBody !== undefined
            ? Promise.resolve({ data: { body: cachedBody } })
            : window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.get', {
                id: noteId,
              }),
          window.electronAPI.extensionBridge.invoke('terminator.notepad:comments.list', {
            noteId: noteId,
            includeResolved: true,
          }),
        ])

        const note = (bodyResult as { data?: { body: string } }).data
        if (!note || activeIdRef.current !== noteId) return
        // Populate the cache on first DB fetch so future navigate-backs skip the round-trip
        if (cachedBody === undefined) {
          useNotesStore.getState().setBodyCache(noteId, note.body)
        }
        setActiveNote(noteId, note.body)
        setLoadedNoteId(noteId)

        const allComments = (commentsResult as { data?: Comment[] }).data ?? []
        anchorTimer.current = adoptLoadedComments(
          { comments: allComments, body: note.body },
          anchorTimer.current,
          ANCHOR_DEBOUNCE_MS
        )
      } catch (err) {
        console.error('[notepad] Failed to load note', err)
      }
    }

    void loadNoteAndComments()

    return () => {
      // Flush pending autosave for this note before switching to another.
      // Check isDirty first — if the timer already fired but the save is still
      // in-flight (or failed), autosaveTimer.current may be null while isDirty
      // is still true, so we must not gate the flush on the timer alone.
      const { bodyDraft, isDirty } = useEditorStore.getState()
      if (isDirty) {
        if (autosaveTimer.current) {
          clearTimeout(autosaveTimer.current)
          autosaveTimer.current = null
        }
        // Cache the body optimistically so navigate-back never reads stale DB data
        // even if this fire-and-forget flush races with the next notes.get call.
        useNotesStore.getState().setBodyCache(selectedNoteId, bodyDraft)
        const n = useNotesStore.getState().notes.find((x) => x.id === selectedNoteId)
        const title = noteTitle(bodyDraft)
        window.electronAPI.extensionBridge
          .invoke('terminator.notepad:notes.autosave', {
            id: selectedNoteId,
            title,
            body: bodyDraft,
            tags: n?.tags ?? [],
            originId: ORIGIN_ID,
          })
          .catch((err) => console.error('[notepad] flush autosave failed', err))
      } else if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
      }
    }
  }, [selectedNoteId, setActiveNote, setComments])

  // Adopt bodies saved by another surface (a popped-out note window) so the
  // panel never serves — or re-saves — a stale copy of the same note.
  useEffect(() => {
    return onForeignNoteChange((event) => {
      useNotesStore.getState().setBodyCache(event.id, event.body)
      useNotesStore.getState().patchNote(event.id, {
        title: event.title,
        updatedAt: event.updatedAt,
        bodyPreview: event.body.slice(0, 120),
        tags: event.tags,
      })
      if (event.id !== activeIdRef.current) return
      // A local edit still in flight is newer than this push — leave it alone;
      // its own save will win and re-broadcast.
      if (useEditorStore.getState().isDirty) return
      applyExternalDoc(editorViewRef.current, event.body)
      setActiveNote(event.id, event.body)
    })
  }, [setActiveNote, editorViewRef])

  const scheduleAutosave = useCallback(
    (newBody: string) => {
      if (!selectedNoteId) return
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(async () => {
        markSaving()
        const note = notes.find((n) => n.id === selectedNoteId)
        const derivedTitle = noteTitle(newBody)
        try {
          await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.autosave', {
            id: selectedNoteId,
            title: derivedTitle,
            body: newBody,
            tags: note?.tags ?? [],
            originId: ORIGIN_ID,
          })
          markSaved()
          // Keep the sidebar and body cache in sync so navigate-back never loses content
          const savedAt = new Date().toISOString()
          useNotesStore.getState().patchNote(selectedNoteId, {
            title: derivedTitle,
            updatedAt: savedAt,
            bodyPreview: newBody.slice(0, 120),
          })
          useNotesStore.getState().setBodyCache(selectedNoteId, newBody)

          // Re-check anchors after save against the live editor body, not the
          // stale newBody captured at debounce time — the user may have typed
          // more during the IPC round-trip.
          const liveBody = useEditorStore.getState().bodyDraft
          await reanchorAfterSave(liveBody)
        } catch (err) {
          console.error('[notepad] Autosave failed', err)
          markError()
        }
      }, AUTOSAVE_DELAY_MS)
    },
    [selectedNoteId, notes, markSaving, markSaved, markError]
  )

  function handleEditorChange(newBody: string) {
    markDirty(newBody)
    scheduleAutosave(newBody)
  }

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      if (anchorTimer.current) clearTimeout(anchorTimer.current)
      if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    }
  }, [])

  // Cmd+Alt+M toggles the comment margin. Handled here rather than via globalShortcut so it
  // fires only while Terminator is focused and this view is mounted. The chord matches the
  // CommandOrControl+Alt+M accelerator this replaced — keep them in sync so the binding
  // users already know does not silently move.
  //
  // Matched on e.code, not e.key: on macOS Option+M emits the dead-key character 'µ', so an
  // e.key === 'm' comparison never fires while Alt is held.
  useEffect(() => {
    function onToggleComments() {
      setShowComments((v) => !v)
    }
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyM') {
        e.preventDefault()
        onToggleComments()
      }
    }
    window.addEventListener('notepad:toggleComments', onToggleComments)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('notepad:toggleComments', onToggleComments)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  useEffect(() => {
    function onToggleEditorMode() {
      setReadingMode((v) => !v)
    }
    window.addEventListener('notepad:toggleEditorMode', onToggleEditorMode)
    return () => window.removeEventListener('notepad:toggleEditorMode', onToggleEditorMode)
  }, [])

  useEffect(() => {
    function onOpenExport() {
      setShowExport(true)
    }
    window.addEventListener('notepad:openExport', onOpenExport)
    return () => window.removeEventListener('notepad:openExport', onOpenExport)
  }, [])

  // Cmd+Shift+F opens search overlay
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Listen for open-in-window push: activate notepad tab and select the note
  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on(
      'terminator.notepad:selectNote',
      (data: unknown) => {
        const id = (data as { id?: string })?.id
        // The tab activation is the main process's job and it already does it
        // (index.ts broadcasts extension:activate-global-tab). Calling the core
        // registry from here reached a *copy* of that store bundled into this
        // view, so it moved nothing.
        if (id) useNotesStore.getState().setSelected(id)
      }
    )
    return off
  }, [])

  function scheduleHoverHide() {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverHideTimer.current = setTimeout(() => setCommentHover(null), 200)
  }

  function cancelHoverHide() {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
  }

  function handleEditorMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const anchor = target.closest('[data-comment-id]') as HTMLElement | null
    if (anchor) {
      const id = anchor.dataset.commentId
      if (id) {
        cancelHoverHide()
        const anchorRect = anchor.getBoundingClientRect()
        const wrapRect = editorWrapRef.current?.getBoundingClientRect()
        if (wrapRect) {
          setCommentHover({ id, top: anchorRect.top - wrapRect.top })
        }
        return
      }
    }
  }

  function handleGoToComment(id: string) {
    cancelHoverHide()
    setCommentHover(null)
    setActiveCommentId(id)
    setTimeout(() => setActiveCommentId(null), 1600)
  }

  function saveStatusLabel(): string {
    if (isDirty) return 'Unsaved'
    if (saveStatus === 'saving') return 'Saving…'
    if (saveStatus === 'saved') return 'Saved'
    if (saveStatus === 'error') return 'Save failed'
    return ''
  }

  const { diagrams } = useNotesStore.getState()
  if (notes.length === 0 && diagrams.length === 0) {
    return (
      <div className="notepad-view notepad-view--empty-screen">
        {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
        <EmptyState
          onNewNote={() => setShowQuickCreate(true)}
          onImport={() =>
            void importNotes(async () => {
              const result = await window.electronAPI.extensionBridge.invoke(
                'terminator.notepad:notes.list',
                { includeArchived: true }
              )
              const data = (result as { data?: unknown[] }).data
              if (Array.isArray(data)) setNotes(data as Parameters<typeof setNotes>[0])
            })
          }
        />
      </div>
    )
  }

  // When a diagram is selected, render the canvas view in place of the editor pane
  if (selectedDiagramId) {
    return (
      <div className="notepad-view">
        {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
        <div className="notepad-view__sidebar">
          <NoteList />
        </div>
        <div className="notepad-view__editor notepad-view__editor--diagram">
          <DiagramView key={selectedDiagramId} diagramId={selectedDiagramId} />
        </div>
      </div>
    )
  }

  return (
    <div className="notepad-view">
      {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
      <div className="notepad-view__sidebar">
        <NoteList />
      </div>
      <div className="notepad-view__editor">
        <div className="notepad-view__toolbar">
          <span className="notepad-view__save-status">{saveStatusLabel()}</span>
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
            onClick={() => setReadingMode((v) => !v)}
            title={readingMode ? 'Switch to edit mode' : 'Switch to reading mode'}
          >
            {readingMode ? 'Edit' : 'Read'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowOutline((v) => !v)}
            title={showOutline ? 'Hide the heading outline' : 'Show the heading outline'}
          >
            {showOutline ? 'Hide outline' : 'Outline'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowComments((v) => !v)}
            title={showComments ? 'Hide comments' : 'Show comments'}
          >
            {showComments ? 'Hide comments' : 'Show comments'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setShowExport(true)}>
            Export
          </Button>
        </div>
        {showExport && (
          <ExportDialog onClose={() => setShowExport(false)} noteId={selectedNoteId ?? undefined} />
        )}
        {selectedNoteId ? (
          <div
            ref={editorWrapRef}
            className="notepad-view__editor-wrap"
            onMouseOver={handleEditorMouseOver}
            onMouseLeave={scheduleHoverHide}
          >
            <NoteEditor
              key={loadedNoteId}
              initialDoc={bodyDraft}
              onChange={handleEditorChange}
              onAnchorsReady={onEditorReady}
              onSelectionChange={(sel) => {
                setPendingAnchor(sel)
                if (!sel) setComposingAnchor(null)
              }}
              readOnly={readingMode}
              sourceMode={!previewMode}
            />
            {pendingAnchor && !composingAnchor && (
              <button
                className="notepad-add-comment-btn"
                style={{ top: pendingAnchor.lineTop }}
                title="Add comment"
                onMouseDown={(e) => {
                  e.preventDefault()
                  setComposingAnchor(pendingAnchor)
                  setPendingAnchor(null)
                }}
              >
                <MessageSquarePlus className="tm-icon" />
              </button>
            )}
            {commentHover && (
              <div
                className="notepad-comment-hover-btn"
                style={{ top: commentHover.top }}
                onMouseEnter={cancelHoverHide}
                onMouseLeave={scheduleHoverHide}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleGoToComment(commentHover.id)
                }}
              >
                View comment
              </div>
            )}
          </div>
        ) : (
          <div className="notepad-view__no-selection">Select a note to start editing</div>
        )}
      </div>
      <div
        className="notepad-view__rail"
        hidden={!selectedNoteId || (!showOutline && !showComments)}
      >
        {selectedNoteId && showOutline && (
          <NoteOutline
            onSelect={(pos) => scrollToPosition(editorViewRef.current, pos)}
            onClose={() => setShowOutline(false)}
          />
        )}
        <div className="notepad-view__comments" ref={commentPanelRef} hidden={!showComments}>
          {selectedNoteId && (
            <>
              {composingAnchor && (
                <CommentComposer
                  anchor={{
                    noteId: selectedNoteId,
                    from: composingAnchor.from,
                    to: composingAnchor.to,
                    quote: composingAnchor.quote,
                    prefix: composingAnchor.prefix,
                    suffix: composingAnchor.suffix,
                  }}
                  onClose={() => setComposingAnchor(null)}
                  onCreated={() => {
                    setComposingAnchor(null)
                    window.electronAPI.extensionBridge
                      .invoke('terminator.notepad:comments.list', { noteId: selectedNoteId })
                      .then((r) => {
                        const data = (r as { data?: Comment[] }).data
                        if (data) setComments(data)
                      })
                      .catch(console.error)
                  }}
                />
              )}
              <CommentMargin
                noteId={selectedNoteId}
                anchorTops={cards.tops}
                containerHeight={cards.contentHeight}
                activeCommentId={activeCommentId}
                onCommentClick={(from, to) => scrollToAnchor(editorViewRef.current, from, to)}
                onHoverComment={(id) => setEditorHoverAnchor(editorViewRef.current, id)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
