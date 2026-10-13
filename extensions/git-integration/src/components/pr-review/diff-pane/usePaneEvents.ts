import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  REVIEW_KEY_EVENTS,
  type ComposerRequest,
  type LineSelection,
} from '../../../stores/review-ui.store'
import type { AgentScope } from '../../../schemas/review-agent.schema'
import type { FileDiff } from '../../../schemas/git.schema'
import type { DiffItem } from '../../../review/diff-items'
import type { VirtualDiffListHandle } from '../VirtualDiffList'
import type { ComposerAnchor, NoteAnchor } from './types'
import { hunkNearTop, rangeStart } from './lines'

interface ComposerRequestSource {
  path: string
  composerRequest: ComposerRequest | null
  requestComposer: (request: ComposerRequest | null) => void
  setComposerAnchor: (anchor: ComposerAnchor) => void
}

interface HunkNavSource {
  items: DiffItem[]
  diffKey: string
  onPrevFile: () => void
  onNextFile: () => void
  listRef: { current: VirtualDiffListHandle | null }
}

export interface KeyEventSource {
  selection: LineSelection | null
  path: string
  diff: FileDiff | null
  scrollHunkIntoView: (direction: 1 | -1) => void
  openAgentPanel: (
    scope: AgentScope | null,
    request?: 'review' | 'explain',
    autoStart?: boolean
  ) => void
  selectionTouchesRevealed: (sel: LineSelection | null) => boolean
  setComposerAnchor: (anchor: ComposerAnchor) => void
  setNoteAnchor: (anchor: NoteAnchor) => void
  peekDefinition: () => void
}

/** The window events the file header's keyboard shortcuts raise for the previous and next file. */
export function useFileNavEvents(onPrevFile: () => void, onMarkViewed: () => void): void {
  useEffect(() => {
    const handlePrev = () => onPrevFile()
    const handleMarkNext = () => onMarkViewed()
    window.addEventListener('pr-review:prev-file', handlePrev)
    window.addEventListener('pr-review:mark-viewed-next', handleMarkNext)
    return () => {
      window.removeEventListener('pr-review:prev-file', handlePrev)
      window.removeEventListener('pr-review:mark-viewed-next', handleMarkNext)
    }
  }, [onPrevFile, onMarkViewed])
}

function anchorFromRequest(request: ComposerRequest): ComposerAnchor {
  return {
    line: request.line,
    startLine: request.startLine,
    side: request.side,
    initialBody: request.body,
    fromFindingId: request.fromFindingId,
  }
}

/** The request, when it is for this file. */
function requestFor(request: ComposerRequest | null, path: string): ComposerRequest | null {
  if (request?.path !== path) return null
  return request
}

/**
 * A request from elsewhere (the agent panel, a finding) opens the composer in this file,
 * prefilled, then clears the one-shot request.
 */
export function useComposerRequest(source: ComposerRequestSource): void {
  const { composerRequest, requestComposer } = source
  const requestForThisFile = requestFor(composerRequest, source.path)
  const [seen, setSeen] = useState(requestForThisFile)
  if (seen !== requestForThisFile) {
    setSeen(requestForThisFile)
    if (requestForThisFile) source.setComposerAnchor(anchorFromRequest(requestForThisFile))
  }
  useEffect(() => {
    if (requestForThisFile) requestComposer(null)
  }, [requestForThisFile, requestComposer])
}

/**
 * Moves between hunks; past the first or last it moves to the previous or next file. Which
 * hunk was last scrolled to is kept, since jsdom (and some real layouts) cannot be trusted
 * to report bounding-rect positions.
 */
export function useHunkNav(src: HunkNavSource) {
  const { items, diffKey, onPrevFile, onNextFile, listRef } = src
  const currentHunkIndexRef = useRef(0)
  useEffect(() => {
    currentHunkIndexRef.current = 0
  }, [diffKey])
  const hunkHeaderIndexes = useMemo(
    () => items.flatMap((item, index) => [index].filter(() => item.kind === 'hunk-header')),
    [items]
  )
  const scrollHunkIntoView = useCallback(
    (direction: 1 | -1) => {
      if (hunkHeaderIndexes.length === 0) return
      const nextIndex = currentHunkIndexRef.current + direction
      if (nextIndex < 0) return onPrevFile()
      if (nextIndex >= hunkHeaderIndexes.length) return onNextFile()
      currentHunkIndexRef.current = nextIndex
      listRef.current?.scrollToIndex(hunkHeaderIndexes[nextIndex], 'start')
    },
    [hunkHeaderIndexes, onNextFile, onPrevFile, listRef]
  )
  return { scrollHunkIntoView }
}

/** The selection's lines when it is in this file, else the first hunk, for the agent to read. */
function agentScope(src: KeyEventSource): AgentScope | null {
  const { selection, path } = src
  if (selection && selection.path === path) {
    const { startLine, endLine, side } = selection
    return { kind: 'lines', path, startLine, endLine, side, chapter: null }
  }
  const hunk = hunkNearTop(src.diff?.hunks ?? [])
  if (!hunk) return null
  return { kind: 'hunk', path, ...hunk, side: 'RIGHT', chapter: null }
}

function selectionHere(src: KeyEventSource): LineSelection | null {
  if (src.selection && src.selection.path === src.path) return src.selection
  return null
}

/** What each review key event does in this pane. */
function keyEventHandlers(src: KeyEventSource): Array<[string, () => void]> {
  const review = () => {
    const scope = agentScope(src)
    if (scope) src.openAgentPanel(scope, 'review')
  }
  const explain = () => {
    const scope = agentScope(src)
    if (scope) src.openAgentPanel(scope, 'explain', true)
  }
  const comment = () => {
    const sel = selectionHere(src)
    if (!sel || src.selectionTouchesRevealed(sel)) return
    const anchor = { line: sel.endLine, startLine: rangeStart(sel), side: sel.side }
    src.setComposerAnchor({ ...anchor, initialBody: '', fromFindingId: null })
  }
  const note = () => {
    const sel = selectionHere(src)
    if (sel) src.setNoteAnchor({ line: sel.endLine, side: sel.side })
  }
  return [
    [REVIEW_KEY_EVENTS.nextHunk, () => src.scrollHunkIntoView(1)],
    [REVIEW_KEY_EVENTS.prevHunk, () => src.scrollHunkIntoView(-1)],
    [REVIEW_KEY_EVENTS.askAgent, review],
    [REVIEW_KEY_EVENTS.explain, explain],
    [REVIEW_KEY_EVENTS.comment, comment],
    [REVIEW_KEY_EVENTS.note, note],
    [REVIEW_KEY_EVENTS.peekDefinition, () => src.peekDefinition()],
  ]
}

/**
 * REVIEW_KEY_EVENTS: the surface-level key handler (useReviewKeys, owned elsewhere) raises
 * these; only the pane knows its hunks and selection.
 */
export function useReviewKeyEvents(src: KeyEventSource): void {
  const { selection, path, diff, scrollHunkIntoView, openAgentPanel, selectionTouchesRevealed } =
    src
  useEffect(() => {
    const handlers = keyEventHandlers(src)
    for (const [event, handler] of handlers) window.addEventListener(event, handler)
    return () => {
      for (const [event, handler] of handlers) window.removeEventListener(event, handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, path, diff, scrollHunkIntoView, openAgentPanel, selectionTouchesRevealed])
}
