import React, { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import { MessageSquarePlus, Pencil } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types'
import type { DiagramComment } from '../db/types'
import { useNotesStore } from '../stores/notes.store'
import {
  CommentPin,
  CommentPopover,
  NewCommentComposer,
  type ScreenPoint,
  type ThreadActions,
} from './DiagramComments'
import { useLatest } from './useLatest'

// Lazy-load Excalidraw so it doesn't bloat the main bundle
const ExcalidrawComponent = lazy(async () => {
  // Since 0.18 the canvas styles ship as a separate stylesheet.
  const [mod] = await Promise.all([
    import('@excalidraw/excalidraw'),
    import('@excalidraw/excalidraw/index.css'),
  ])
  return { default: mod.Excalidraw }
})

type SceneData = Pick<ExcalidrawInitialDataState, 'elements' | 'appState'>
type SaveStatus = 'saved' | 'saving' | 'error' | 'idle'
type TimerRef = React.MutableRefObject<ReturnType<typeof setTimeout> | null>

const AUTOSAVE_DELAY_MS = 1200

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

interface Point {
  x: number
  y: number
}

function sceneToViewport(sceneX: number, sceneY: number, appState: AppState): Point {
  const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = appState
  return {
    x: (sceneX + scrollX) * zoom.value + offsetLeft,
    y: (sceneY + scrollY) * zoom.value + offsetTop,
  }
}

function viewportToScene(clientX: number, clientY: number, appState: AppState): Point {
  const { scrollX, scrollY, zoom, offsetLeft, offsetTop } = appState
  return {
    x: (clientX - offsetLeft) / zoom.value - scrollX,
    y: (clientY - offsetTop) / zoom.value - scrollY,
  }
}

// ─── Loading ───────────────────────────────────────────────────────

/** A comment about to be placed: where in the scene, and where on screen. */
interface PendingPin extends ScreenPoint {
  sceneX: number
  sceneY: number
}

interface DiagramRecord {
  title: string
  tags: string[]
  sceneJson: string
}

/** A loaded diagram, or why it could not be loaded. */
type DiagramLoad =
  | { ok: true; title: string; tags: string[]; scene: SceneData; comments: DiagramComment[] }
  | { ok: false; error: string }

function parseScene(sceneJson: string): SceneData {
  try {
    return JSON.parse(sceneJson || '{}') as SceneData
  } catch {
    return {}
  }
}

/** Reads the in-session scene cache first, so content is never lost to a race between a cleanup
 *  flush and a DB read. Title and tags then come from the always-current diagrams list. */
async function readDiagram(diagramId: string): Promise<DiagramRecord | undefined> {
  const { diagramCache, diagrams } = useNotesStore.getState()
  const cachedScene = diagramCache[diagramId]
  if (cachedScene !== undefined) {
    const listed = diagrams.find((d) => d.id === diagramId) ?? { title: '', tags: [] }
    return { ...listed, sceneJson: cachedScene }
  }
  const result = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:diagrams.get',
    { id: diagramId }
  )
  const diagram = (result as { data?: DiagramRecord }).data
  // Populate the cache on first DB fetch so future navigate-backs skip the round-trip
  if (diagram) useNotesStore.getState().setDiagramCache(diagramId, diagram.sceneJson)
  return diagram
}

async function fetchDiagramComments(diagramId: string): Promise<DiagramComment[]> {
  const result = await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:diagram-comments.list',
    { diagramId, includeResolved: false }
  )
  return (result as { data?: DiagramComment[] }).data ?? []
}

async function loadDiagram(diagramId: string): Promise<DiagramLoad> {
  try {
    const [diagram, comments] = await Promise.all([
      readDiagram(diagramId),
      fetchDiagramComments(diagramId),
    ])
    if (!diagram) return { ok: false, error: 'Diagram not found.' }
    const scene = parseScene(diagram.sceneJson)
    return { ok: true, title: diagram.title, tags: diagram.tags ?? [], scene, comments }
  } catch (err) {
    console.error('[notepad] DiagramView: load failed', err)
    return { ok: false, error: 'Failed to load diagram.' }
  }
}

