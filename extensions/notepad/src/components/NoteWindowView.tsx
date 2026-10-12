import './notepad.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { useEditorStore } from '../stores/editor.store'
import { useCommentsStore } from '../stores/comments.store'
import { CommentMargin } from './CommentMargin'
import { CommentComposer } from './CommentComposer'
import { NoteOutline } from './NoteOutline'
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

const NOTE_ID = new URLSearchParams(window.location.search).get('noteId') ?? ''
const AUTOSAVE_DELAY = 800
const ANCHOR_DEBOUNCE = 2000

interface NoteData {
  id: string
  title: string
  body: string
  tags: string[]
}

export function NoteWindowView(): React.JSX.Element {
  const [note, setNote] = useState<NoteData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(NOTE_ID ? null : 'No note ID provided')
  const [pendingAnchor, setPendingAnchor] = useState<SelectionAnchor | null>(null)
  const [composingAnchor, setComposingAnchor] = useState<SelectionAnchor | null>(null)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [commentHover, setCommentHover] = useState<{ id: string; top: number } | null>(null)
  const [showOutline, setShowOutline] = useState(true)
  const hoverHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const {
    bodyDraft,
    saveStatus,
    previewMode,
    setActiveNote,
    markDirty,
    markSaving,
    markSaved,
    togglePreviewMode,
  } = useEditorStore()
  const { comments, setComments } = useCommentsStore()
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { editorViewRef, onEditorReady, cards, commentPanelRef } = useCommentCards(
    comments,
    note ? NOTE_ID : null
  )
  const editorWrapRef = useRef<HTMLDivElement>(null)

  // Load note + comments on mount
  useEffect(() => {
    if (!NOTE_ID) return
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
        anchorTimer.current = adoptLoadedComments(
          { comments: allComments, body: data.body },
          anchorTimer.current,
          ANCHOR_DEBOUNCE
        )
      } catch (err) {
        setLoadError(String(err))
      }
    }
    void load()
  }, [setActiveNote, setComments])

  const scheduleAutosave = useCallback(
    (newBody: string) => {
      if (!note) return
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(async () => {
        markSaving()
        const title = noteTitle(newBody)
        try {
          await window.electronAPI.extensionBridge.invoke('terminator.notepad:notes.autosave', {
            id: note.id,
            title,
            body: newBody,
            tags: note.tags,
            originId: ORIGIN_ID,
          })
          setNote((n) => (n ? { ...n, title } : n))
          document.title = title || 'Note'
          markSaved()

          // Re-check anchors after save against the live editor body, not the
          // stale newBody captured at debounce time.
          const liveBody = editorViewRef.current?.state.doc.toString() ?? newBody
          await reanchorAfterSave(liveBody)
        } catch {
          /* silent — main window will retry */
        }
      }, AUTOSAVE_DELAY)
    },
    [note, markSaving, markSaved, editorViewRef]
  )

  function handleEditorChange(newBody: string) {
    // markDirty so an in-flight local edit outranks a foreign push (see the
    // notes.changed subscription below) — the panel does the same.
    markDirty(newBody)
    scheduleAutosave(newBody)
  }

  // Adopt bodies saved by the docked panel so this window and the panel never
  // hold different content for the same note.
  useEffect(() => {
    return onForeignNoteChange((event) => {
      if (event.id !== NOTE_ID) return
      if (useEditorStore.getState().isDirty) return
      applyExternalDoc(editorViewRef.current, event.body)
      setActiveNote(event.id, event.body)
      setNote((n) => (n ? { ...n, title: event.title, tags: event.tags } : n))
      document.title = event.title || 'Note'
    })
  }, [setActiveNote, editorViewRef])

  function handleEditorMouseOver(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    const anchor = target.closest<HTMLElement>('[data-comment-id]')
    if (anchor) {
      const id = anchor.dataset.commentId
      if (id) {
        if (hoverHideTimer.current) clearTimeout(hoverHideTimer.current)
        const top = cards.tops[id] ?? 0
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
            onAnchorsReady={onEditorReady}
            onSelectionChange={(sel) => {
              setPendingAnchor(sel)
              if (!sel) setComposingAnchor(null)
            }}
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
                setActiveCommentId(commentHover.id)
              }}
            >
              View comment
            </div>
          )}
        </div>
        <div className="notepad-view__rail">
          {showOutline && (
            <NoteOutline
              onSelect={(pos) => scrollToPosition(editorViewRef.current, pos)}
              onClose={() => setShowOutline(false)}
            />
          )}
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
              anchorTops={cards.tops}
              containerHeight={cards.contentHeight}
              activeCommentId={activeCommentId}
              onCommentClick={(from, to) => scrollToAnchor(editorViewRef.current, from, to)}
              onHoverComment={(id) => setEditorHoverAnchor(editorViewRef.current, id)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
