import type { EditorView } from '@codemirror/view'
import { useCommentsStore } from '../stores/comments.store'
import { commentAnchorField, type CommentAnchor } from '../editor/commentField'
import { reanchorComment } from '../editor/reanchor'
import type { Comment } from '../db/types'

/** Estimated height of one comment card, and the gap the margin keeps between cards. */
const CARD_HEIGHT_EST = 110
const CARD_GAP = 8

/** What re-finding the comments' quotes in a body changed. */
export interface AnchorChanges {
  orphanIds: string[]
  anchorUpdates: { id: string; newFrom: number; newTo: number }[]
}

/** Re-find each open top-level comment's quote in `body`: moved, or lost (orphaned). */
export function reanchorAll(comments: Comment[], body: string): AnchorChanges {
  const changes: AnchorChanges = { orphanIds: [], anchorUpdates: [] }
  for (const comment of comments) {
    if (comment.parentId !== null || comment.status === 'orphaned') continue
    const result = reanchorComment(comment, body)
    if (result.status === 'orphaned') {
      changes.orphanIds.push(comment.id)
    } else if (result.newFrom !== undefined && result.newTo !== undefined) {
      changes.anchorUpdates.push({ id: comment.id, newFrom: result.newFrom, newTo: result.newTo })
    }
  }
  return changes
}

export function hasAnchorChanges(changes: AnchorChanges): boolean {
  return changes.orphanIds.length > 0 || changes.anchorUpdates.length > 0
}

/** The comments with the changes applied: orphans marked, moved anchors at their new offsets. */
export function applyAnchorChanges(comments: Comment[], changes: AnchorChanges): Comment[] {
  const moved = new Map(changes.anchorUpdates.map((u) => [u.id, u]))
  const orphans = new Set(changes.orphanIds)
  return comments.map((c) => {
    if (orphans.has(c.id)) return { ...c, status: 'orphaned' as const }
    const upd = moved.get(c.id)
    return upd ? { ...c, startOffset: upd.newFrom, endOffset: upd.newTo } : c
  })
}

/** Stores the changes. A write that fails is logged; the next re-anchor retries it. */
export async function persistAnchorChanges(changes: AnchorChanges): Promise<void> {
  const bridge = window.electronAPI.extensionBridge
  await Promise.all([
    ...changes.orphanIds.map((id) =>
      bridge
        .invoke('terminator.notepad:comments.markOrphaned', { id })
        .catch((err) => console.error('[notepad] markOrphaned failed', err))
    ),
    ...changes.anchorUpdates.map((u) =>
      bridge
        .invoke('terminator.notepad:comments.updateAnchor', {
          id: u.id,
          startOffset: u.newFrom,
          endOffset: u.newTo,
        })
        .catch((err) => console.error('[notepad] updateAnchor failed', err))
    ),
  ])
}

/**
 * Re-anchors a freshly loaded note's comments against its body, shows the result
 * at once and stores it after `delay`, replacing the write still waiting on `pending`.
 * Returns the timer of the write now waiting (`pending` when nothing moved).
 */
export function adoptLoadedComments(
  loaded: { comments: Comment[]; body: string },
  pending: Timer | null,
  delay: number
): Timer | null {
  const changes = reanchorAll(loaded.comments, loaded.body)
  useCommentsStore.getState().setComments(applyAnchorChanges(loaded.comments, changes))
  if (!hasAnchorChanges(changes)) return pending
  if (pending) clearTimeout(pending)
  return setTimeout(() => void persistAnchorChanges(changes), delay)
}

type Timer = ReturnType<typeof setTimeout>

/** Re-anchors the open note's comments against the body just saved, and stores what moved. */
export async function reanchorAfterSave(body: string): Promise<void> {
  const current = useCommentsStore.getState().comments
  const changes = reanchorAll(current, body)
  if (!hasAnchorChanges(changes)) return
  useCommentsStore.getState().setComments(applyAnchorChanges(current, changes))
  await persistAnchorChanges(changes)
}

/** The anchors the editor highlights: open top-level comments over a non-empty range. */
export function visibleAnchors(comments: Comment[]): CommentAnchor[] {
  return comments
    .filter((c) => c.parentId === null && c.status !== 'orphaned')
    .map((c) => ({ id: c.id, from: c.startOffset ?? 0, to: c.endOffset ?? 0 }))
    .filter((a) => a.from < a.to)
}

interface CardTarget {
  id: string
  targetTop: number
  createdAt: string
}

/** Where each open top-level comment's card would sit: level with its anchor in the editor. */
function cardTargets(view: EditorView, comments: Comment[]): CardTarget[] {
  const scrollTop = view.scrollDOM.scrollTop
  const rect = view.scrollDOM.getBoundingClientRect()
  // Live-mapped positions from the editor state field, updated on every keystroke
  const livePositions = new Map(view.state.field(commentAnchorField).map((a) => [a.id, a.from]))
  const targets: CardTarget[] = []
  for (const c of comments) {
    if (c.parentId !== null || c.status === 'orphaned') continue
    const rawPos = livePositions.get(c.id) ?? c.startOffset
    if (rawPos === null) continue
    const pos = Math.min(rawPos, Math.max(0, view.state.doc.length - 1))
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
  return targets
}

/** Each card's top in the comment margin, and the height the margin scrolls through. */
export interface CardLayout {
  tops: Record<string, number>
  contentHeight: number
}

/**
 * The comment margin's push-down layout: each card as level with its anchor as the
 * cards above it allow, and the height the margin needs to scroll with the editor.
 */
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
  return {
    tops,
    contentHeight: Math.max(view.scrollDOM.scrollHeight, lastTop + CARD_HEIGHT_EST + 20),
  }
}