/** The diagram's document: title, tags, scene and comments, once loaded. */
function useDiagramDocument(diagramId: string) {
  const [initialScene, setInitialScene] = useState<SceneData>({})
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [title, setTitle] = useState('Untitled diagram')
  const [tags, setTags] = useState<string[]>([])
  const [comments, setComments] = useState<DiagramComment[]>([])

  useEffect(() => {
    let current = true
    void loadDiagram(diagramId).then((load) => {
      if (!current) return
      if (load.ok) {
        setTitle(load.title)
        setTags(load.tags)
        setInitialScene(load.scene)
        setComments(load.comments)
      } else {
        setLoadError(load.error)
      }
      setLoaded(true)
    })
    return () => {
      current = false
    }
  }, [diagramId])

  return { initialScene, loaded, loadError, title, setTitle, tags, comments, setComments }
}

type DiagramDocument = ReturnType<typeof useDiagramDocument>

// ─── Saving ────────────────────────────────────────────────────────

/** What a save writes; title and tags are read when it fires, so a rename is respected. */
interface DiagramSave {
  diagramId: string
  sceneJson: string
  title: string
  tags: string[]
}

function saveDiagram(save: DiagramSave) {
  return window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.autosave', {
    id: save.diagramId,
    title: save.title,
    sceneJson: save.sceneJson,
    tags: save.tags,
  })
}

/** Saves, then keeps the sidebar in step and caches the scene for an instant navigate-back. */
async function saveDiagramAndSync(save: DiagramSave): Promise<void> {
  await saveDiagram(save)
  const store = useNotesStore.getState()
  store.patchDiagram(save.diagramId, {
    title: save.title,
    updatedAt: new Date().toISOString(),
    tags: save.tags,
  })
  store.setDiagramCache(save.diagramId, save.sceneJson)
}

/** The autosave's timer, the scene it has yet to write, and the latest title and tags. */
interface AutosaveRefs {
  autosaveTimerRef: TimerRef
  pendingSceneRef: React.MutableRefObject<string | null>
  titleRef: React.MutableRefObject<string>
  tagsRef: React.MutableRefObject<string[]>
}

/** Saves the scene once drawing pauses; a scene not yet saved, or whose save failed, is flushed
 *  when the diagram closes. */
function useDiagramAutosave(diagramId: string, doc: DiagramDocument) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const refs: AutosaveRefs = {
    autosaveTimerRef: useRef<ReturnType<typeof setTimeout> | null>(null),
    pendingSceneRef: useRef<string | null>(null),
    titleRef: useLatest(doc.title),
    tagsRef: useLatest(doc.tags),
  }
  useFlushOnClose(diagramId, refs)

  const scheduleAutosave = useCallback(
    (sceneJson: string) => {
      const { autosaveTimerRef, pendingSceneRef, titleRef, tagsRef } = refs
      pendingSceneRef.current = sceneJson
      clearTimer(autosaveTimerRef)
      autosaveTimerRef.current = setTimeout(() => {
        const save = { diagramId, sceneJson, title: titleRef.current, tags: tagsRef.current }
        void runAutosave(save, pendingSceneRef, setSaveStatus)
      }, AUTOSAVE_DELAY_MS)
    },
    [diagramId] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return { saveStatus, scheduleAutosave }
}

/** A failed save leaves the scene pending, so the close flush can retry it. */
async function runAutosave(
  save: DiagramSave,
  pendingSceneRef: React.MutableRefObject<string | null>,
  setSaveStatus: (status: SaveStatus) => void
): Promise<void> {
  setSaveStatus('saving')
  try {
    await saveDiagramAndSync(save)
    pendingSceneRef.current = null
    setSaveStatus('saved')
  } catch (err) {
    console.error('[notepad] DiagramView: autosave failed', err)
    setSaveStatus('error')
  }
}

/** Writes a pending scene when the diagram closes, cached optimistically so navigating back never
 *  reads stale DB data. */
