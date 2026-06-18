import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useNotesStore } from '../stores/notes.store'
import { useEditorStore } from '../stores/editor.store'
import { useCommentsStore } from '../stores/comments.store'
import { NoteList } from './NoteList'
import { EmptyState } from './EmptyState'
import { CommentMargin } from './CommentMargin'
import { CommentComposer } from './CommentComposer'
import { ExportDialog } from './ExportDialog'
import { SearchOverlay } from './SearchOverlay'
import {
  NoteEditor,
  applyAnchors,
  scrollToAnchor,
  setEditorHoverAnchor,
  type SelectionAnchor,
} from '../editor/NoteEditor'
import { reanchorComment } from '../editor/reanchor'
import type { EditorView } from '@codemirror/view'
import type { Comment } from '../db/types'

const AUTOSAVE_DELAY_MS = 800
const ANCHOR_DEBOUNCE_MS = 2000
const CARD_HEIGHT_EST = 110
const CARD_GAP = 8

async function importNotes(): Promise<void> {
  const result = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:export.pickFolder',
    {}
  )
  const folder = (result as { data: string | null }).data
  if (!folder) return
  await window.electronAPI.extensionBridge
    .invoke('terminator.notepad:import.run', { folder })
    .catch(console.error)
}

export function NotepadView(): React.JSX.Element {
  const [showExport, setShowExport] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showComments, setShowComments] = useState(true)
  const [readingMode, setReadingMode] = useState(false)
  const [pendingAnchor, setPendingAnchor] = useState<SelectionAnchor | null>(null)
  const [composingAnchor, setComposingAnchor] = useState<SelectionAnchor | null>(null)
  const [anchorTops, setAnchorTops] = useState<Record<string, number>>({})
  const [panelContentHeight, setPanelContentHeight] = useState(0)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentHover, setCommentHover] = useState<{ id: string; top: number } | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { selectedNoteId, notes, setNotes, setShowQuickCreate } = useNotesStore()
  const { bodyDraft, isDirty, saveStatus, setActiveNote, markDirty, markSaving, markSaved } =
    useEditorStore()
  const { comments, setComments } = useCommentsStore()
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activeIdRef = useRef<string | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const commentPanelRef = useRef<HTMLDivElement>(null)
  const editorWrapRef = useRef<HTMLDivElement>(null)

  // Load note list on mount
  useEffect(() => {
    async function loadList() {
      try {
        const result = await window.electronAPI.extensionBridge.invoke(
          'terminator.notepad:notes.list',
          { includeArchived: true }
        )
        const data = (result as { data?: unknown[] }).data
        if (Array.isArray(data)) {
          setNotes(data as Parameters<typeof setNotes>[0])
        }
      } catch (err) {
        console.error('[notepad] Failed to load note list', err)
      }
    }
    void loadList()
  }, [setNotes])

  // Push-down layout for comment cards
  const computeAnchorTops = useCallback((view: EditorView, commentList: Comment[]) => {
    requestAnimationFrame(() => {
      const scrollTop = view.scrollDOM.scrollTop
      const rect = view.scrollDOM.getBoundingClientRect()

      type Target = { id: string; targetTop: number; createdAt: string }
      const targets: Target[] = []

      for (const c of commentList) {
        if (c.startOffset !== null && c.parentId === null && c.status !== 'orphaned') {
          const pos = Math.min(c.startOffset, Math.max(0, view.state.doc.length - 1))
          try {
            const coords = view.coordsAtPos(pos)
            if (coords) {
              targets.push({
                id: c.id,
                targetTop: coords.top - rect.top + scrollTop,
                createdAt: c.createdAt,
              })
            }
          } catch {
            /* out of viewport */
          }
        }
      }

      targets.sort((a, b) => a.targetTop - b.targetTop || a.createdAt.localeCompare(b.createdAt))

      const tops: Record<string, number> = {}
      let prevBottom = 0
      for (const t of targets) {
        const top = Math.max(t.targetTop, prevBottom + CARD_GAP)
        tops[t.id] = top
        prevBottom = top + CARD_HEIGHT_EST
      }

      setAnchorTops(tops)
      const lastTop = Object.values(tops).reduce((max, v) => Math.max(max, v), 0)
      setPanelContentHeight(Math.max(view.scrollDOM.scrollHeight, lastTop + CARD_HEIGHT_EST + 20))
    })
  }, [])

  // Re-apply anchors + recompute whenever comments change
  useEffect(() => {
    const view = editorViewRef.current
    if (!view || !selectedNoteId) return

    const validAnchors = comments
      .filter((c) => c.parentId === null && c.status !== 'orphaned')
      .map((c) => ({ id: c.id, from: c.startOffset ?? 0, to: c.endOffset ?? 0 }))
      .filter((a) => a.from < a.to)

    applyAnchors(view, validAnchors)
    computeAnchorTops(view, comments)
  }, [comments, selectedNoteId, computeAnchorTops])

  // Sync comment panel scroll with editor scroll
  useEffect(() => {
    if (!selectedNoteId) return
    let removeScroll: (() => void) | undefined
    const t = setTimeout(() => {
      const view = editorViewRef.current
      const panel = commentPanelRef.current
      if (!view || !panel) return
      function onEditorScroll() {
        if (panel) panel.scrollTop = view.scrollDOM.scrollTop
      }
      view.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true })
      removeScroll = () => view.scrollDOM.removeEventListener('scroll', onEditorScroll)
    }, 100)
    return () => {
      clearTimeout(t)
      removeScroll?.()
    }
  }, [selectedNoteId])

  // Load selected note body and comments
  useEffect(() => {
    if (!selectedNoteId) return
    activeIdRef.current = selectedNoteId

    async function loadNoteAndComments() {
      try {
        const [noteResult, commentsResult] = await Promise.all([
          window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.get', {
            id: selectedNoteId,
          }),
          window.electronAPI.extensionBridge.invoke('terminator.notepad:comments.list', {
            noteId: selectedNoteId,
          }),
        ])

        const note = (noteResult as { data?: { body: string } }).data
        if (!note || activeIdRef.current !== selectedNoteId) return
        setActiveNote(selectedNoteId, note.body)

        const allComments = (commentsResult as { data?: Comment[] }).data ?? []
        const anchorUpdates: { id: string; newFrom: number; newTo: number }[] = []
        const orphanIds: string[] = []

        for (const comment of allComments) {
          if (comment.parentId !== null || comment.status === 'orphaned') continue
          const result = reanchorComment(comment, note.body)
          if (result.status === 'orphaned') {
            orphanIds.push(comment.id)
          } else if (result.newFrom !== undefined && result.newTo !== undefined) {
            anchorUpdates.push({ id: comment.id, newFrom: result.newFrom, newTo: result.newTo })
          }
        }

        // Apply reanchored offsets immediately so the editor and margin reflect correct positions
        if (anchorUpdates.length > 0) {
          const updatedMap = new Map(anchorUpdates.map((u) => [u.id, u]))
          setComments(
            allComments.map((c) => {
              const upd = updatedMap.get(c.id)
              return upd ? { ...c, startOffset: upd.newFrom, endOffset: upd.newTo } : c
            })
          )
        } else {
          setComments(allComments)
        }

        if (anchorUpdates.length > 0 || orphanIds.length > 0) {
          if (anchorTimer.current) clearTimeout(anchorTimer.current)
          anchorTimer.current = setTimeout(async () => {
            await Promise.all([
              ...anchorUpdates.map((u) =>
                window.electronAPI.extensionBridge
                  .invoke('terminator.notepad:comments.updateAnchor', {
                    id: u.id,
                    startOffset: u.newFrom,
                    endOffset: u.newTo,
                  })
                  .catch((err) => console.error('[notepad] updateAnchor failed', err))
              ),
              ...orphanIds.map((id) =>
                window.electronAPI.extensionBridge
                  .invoke('terminator.notepad:comments.markOrphaned', { id })
                  .catch((err) => console.error('[notepad] markOrphaned failed', err))
              ),
            ])
          }, ANCHOR_DEBOUNCE_MS)
        }
      } catch (err) {
        console.error('[notepad] Failed to load note', err)
      }
    }

    void loadNoteAndComments()
  }, [selectedNoteId, setActiveNote, setComments])

  const scheduleAutosave = useCallback(
    (newBody: string) => {
      if (!selectedNoteId) return
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(async () => {
        markSaving()
        const note = notes.find((n) => n.id === selectedNoteId)
        try {
          await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.autosave', {
            id: selectedNoteId,
            title: note?.title ?? '',
            body: newBody,
            tags: note?.tags ?? [],
          })
          markSaved()

          // Re-check anchors after save — body may have changed enough to orphan a comment
          const currentComments = useCommentsStore.getState().comments
          const orphanIds: string[] = []
          const anchorUpdates: { id: string; newFrom: number; newTo: number }[] = []

          for (const comment of currentComments) {
            if (comment.parentId !== null || comment.status === 'orphaned') continue
            const result = reanchorComment(comment, newBody)
            if (result.status === 'orphaned') {
              orphanIds.push(comment.id)
            } else if (result.newFrom !== undefined && result.newTo !== undefined) {
              anchorUpdates.push({ id: comment.id, newFrom: result.newFrom, newTo: result.newTo })
            }
          }

          if (orphanIds.length > 0 || anchorUpdates.length > 0) {
            const updatedMap = new Map(anchorUpdates.map((u) => [u.id, u]))
            useCommentsStore.getState().setComments(
              currentComments.map((c) => {
                if (orphanIds.includes(c.id)) return { ...c, status: 'orphaned' as const }
                const upd = updatedMap.get(c.id)
                return upd ? { ...c, startOffset: upd.newFrom, endOffset: upd.newTo } : c
              })
            )
            await Promise.all([
              ...orphanIds.map((id) =>
                window.electronAPI.extensionBridge
                  .invoke('terminator.notepad:comments.markOrphaned', { id })
                  .catch((err) => console.error('[notepad] markOrphaned failed', err))
              ),
              ...anchorUpdates.map((u) =>
                window.electronAPI.extensionBridge
                  .invoke('terminator.notepad:comments.updateAnchor', {
                    id: u.id,
                    startOffset: u.newFrom,
                    endOffset: u.newTo,
                  })
                  .catch((err) => console.error('[notepad] updateAnchor failed', err))
              ),
            ])
          }
        } catch (err) {
          console.error('[notepad] Autosave failed', err)
        }
      }, AUTOSAVE_DELAY_MS)
    },
    [selectedNoteId, notes, markSaving, markSaved]
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

  useEffect(() => {
    function onToggleComments() {
      setShowComments((v) => !v)
    }
    window.addEventListener('notepad:toggleComments', onToggleComments)
    return () => window.removeEventListener('notepad:toggleComments', onToggleComments)
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

  // Listen for global shortcut broadcast to open search
  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on('terminator.notepad:ui.openSearch', () => {
      setShowSearch(true)
    })
    return off
  }, [])

  // Listen for open-in-window push: activate notepad tab and select the note
  useEffect(() => {
    const off = window.electronAPI.extensionBridge.on(
      'terminator.notepad:selectNote',
      (data: unknown) => {
        const id = (data as { id?: string })?.id
        if (id) {
          useExtensionRegistry.getState().setActiveGlobalTab('notepad')
          useNotesStore.getState().setSelected(id)
        }
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
    return ''
  }

  if (notes.length === 0) {
    return (
      <div className="notepad-view notepad-view--empty-screen">
        {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
        <EmptyState
          onNewNote={() => setShowQuickCreate(true)}
          onImport={() => void importNotes()}
        />
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
          <button
            className="notepad-btn-ghost"
            onClick={() => setReadingMode((v) => !v)}
            title={readingMode ? 'Switch to edit mode' : 'Switch to reading mode'}
          >
            {readingMode ? 'Edit' : 'Read'}
          </button>
          <button
            className={`notepad-btn-ghost${showComments ? ' notepad-view__comments-toggle--on' : ''}`}
            onClick={() => setShowComments((v) => !v)}
            title={showComments ? 'Hide comments' : 'Show comments'}
          >
            {showComments ? 'Hide comments' : 'Show comments'}
          </button>
          <button
            className="notepad-btn-ghost notepad-view__export-btn"
            onClick={() => setShowExport(true)}
          >
            Export
          </button>
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
              key={selectedNoteId}
              initialDoc={bodyDraft}
              onChange={handleEditorChange}
              onAnchorsReady={(getView) => {
                editorViewRef.current = getView()
              }}
              onSelectionChange={(sel) => {
                setPendingAnchor(sel)
                if (!sel) setComposingAnchor(null)
              }}
              readOnly={readingMode}
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
                <MessageSquarePlus size={14} />
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
              anchorTops={anchorTops}
              containerHeight={panelContentHeight}
              activeCommentId={activeCommentId}
              onCommentClick={(from, to) => scrollToAnchor(editorViewRef.current, from, to)}
              onHoverComment={(id) => setEditorHoverAnchor(editorViewRef.current, id)}
            />
          </>
        )}
      </div>
    </div>
  )
}
