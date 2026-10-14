// What the docked panel and a popped-out note window both do with a note's
// comments: re-anchor them to the text, persist the result, and lay their cards
// out beside the lines they refer to.

import type { EditorView } from '@codemirror/view'
import { reanchorComment } from '../editor/reanchor'
import { commentAnchorField, type CommentAnchor } from '../editor/commentField'
import { useCommentsStore } from '../stores/comments.store'
import type { Comment } from '../db/types'

const ANCHOR_DEBOUNCE_MS = 2000
const CARD_HEIGHT_EST = 110
const CARD_GAP = 8

interface AnchorUpdate {
  id: string
  newFrom: number
  newTo: number
}

/** The comments with fresh anchors, and which anchors moved or were lost. */
export interface Reanchoring {
  comments: Comment[]
  anchorUpdates: AnchorUpdate[]
  orphanIds: string[]
}

/** Re-anchors every open top-level comment against `body`. */
export function reanchorComments(comments: Comment[], body: string): Reanchoring {
  const anchorUpdates: AnchorUpdate[] = []
  const orphanIds: string[] = []
  for (const comment of comments) {
    if (comment.parentId !== null || comment.status === 'orphaned') continue
    const result = reanchorComment(comment, body)
    if (result.status === 'orphaned') {
      orphanIds.push(comment.id)
    } else if (result.newFrom !== undefined && result.newTo !== undefined) {
      anchorUpdates.push({ id: comment.id, newFrom: result.newFrom, newTo: result.newTo })
    }
  }
  return {
    comments: applyReanchoring(comments, anchorUpdates, orphanIds),
    anchorUpdates,
    orphanIds,
  }
}

function applyReanchoring(comments: Comment[], updates: AnchorUpdate[], orphanIds: string[]) {
  const updatedMap = new Map(updates.map((u) => [u.id, u]))
  const orphanSet = new Set(orphanIds)
  return comments.map((c): Comment => {
    if (orphanSet.has(c.id)) return { ...c, status: 'orphaned' }
    const upd = updatedMap.get(c.id)
    if (!upd) return c
    return { ...c, startOffset: upd.newFrom, endOffset: upd.newTo }
  })
}

function hasReanchorChanges(r: Reanchoring): boolean {
  return r.anchorUpdates.length > 0 || r.orphanIds.length > 0
}

/** Writes moved anchors and orphaned comments back; a failure is logged, not thrown. */
async function persistReanchoring(r: Reanchoring): Promise<void> {
  const bridge = window.electronAPI.extensionBridge
  await Promise.all([
    ...r.anchorUpdates.map((u) =>
      bridge
        .invoke('terminator.notepad:comments.updateAnchor', {
          id: u.id,
          startOffset: u.newFrom,
          endOffset: u.newTo,
        })
        .catch((err) => console.error('[notepad] updateAnchor failed', err))
    ),
    ...r.orphanIds.map((id) =>
      bridge
        .invoke('terminator.notepad:comments.markOrphaned', { id })
        .catch((err) => console.error('[notepad] markOrphaned failed', err))
    ),
  ])
}

/** The live body may be newer than the one saved, since typing continues during the round-trip,
 *  so the stored comments are re-checked against it. */
export async function reanchorAfterSave(liveBody: string): Promise<void> {
  const r = reanchorComments(useCommentsStore.getState().comments, liveBody)
  if (!hasReanchorChanges(r)) return
  useCommentsStore.getState().setComments(r.comments)
  await persistReanchoring(r)
}

type TimerRef = { current: ReturnType<typeof setTimeout> | null }

/** Persists a load-time re-anchoring after a pause, replacing one still pending. */
export function schedulePersist(timerRef: TimerRef, r: Reanchoring): void {
  if (!hasReanchorChanges(r)) return
  if (timerRef.current) clearTimeout(timerRef.current)
  timerRef.current = setTimeout(() => void persistReanchoring(r), ANCHOR_DEBOUNCE_MS)
}

/** The highlight ranges of open top-level comments that still span some text. */
export function visibleAnchors(comments: Comment[]): CommentAnchor[] {
  return comments
    .filter((c) => c.parentId === null && c.status !== 'orphaned')
    .map((c) => ({ id: c.id, from: c.startOffset ?? 0, to: c.endOffset ?? 0 }))
    .filter((a) => a.from < a.to)
}

/** Re-reads a note's comments into the store. */
export function reloadComments(noteId: string): void {
  window.electronAPI.extensionBridge
    .invoke('terminator.notepad:comments.list', { noteId })
    .then((r) => {
      const data = (r as { data?: Comment[] }).data
      if (data) useCommentsStore.getState().setComments(data)
    })
    .catch(console.error)
}

/** Where each comment card goes, and how tall the margin must be to hold them. */
export interface CardLayout {
  tops: Record<string, number>
  contentHeight: number
}

interface CardTarget {
  id: string
  targetTop: number
  createdAt: string
}

/** Each card sits level with its anchor unless the card above would overlap it. Anchors come
 *  from the editor's live-mapped field, which follows every keystroke, before stored offsets. */
export function layoutCommentCards(view: EditorView, comments: Comment[]): CardLayout {
  const targets = cardTargets(view, comments)
  targets.sort((a, b) => a.targetTop - b.targetTop || a.createdAt.localeCompare(b.createdAt))

  const tops: Record<string, number> = {}
  let prevBottom = 0
  for (const t of targets) {
    const top = Math.max(t.targetTop, prevBottom + CARD_GAP)
    tops[t.id] = top
    prevBottom = top + CARD_HEIGHT_EST
  }
  const lastTop = Object.values(tops).reduce((max, v) => Math.max(max, v), 0)
  const contentHeight = Math.max(view.scrollDOM.scrollHeight, lastTop + CARD_HEIGHT_EST + 20)
  return { tops, contentHeight }
}

function cardTargets(view: EditorView, comments: Comment[]): CardTarget[] {
  const scrollTop = view.scrollDOM.scrollTop
  const rect = view.scrollDOM.getBoundingClientRect()
  const livePositions = new Map(view.state.field(commentAnchorField).map((a) => [a.id, a.from]))
  const targets: CardTarget[] = []
  for (const c of comments) {
    if (c.parentId !== null || c.status === 'orphaned') continue
    const rawPos = livePositions.get(c.id) ?? c.startOffset
    if (rawPos === null) continue
    const pos = Math.min(rawPos, Math.max(0, view.state.doc.length - 1))
    const coords = coordsOrNull(view, pos)
    if (coords) {
      targets.push({
        id: c.id,
        targetTop: coords.top - rect.top + scrollTop,
        createdAt: c.createdAt,
      })
    }
  }
  return targets
}

function coordsOrNull(view: EditorView, pos: number) {
  try {
    return view.coordsAtPos(pos)
  } catch {
    return null // out of viewport
  }
}