function useFlushOnClose(diagramId: string, refs: AutosaveRefs): void {
  useEffect(() => {
    return () => {
      const { autosaveTimerRef, pendingSceneRef, titleRef, tagsRef } = refs
      clearTimer(autosaveTimerRef)
      const sceneJson = pendingSceneRef.current
      if (sceneJson === null) return
      pendingSceneRef.current = null
      useNotesStore.getState().setDiagramCache(diagramId, sceneJson)
      const save = { diagramId, sceneJson, title: titleRef.current, tags: tagsRef.current }
      void saveDiagram(save).catch(console.error)
    }
  }, [diagramId]) // eslint-disable-line react-hooks/exhaustive-deps
}

function clearTimer(timerRef: TimerRef): void {
  if (timerRef.current) clearTimeout(timerRef.current)
  timerRef.current = null
}

// ─── Canvas ────────────────────────────────────────────────────────

interface ExcalidrawApi {
  getAppState: () => AppState
  getSceneElements: () => unknown[]
}

/** The canvas's view state, kept for placing pins, and its changes, saved. */
function useCanvas(scheduleAutosave: (sceneJson: string) => void) {
  const [appState, setAppState] = useState<AppState | null>(null)
  const excalidrawApiRef = useRef<ExcalidrawApi | null>(null)

  const handleExcalidrawChange = useCallback(
    (elements: readonly unknown[], state: AppState) => {
      setAppState(state)
      const { scrollX, scrollY, zoom } = state
      scheduleAutosave(JSON.stringify({ elements, appState: { scrollX, scrollY, zoom } }))
    },
    [scheduleAutosave]
  )

  const handleExcalidrawAPI = useCallback((api: ExcalidrawApi) => {
    if (excalidrawApiRef.current === api) return
    excalidrawApiRef.current = api
    setAppState(api.getAppState())
  }, [])

  return { appState, handleExcalidrawChange, handleExcalidrawAPI }
}

// ─── Comments ──────────────────────────────────────────────────────

type SetComments = React.Dispatch<React.SetStateAction<DiagramComment[]>>

async function addDiagramComment(payload: Record<string, unknown>, setComments: SetComments) {
  const diagramId = payload.diagramId as string
  await window.electronAPI.extensionBridge.invoke(
    'terminator.notepad:diagram-comments.create',
    payload
  )
  setComments(await fetchDiagramComments(diagramId))
}

/** What a thread's actions change. */
interface ThreadContext {
  diagramId: string
  setComments: SetComments
  setActiveCommentId: (id: string | null) => void
}

function threadActionsFor(commentId: string, ctx: ThreadContext): ThreadActions {
  const { diagramId, setComments, setActiveCommentId } = ctx
  const removeThread = (channel: string, failure: string) =>
    window.electronAPI.extensionBridge
      .invoke(channel, { id: commentId })
      .then(() => {
        setComments((prev) => prev.filter((c) => c.id !== commentId))
        setActiveCommentId(null)
      })
      .catch((err) => console.error(`[notepad] DiagramView: ${failure} failed`, err))
  const reply = { diagramId, parentId: commentId, sceneX: 0, sceneY: 0 }
  return {
    onReply: (body) =>
      void addDiagramComment({ ...reply, body }, setComments).catch((err) =>
        console.error('[notepad] DiagramView: reply failed', err)
      ),
    onResolve: () => void removeThread('terminator.notepad:diagram-comments.resolve', 'resolve'),
    onDelete: () =>
      void removeThread('terminator.notepad:diagram-comments.delete', 'delete comment'),
    onClose: () => setActiveCommentId(null),
  }
}

/** Placing, replying to, resolving and deleting the diagram's comments. */
function useDiagramComments(diagramId: string, setComments: SetComments) {
  const [commentMode, setCommentMode] = useState(false)
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null)
  const [pendingPin, setPendingPin] = useState<PendingPin | null>(null)

  async function handleCreateComment(body: string) {
    if (!pendingPin) return
    const { sceneX, sceneY } = pendingPin
    await addDiagramComment({ diagramId, body, sceneX, sceneY }, setComments).catch((err) =>
      console.error('[notepad] DiagramView: create comment failed', err)
    )
    setPendingPin(null)
  }

  const threadActions = (commentId: string) =>
    threadActionsFor(commentId, { diagramId, setComments, setActiveCommentId })

  return {
    ...{ commentMode, setCommentMode, activeCommentId, setActiveCommentId },
    ...{ pendingPin, setPendingPin, handleCreateComment, threadActions },
  }
}

