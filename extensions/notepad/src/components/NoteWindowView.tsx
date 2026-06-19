import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { useEditorStore } from '../stores/editor.store'
import { useCommentsStore } from '../stores/comments.store'
import { CommentMargin } from './CommentMargin'
import { CommentComposer } from './CommentComposer'
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

const NOTE_ID = new URLSearchParams(window.location.search).get('noteId') ?? ''
const AUTOSAVE_DELAY = 800
const ANCHOR_DEBOUNCE = 2000
const CARD_HEIGHT_EST = 110
const CARD_GAP = 8

interface NoteData {
  id: string
  title: string
  body: string
  tags: string[]
}

export function NoteWindowView(_props: { repoRoot: string | null }): React.JSX.Element {
  const [note, setNote] = useState<NoteData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pendingAnchor, setPendingAnchor] = useState<SelectionAnchor | null>(null)
  const [composingAnchor, setComposingAnchor] = useState<SelectionAnchor | null>(null)
  const [anchorTops, setAnchorTops] = useState<Record<string, number>>({})
  const [panelContentHeight, setPanelContentHeight] = useState(0)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentHover, setCommentHover] = useState<{ id: string; top: number } | null>(null)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { bodyDraft, saveStatus, setActiveNote, markSaving, markSaved } = useEditorStore()
  const { comments, setComments } = useCommentsStore()
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const editorViewRef = useRef<EditorView | null>(null)
  const commentPanelRef = useRef<HTMLDivElement>(null)
  const editorWrapRef = useRef<HTMLDivElement>(null)

  // Load note + comments on mount
  useEffect(() => {
    if (!NOTE_ID) {
      setLoadError('No note ID provided')
      return
    }
    async function load() {
      try {
        const [noteResult, commentsResult] = await Promise.all([
          window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.get', {
            id: NOTE_ID,
          }),
          window.electronAPI.extensionBridge.invoke('terminator.notepad:comments.list', {
            noteId: NOTE_ID,
            includeResolved: true,
          }),
        ])
        const data = (noteResult as { data?: NoteData }).data
        if (!data) {
          setLoadError('Note not found')
          return
        }
        setNote(data)
        setActiveNote(data.id, data.body)
        document.title = data.title || 'Note'

        const allComments = (commentsResult as { data?: Comment[] }).data ?? []
        const anchorUpdates: { id: string; newFrom: number; newTo: number }[] = []
        const orphanIds: string[] = []
        for (const c of allComments) {
          if (c.parentId !== null || c.status === 'orphaned') continue
          const result = reanchorComment(c, data.body)
          if (result.status === 'orphaned') {
            orphanIds.push(c.id)
          } else if (result.newFrom !== undefined && result.newTo !== undefined) {
            anchorUpdates.push({ id: c.id, newFrom: result.newFrom, newTo: result.newTo })
          }
        }
        const updMap = new Map(anchorUpdates.map((u) => [u.id, u]))
        const orphanSet = new Set(orphanIds)
        setComments(
          allComments.map((c) => {
            if (orphanSet.has(c.id)) return { ...c, status: 'orphaned' as const }
            const u = updMap.get(c.id)
            return u ? { ...c, startOffset: u.newFrom, endOffset: u.newTo } : c
          })
        )
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
                  .catch(console.error)
              ),
              ...orphanIds.map((id) =>
                window.electronAPI.extensionBridge
                  .invoke('terminator.notepad:comments.markOrphaned', { id })
                  .catch(console.error)
              ),
            ])
          }, ANCHOR_DEBOUNCE)
        }
      } catch (err) {
        setLoadError(String(err))
      }
    }
    void load()
  }, [setActiveNote, setComments])

  // Re-layout comment cards when comments or editor changes
  const computeAnchorTops = useCallback((view: EditorView, commentList: Comment[]) => {
    requestAnimationFrame(() => {
      const scrollTop = view.scrollDOM.scrollTop
      const rect = view.scrollDOM.getBoundingClientRect()
      const targets: { id: string; targetTop: number; createdAt: string }[] = []
      for (const c of commentList) {
        if (c.startOffset !== null && c.parentId === null && c.status !== 'orphaned') {
          const pos = Math.min(c.startOffset, Math.max(0, view.state.doc.length - 1))
          try {
            const coords = view.coordsAtPos(pos)
            if (coords)
              targets.push({
                id: c.id,
                targetTop: coords.top - rect.top + scrollTop,
                createdAt: c.createdAt,
              })
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
      const lastTop = Object.values(tops).reduce((m, v) => Math.max(m, v), 0)
      setPanelContentHeight(Math.max(view.scrollDOM.scrollHeight, lastTop + CARD_HEIGHT_EST + 20))
      if (commentPanelRef.current) commentPanelRef.current.scrollTop = view.scrollDOM.scrollTop
    })
  }, [])

  useEffect(() => {
    const view = editorViewRef.current
    if (!view) return
    const validAnchors = comments
      .filter((c) => c.parentId === null && c.status !== 'orphaned')
      .map((c) => ({ id: c.id, from: c.startOffset ?? 0, to: c.endOffset ?? 0 }))
      .filter((a) => a.from < a.to)
    applyAnchors(view, validAnchors)
    computeAnchorTops(view, comments)
  }, [comments, computeAnchorTops])

  useEffect(() => {
    const view = editorViewRef.current
    const panel = commentPanelRef.current
    if (!view || !panel) return
    function onScroll() {
      if (panel) panel.scrollTop = view.scrollDOM.scrollTop
    }
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    return () => view.scrollDOM.removeEventListener('scroll', onScroll)
  }, [note])

  const scheduleAutosave = useCallback(
    (newBody: string) => {
      if (!note) return
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(async () => {
        markSaving()
        const headingMatch = /^#{1,6}\s+(.+)/m.exec(newBody)
        const firstLine = newBody.split('\n').find((l) => l.trim().length > 0)
        const title = headingMatch
          ? headingMatch[1].trim()
          : (firstLine?.trim().slice(0, 120) ?? 'Untitled note')
        try {
          await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.autosave', {
            id: note.id,
            title,
            body: newBody,
            tags: note.tags,
          })
          setNote((n) => (n ? { ...n, title } : n))
          document.title = title || 'Note'
          markSaved()
        } catch {
          /* silent — main window will retry */
        }
      }, AUTOSAVE_DELAY)
    },
    [note, markSaving, markSaved]
  )

  function handleEditorChange(newBody: string) {
    scheduleAutosave(newBody)
  }

  function handleEditorMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const anchor = target.closest<HTMLElement>('[data-comment-id]')
    if (anchor) {
      const id = anchor.dataset.commentId
      if (id) {
        if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
        const top = anchorTops[id] ?? 0
        setCommentHover({ id, top })
      }
    }
  }

  function scheduleHoverHide() {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
    hoverHideTimer.current = setTimeout(() => setCommentHover(null), 200)
  }
  function cancelHoverHide() {
    if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
  }

  function reloadComments() {
    window.electronAPI.extensionBridge
      .invoke('terminator.notepad:comments.list', { noteId: NOTE_ID })
      .then((r) => {
        const data = (r as { data?: Comment[] }).data
        if (data) setComments(data)
      })
      .catch(console.error)
  }

  const statusLabel = saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : ''

  if (loadError) {
    return <div className="notepad-window-loading">{loadError}</div>
  }
  if (!note) {
    return <div className="notepad-window-loading">Loading…</div>
  }

  return (
    <div className="notepad-window">
      <div className="notepad-window__titlebar">
        <span className="notepad-window__title">{note.title || 'Untitled'}</span>
        <div className="notepad-window__titlebar-right">
          {note.tags.length > 0 && (
            <div className="notepad-window__tags">
              {note.tags.map((t) => (
                <span key={t} className="notepad-window__tag">
                  #{t}
                </span>
              ))}
            </div>
          )}
          <span className={`notepad-window__status notepad-window__status--${saveStatus}`}>
            {statusLabel}
          </span>
        </div>
      </div>
      <div className="notepad-window__body">
        <div
          ref={editorWrapRef}
          className="notepad-view__editor-wrap"
          onMouseOver={handleEditorMouseOver}
          onMouseLeave={scheduleHoverHide}
        >
          <NoteEditor
            key={note.id}
            initialDoc={bodyDraft}
            onChange={handleEditorChange}
            onAnchorsReady={(getView) => {
              editorViewRef.current = getView()
            }}
            onSelectionChange={(sel) => {
              setPendingAnchor(sel)
              if (!sel) setComposingAnchor(null)
            }}
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
                setActiveCommentId(commentHover.id)
              }}
            >
              View comment
            </div>
          )}
        </div>
        <div className="notepad-view__comments" ref={commentPanelRef}>
          {composingAnchor && (
            <CommentComposer
              anchor={{
                noteId: NOTE_ID,
                from: composingAnchor.from,
                to: composingAnchor.to,
                quote: composingAnchor.quote,
                prefix: composingAnchor.prefix,
                suffix: composingAnchor.suffix,
              }}
              onClose={() => setComposingAnchor(null)}
              onCreated={() => {
                setComposingAnchor(null)
                reloadComments()
              }}
            />
          )}
          <CommentMargin
            noteId={NOTE_ID}
            anchorTops={anchorTops}
            containerHeight={panelContentHeight}
            activeCommentId={activeCommentId}
            onCommentClick={(from, to) => scrollToAnchor(editorViewRef.current, from, to)}
            onHoverComment={(id) => setEditorHoverAnchor(editorViewRef.current, id)}
          />
        </div>
      </div>
    </div>
  )
}
