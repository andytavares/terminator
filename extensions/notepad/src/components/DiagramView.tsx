import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import { MessageSquarePlus, X, Check, Trash2, Pencil } from 'lucide-react'
import type { DiagramComment } from '../db/types'

// Lazy-load Excalidraw so it doesn't bloat the main bundle
const ExcalidrawComponent = lazy(async () => {
  const mod = await import('@excalidraw/excalidraw')
  return { default: mod.Excalidraw }
})

const AUTOSAVE_DELAY_MS = 1200

interface CommentPinProps {
  comment: DiagramComment
  screenX: number
  screenY: number
  isActive: boolean
  onClick: () => void
}

function CommentPin({ comment, screenX, screenY, isActive, onClick }: CommentPinProps) {
  const openCount = comment.replies.filter((r) => r.status === 'open').length + 1
  return (
    <button
      className={`diagram-comment-pin${isActive ? ' diagram-comment-pin--active' : ''}`}
      style={{ left: screenX, top: screenY }}
      onClick={onClick}
      title={comment.body}
      aria-label={`Comment: ${comment.body}`}
    >
      <span className="diagram-comment-pin__icon">
        <MessageSquarePlus size={13} />
      </span>
      {openCount > 1 && <span className="diagram-comment-pin__count">{openCount}</span>}
    </button>
  )
}

interface CommentPopoverProps {
  comment: DiagramComment
  onReply: (body: string) => void
  onResolve: () => void
  onDelete: () => void
  onClose: () => void
  screenX: number
  screenY: number
}

function CommentPopover({
  comment,
  onReply,
  onResolve,
  onDelete,
  onClose,
  screenX,
  screenY,
}: CommentPopoverProps) {
  const [replyText, setReplyText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function handleReply() {
    const trimmed = replyText.trim()
    if (!trimmed) return
    onReply(trimmed)
    setReplyText('')
  }

  const allMessages = [comment, ...comment.replies]

  return (
    <div className="diagram-comment-popover" style={{ left: screenX + 20, top: screenY }}>
      <div className="diagram-comment-popover__header">
        <span className="diagram-comment-popover__title">Comment</span>
        <div className="diagram-comment-popover__actions">
          <button
            className="notepad-btn-ghost diagram-comment-popover__resolve"
            onClick={onResolve}
            title="Resolve thread"
          >
            <Check size={12} />
          </button>
          <button
            className="notepad-btn-ghost diagram-comment-popover__delete"
            onClick={onDelete}
            title="Delete thread"
          >
            <Trash2 size={12} />
          </button>
          <button className="notepad-btn-icon" onClick={onClose} aria-label="Close">
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="diagram-comment-popover__messages">
        {allMessages.map((msg) => (
          <div key={msg.id} className="diagram-comment-popover__message">
            <span className="diagram-comment-popover__author">{msg.author}</span>
            <p className="diagram-comment-popover__body">{msg.body}</p>
          </div>
        ))}
      </div>
      <div className="diagram-comment-popover__reply">
        <textarea
          ref={textareaRef}
          className="diagram-comment-popover__textarea"
          placeholder="Reply…"
          value={replyText}
          rows={2}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              handleReply()
            }
          }}
        />
        <button
          className="notepad-btn-primary diagram-comment-popover__send"
          onClick={handleReply}
          disabled={!replyText.trim()}
        >
          Reply
        </button>
      </div>
    </div>
  )
}

interface NewCommentComposerProps {
  screenX: number
  screenY: number
  onSubmit: (body: string) => void
  onCancel: () => void
}

function NewCommentComposer({ screenX, screenY, onSubmit, onCancel }: NewCommentComposerProps) {
  const [body, setBody] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  function handleSubmit() {
    const trimmed = body.trim()
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div className="diagram-comment-popover" style={{ left: screenX + 20, top: screenY }}>
      <div className="diagram-comment-popover__header">
        <span className="diagram-comment-popover__title">New comment</span>
        <button className="notepad-btn-icon" onClick={onCancel} aria-label="Cancel">
          <X size={12} />
        </button>
      </div>
      <div className="diagram-comment-popover__reply">
        <textarea
          ref={textareaRef}
          className="diagram-comment-popover__textarea"
          placeholder="Add a comment…"
          value={body}
          rows={3}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
          }}
        />
        <div className="diagram-comment-popover__footer-actions">
          <button className="notepad-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="notepad-btn-primary" onClick={handleSubmit} disabled={!body.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Coordinate utilities ──────────────────────────────────────────