type DiagramCommentControls = ReturnType<typeof useDiagramComments>

// ─── Main DiagramView ──────────────────────────────────────────────

interface DiagramViewProps {
  diagramId: string
}

export function DiagramView({ diagramId }: DiagramViewProps): React.JSX.Element {
  const doc = useDiagramDocument(diagramId)
  const { saveStatus, scheduleAutosave } = useDiagramAutosave(diagramId, doc)
  const canvas = useCanvas(scheduleAutosave)
  const commenting = useDiagramComments(diagramId, doc.setComments)

  return (
    <div className="diagram-view">
      <div className="diagram-view__toolbar">
        <DiagramTitle diagramId={diagramId} doc={doc} />
        <span className="diagram-view__save-status">
          {{ saving: 'Saving…', error: 'Save failed' }[saveStatus as string] ?? ''}
        </span>
        <CommentModeButton commenting={commenting} />
      </div>
      <DiagramCanvas diagramId={diagramId} doc={doc} canvas={canvas} commenting={commenting} />
    </div>
  )
}

/** Saves a renamed diagram, then shows the new title in the note list at once. */
async function saveDiagramTitle(diagramId: string, title: string, tags: string[]): Promise<void> {
  try {
    await window.electronAPI.extensionBridge.invoke('terminator.notepad:diagrams.autosave', {
      id: diagramId,
      title,
      tags,
    })
    useNotesStore.getState().patchDiagram(diagramId, { title, updatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[notepad] DiagramView: title save failed', err)
  }
}

function DiagramTitle(props: { diagramId: string; doc: DiagramDocument }): React.JSX.Element {
  const { diagramId, doc } = props
  const { title, tags } = doc
  const [draftTitle, setDraftTitle] = useState<string | null>(null)

  async function commitTitleEdit(draft: string) {
    const trimmed = draft.trim() || 'Untitled diagram'
    doc.setTitle(trimmed)
    setDraftTitle(null)
    await saveDiagramTitle(diagramId, trimmed, tags)
  }

  return (
    <div className="diagram-view__title-area">
      {draftTitle !== null ? (
        <DiagramTitleInput
          draft={draftTitle}
          onChange={setDraftTitle}
          onCommit={() => void commitTitleEdit(draftTitle)}
        />
      ) : (
        <TitleButton title={title} onClick={() => setDraftTitle(title)} />
      )}
      <DiagramTags tags={tags} />
    </div>
  )
}

function DiagramTags({ tags }: { tags: string[] }): React.JSX.Element | null {
  if (tags.length === 0) return null
  return <span className="diagram-view__tags">{tags.map((t) => '#' + t).join(' ')}</span>
}

interface TitleInputProps {
  draft: string
  /** null cancels the edit. */
  onChange: (draft: string | null) => void
  onCommit: () => void
}

function DiagramTitleInput({ draft, onChange, onCommit }: TitleInputProps): React.JSX.Element {
  return (
    <input
      className="diagram-view__title-input"
      autoFocus
      value={draft}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit()
        if (e.key === 'Escape') onChange(null)
      }}
    />
  )
}

function TitleButton({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button className="diagram-view__title-btn" onClick={onClick} title="Click to rename">
      {title}
      <Pencil className="diagram-view__title-edit-icon tm-icon-sm" />
    </button>
  )
}

function CommentModeButton({ commenting }: { commenting: DiagramCommentControls }) {
  const { commentMode, setCommentMode, setPendingPin } = commenting
  return (
    <Button
      variant={commentMode ? 'primary' : 'ghost'}
      size="sm"
      icon={MessageSquarePlus}
      aria-pressed={commentMode}
      onClick={() => {
        setCommentMode((v) => !v)
        setPendingPin(null)
      }}
      title={commentMode ? 'Cancel comment placement' : 'Add comment (click anywhere on canvas)'}
    >
      {commentMode ? 'Placing…' : 'Comment'}
    </Button>
  )
}

interface DiagramCanvasProps {
  diagramId: string
  doc: DiagramDocument
  canvas: ReturnType<typeof useCanvas>
  commenting: DiagramCommentControls
}

/** In comment mode a transparent overlay captures clicks before Excalidraw sees them. */
function DiagramCanvas(props: DiagramCanvasProps): React.JSX.Element {
  const { diagramId, doc, canvas, commenting } = props
  const { commentMode, pendingPin, setPendingPin } = commenting
  const containerRef = useRef<HTMLDivElement>(null)
  const placePin = usePinPlacement(containerRef, canvas.appState, commenting)

  return (
    <div
      ref={containerRef}
      className={`diagram-view__canvas${commentMode ? ' diagram-view__canvas--comment-mode' : ''}`}
    >
      {commentMode && <div className="diagram-view__comment-intercept" onClick={placePin} />}
      <ExcalidrawArea diagramId={diagramId} doc={doc} canvas={canvas} />
      {canvas.appState && (
        <CommentLayer doc={doc} appState={canvas.appState} commenting={commenting} />
      )}
      {pendingPin && (
        <NewCommentComposer
          screenX={pendingPin.screenX}
          screenY={pendingPin.screenY}
          onSubmit={(body) => void commenting.handleCreateComment(body)}
          onCancel={() => setPendingPin(null)}
        />
      )}
    </div>
  )
}

/** Turns a click on the canvas into a pin to comment on, in scene coordinates. */
function usePinPlacement(
  containerRef: React.RefObject<HTMLDivElement | null>,
  appState: AppState | null,
  commenting: DiagramCommentControls
) {
  return (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!commenting.commentMode || !appState || !rect) return
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const scene = viewportToScene(screenX, screenY, appState)
    commenting.setPendingPin({ sceneX: scene.x, sceneY: scene.y, screenX, screenY })
    commenting.setCommentMode(false)
  }
}

function ExcalidrawArea(props: Omit<DiagramCanvasProps, 'commenting'>) {
  const { diagramId, doc, canvas } = props
  if (!doc.loaded) return null
  if (doc.loadError) return <div className="diagram-view__load-error">{doc.loadError}</div>
  return (
    <Suspense fallback={<div className="diagram-view__loading">Loading canvas…</div>}>
      <ExcalidrawComponent
        key={diagramId}
        theme="dark"
        initialData={{
          elements: doc.initialScene.elements ?? [],
          appState: doc.initialScene.appState ?? {},
          scrollToContent: true,
        }}
        onChange={canvas.handleExcalidrawChange as never}
        excalidrawAPI={canvas.handleExcalidrawAPI as never}
      />
    </Suspense>
  )
}

interface CommentLayerProps {
  doc: DiagramDocument
  appState: AppState
  commenting: DiagramCommentControls
}

function screenOf(c: DiagramComment, appState: AppState): ScreenPoint {
  const { x, y } = sceneToViewport(c.sceneX, c.sceneY, appState)
  return { screenX: x, screenY: y }
}

/** A pin per comment, and the popover of the one that is open. */
function CommentLayer({ doc, appState, commenting }: CommentLayerProps): React.JSX.Element {
  const { activeCommentId, setActiveCommentId, setPendingPin } = commenting
  const activeComment = doc.comments.find((c) => c.id === activeCommentId) ?? null
  return (
    <>
      {doc.comments.map((c) => (
        <CommentPin
          key={c.id}
          comment={c}
          {...screenOf(c, appState)}
          isActive={activeCommentId === c.id}
          onClick={() => {
            setActiveCommentId((prev) => (prev === c.id ? null : c.id))
            setPendingPin(null)
          }}
        />
      ))}
      {activeComment && (
        <CommentPopover
          key={activeComment.id}
          comment={activeComment}
          {...screenOf(activeComment, appState)}
          actions={commenting.threadActions(activeComment.id)}
        />
      )}
    </>
  )
}