interface AppState {
  scrollX: number
  scrollY: number
  zoom: { value: number }
  offsetLeft: number
  offsetTop: number
  width: number
  height: number
}

function sceneToViewport(
  sceneX: number,
  sceneY: number,
  appState: AppState
): { x: number; y: number } {
  const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = appState
  return {
    x: (sceneX + scrollX) * zoom.value + offsetLeft,
    y: (sceneY + scrollY) * zoom.value + offsetTop,
  }
}

function viewportToScene(
  clientX: number,
  clientY: number,
  appState: AppState
): { x: number; y: number } {
  const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = appState
  return {
    x: (clientX - offsetLeft) / zoom.value - scrollX,
    y: (clientY - offsetTop) / zoom.value - scrollY,
  }
}

// ─── Main DiagramView ──────────────────────────────────────────────

interface DiagramViewProps {
  diagramId: string
}

export function DiagramView({ diagramId }: DiagramViewProps): React.JSX.Element {
  const [sceneJson, setSceneJson] = useState<string>('{}')
  const [loaded, setLoaded] = useState(false)
  const [title, setTitle] = useState('Untitled diagram')
  const [tags, setTags] = useState<string[]>([])
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [comments, setComments] = useState<DiagramComment[]>([])
  const [commentMode, setCommentMode] = useState(false)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [pendingPin, setPendingPin] = useState<{
    sceneX: number
    sceneY: number
    screenX: number
    screenY: number
  } | null>(null)
  const [appState, setAppState] = useState<AppState | null>(null)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('idle')
  const [loadError, setLoadError] = useState<string | null>(null)

  const excalidrawApiRef = useRef<{
    getAppState: () => AppState
    getSceneElements: () => unknown[]
  } | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSaveRef = useRef<{ sceneJson: string; title: string; tags: string[] } | null>(null)
  const latestTitleRef = useRef(title)
  const latestTagsRef = useRef(tags)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef(diagramId)

  useEffect(() => {
    latestTitleRef.current = title
  }, [title])
  useEffect(() => {
    latestTagsRef.current = tags
  }, [tags])

  useEffect(() => {
    activeIdRef.current = diagramId
    setLoaded(false)
    setLoadError(null)
    setComments([])
    setPendingPin(null)
    setActiveCommentId(null)

    async function load() {
      try {
        const [diagramResult, commentsResult] = await Promise.all([
          window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.get', {
            id: diagramId,
          }),
          window.electronAPI.extensionBridge.invoke('terminator.notepad:diagram-comments.list', {
            diagramId,
            includeResolved: false,
          }),
        ])

        if (activeIdRef.current !== diagramId) return

        const diagram = (
          diagramResult as { data?: { title: string; tags: string[]; sceneJson: string } }
        ).data
        if (!diagram) {
          setLoadError('Diagram not found.')
          setLoaded(true)
          return
        }
        setTitle(diagram.title)
        setTags(diagram.tags ?? [])
        setSceneJson(diagram.sceneJson || '{}')
        const commentData = (commentsResult as { data?: DiagramComment[] }).data ?? []
        setComments(commentData)
        setLoaded(true)
      } catch (err) {
        console.error('[notepad] DiagramView: load failed', err)
        setLoadError('Failed to load diagram.')
        setLoaded(true)
      }
    }
    void load()

    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current)
        autosaveTimer.current = null
      }
      // Flush any pending save so changes aren't lost when switching diagrams.
      // Use latest refs so a pending save picks up any title/tags renamed since scheduling.
      const pending = pendingSaveRef.current
      if (pending) {
        pendingSaveRef.current = null
        void window.electronAPI.extensionBridge
          .invoke('terminator.notepad:diagrams.autosave', {
            id: diagramId,
            title: latestTitleRef.current,
            sceneJson: pending.sceneJson,
            tags: latestTagsRef.current,
          })
          .catch(console.error)
      }
    }
  }, [diagramId])

  const scheduleAutosave = useCallback(
    (newSceneJson: string) => {
      pendingSaveRef.current = {
        sceneJson: newSceneJson,
        title: latestTitleRef.current,
        tags: latestTagsRef.current,
      }
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(async () => {
        // Read title/tags from refs at fire time so a rename between schedule and fire is respected
        const fireTitle = latestTitleRef.current
        const fireTags = latestTagsRef.current
        setSaveStatus('saving')
        try {
          await window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.autosave', {
            id: diagramId,
            title: fireTitle,
            sceneJson: newSceneJson,
            tags: fireTags,
          })
          pendingSaveRef.current = null
          setSaveStatus('saved')
        } catch (err) {
          console.error('[notepad] DiagramView: autosave failed', err)
          setSaveStatus('error')
          // pendingSaveRef is intentionally kept so the unmount flush can retry
        }
      }, AUTOSAVE_DELAY_MS)
    },
    [diagramId]
  )

  function handleExcalidrawChange(elements: readonly unknown[], state: AppState) {
    setAppState(state)
    const newJson = JSON.stringify({
      elements,
      appState: { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom },
    })
    setSceneJson(newJson)
    scheduleAutosave(newJson)
  }

  async function commitTitleEdit() {
    const trimmed = draftTitle.trim() || 'Untitled diagram'
    setTitle(trimmed)
    setEditingTitle(false)
    try {
      await window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.autosave', {
        id: diagramId,
        title: trimmed,
        tags,
      })
    } catch (err) {
      console.error('[notepad] DiagramView: title save failed', err)
    }
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!commentMode || !appState) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const clientX = e.clientX - rect.left
    const clientY = e.clientY - rect.top
    const scene = viewportToScene(clientX, clientY, appState)
    setPendingPin({ sceneX: scene.x, sceneY: scene.y, screenX: clientX, screenY: clientY })
    setCommentMode(false)
  }

  async function handleCreateComment(body: string) {
    if (!pendingPin) return
    try {
      await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagram-comments.create',
        {
          diagramId,
          body,
          sceneX: pendingPin.sceneX,
          sceneY: pendingPin.sceneY,
        }
      )
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagram-comments.list',
        { diagramId, includeResolved: false }
      )
      const data = (result as { data?: DiagramComment[] }).data ?? []
      setComments(data)
    } catch (err) {
      console.error('[notepad] DiagramView: create comment failed', err)
    }
    setPendingPin(null)
  }

  async function handleReply(commentId: string, body: string) {
    try {
      await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagram-comments.create',
        {
          diagramId,
          parentId: commentId,
          body,
          sceneX: 0,
          sceneY: 0,
        }
      )
      const result = await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagram-comments.list',
        { diagramId, includeResolved: false }
      )
      setComments((result as { data?: DiagramComment[] }).data ?? [])
    } catch (err) {
      console.error('[notepad] DiagramView: reply failed', err)
    }
  }

  async function handleResolve(commentId: string) {
    try {
      await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagram-comments.resolve',
        {
          id: commentId,
        }
      )
      setComments((prev) => prev.filter((c) => c.id !== commentId))
      setActiveCommentId(null)
    } catch (err) {
      console.error('[notepad] DiagramView: resolve failed', err)
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await window.electronAPI.extensionBridge.invoke(
        'terminator.notepad:diagram-comments.delete',
        {
          id: commentId,
        }
      )
      setComments((prev) => prev.filter((c) => c.id !== commentId))
      setActiveCommentId(null)
    } catch (err) {
      console.error('[notepad] DiagramView: delete comment failed', err)
    }
  }

  const activeComment = comments.find((c) => c.id === activeCommentId) ?? null

  let parsedScene: { elements?: unknown[]; appState?: unknown } = {}
  try {
    parsedScene = JSON.parse(sceneJson || '{}')
  } catch {
    // malformed JSON — start fresh
  }

  return (
    <div className="diagram-view">
      <div className="diagram-view__toolbar">
        <div className="diagram-view__title-area">
          {editingTitle ? (
            <input
              className="diagram-view__title-input"
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={() => void commitTitleEdit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitTitleEdit()
                if (e.key === 'Escape') setEditingTitle(false)
              }}
            />
          ) : (
            <button
              className="diagram-view__title-btn"
              onClick={() => {
                setDraftTitle(title)
                setEditingTitle(true)
              }}
              title="Click to rename"
            >
              {title}
              <Pencil size={11} className="diagram-view__title-edit-icon" />
            </button>
          )}
          {tags.length > 0 && (
            <span className="diagram-view__tags">{tags.map((t) => `#${t}`).join(' ')}</span>
          )}
        </div>
        <span className="diagram-view__save-status">
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : ''}
        </span>
        <button
          className={`notepad-btn-ghost${commentMode ? ' diagram-view__comment-btn--active' : ''}`}
          onClick={() => {
            setCommentMode((v) => !v)
            setPendingPin(null)
          }}
          title={
            commentMode ? 'Cancel comment placement' : 'Add comment (click anywhere on canvas)'
          }
        >
          <MessageSquarePlus size={14} />
          {commentMode ? ' Placing…' : ' Comment'}
        </button>
      </div>

      <div
        ref={containerRef}
        className={`diagram-view__canvas${commentMode ? ' diagram-view__canvas--comment-mode' : ''}`}
      >
        {/* Transparent overlay in comment mode captures clicks before Excalidraw sees them */}
        {commentMode && (
          <div className="diagram-view__comment-intercept" onClick={handleCanvasClick} />
        )}
        {loaded && loadError && <div className="diagram-view__load-error">{loadError}</div>}
        {loaded && !loadError && (
          <Suspense fallback={<div className="diagram-view__loading">Loading canvas…</div>}>
            <ExcalidrawComponent
              key={diagramId}
              theme="dark"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              initialData={{
                elements: (parsedScene.elements ?? []) as any,
                appState: (parsedScene.appState ?? {}) as any,
                scrollToContent: true,
              }}
              onChange={(elements, state) => handleExcalidrawChange(elements, state as AppState)}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              excalidrawAPI={(api: any) => {
                excalidrawApiRef.current = api
                // Seed appState immediately so pins render before first onChange
                setAppState(api.getAppState() as AppState)
              }}
            />
          </Suspense>
        )}

        {/* Comment pins overlay */}
        {appState &&
          comments.map((c) => {
            const { x, y } = sceneToViewport(c.sceneX, c.sceneY, appState)
            return (
              <CommentPin
                key={c.id}
                comment={c}
                screenX={x}
                screenY={y}
                isActive={activeCommentId === c.id}
                onClick={() => {
                  setActiveCommentId((prev) => (prev === c.id ? null : c.id))
                  setPendingPin(null)
                }}
              />
            )
          })}

        {/* Active comment popover */}
        {activeComment &&
          appState &&
          (() => {
            const { x, y } = sceneToViewport(activeComment.sceneX, activeComment.sceneY, appState)
            return (
              <CommentPopover
                key={activeComment.id}
                comment={activeComment}
                screenX={x}
                screenY={y}
                onReply={(body) => void handleReply(activeComment.id, body)}
                onResolve={() => void handleResolve(activeComment.id)}
                onDelete={() => void handleDelete(activeComment.id)}
                onClose={() => setActiveCommentId(null)}
              />
            )
          })()}

        {/* New comment composer */}
        {pendingPin && (
          <NewCommentComposer
            screenX={pendingPin.screenX}
            screenY={pendingPin.screenY}
            onSubmit={(body) => void handleCreateComment(body)}
            onCancel={() => setPendingPin(null)}
          />
        )}
      </div>
    </div>
  )
}
