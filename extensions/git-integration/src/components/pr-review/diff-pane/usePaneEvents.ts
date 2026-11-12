import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  REVIEW_KEY_EVENTS,
  type ComposerRequest,
  type LaterHunk,
  type LineSelection,
} from '../../../stores/review-ui.store'
import type { DiffItem } from '../../../review/diff-items'
import type { PrHead } from '../../../schemas/pr-review.schema'
import type { VirtualDiffListHandle } from '../VirtualDiffList'
import type { ComposerAnchor } from './types'
import { commentAnchor } from './lines'

interface ComposerRequestSource {
  path: string
  composerRequest: ComposerRequest | null
  requestComposer: (request: ComposerRequest | null) => void
  setComposerAnchor: (anchor: ComposerAnchor) => void
}

interface HunkNavSource {
  items: DiffItem[]
  diffKey: string
  path: string
  onPrevFile: () => void
  onNextFile: () => void
  listRef: { current: VirtualDiffListHandle | null }
  /** A later hunk the review came back to, and how to clear it once shown. */
  revisitHunk: LaterHunk | null
  clearRevisitHunk: () => void
}

/** What Space and `l` change outside the pane: the hunk's read mark and the later list. */
export interface HunkMarkSource {
  head: PrHead
  path: string
  laterKey: string
  toggleHunkViewed: (head: PrHead, path: string, hunkHeader: string) => void
  deferHunk: (key: string, hunk: LaterHunk) => void
}

export interface KeyEventSource {
  /** False for every file section but the active one, so one key moves one section. */
  enabled: boolean
  selection: LineSelection | null
  path: string
  scrollHunkIntoView: (direction: 1 | -1) => void
  markHunkRead: () => void
  deferHunk: () => void
  selectionTouchesRevealed: (sel: LineSelection | null) => boolean
  setComposerAnchor: (anchor: ComposerAnchor) => void
}

type HunkHeaderItem = Extract<DiffItem, { kind: 'hunk-header' }>

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

/** A request from elsewhere (the agent panel, a finding) opens the composer in this file,
 *  prefilled, then clears the one-shot request. */
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

interface RevisitSource {
  src: HunkNavSource
  hunkHeaderIndexes: number[]
  currentHunkIndexRef: { current: number }
  scrollToCurrent: () => void
}

function headerOf(item: DiffItem | undefined): string | null {
  return item?.kind === 'hunk-header' ? item.hunk.header : null
}

/** Scrolls to a later hunk the review came back to, once its file's hunks are listed. */
function useRevisitHunk({
  src,
  hunkHeaderIndexes,
  currentHunkIndexRef,
  scrollToCurrent,
}: RevisitSource) {
  const { revisitHunk, path, items, clearRevisitHunk } = src
  useEffect(() => {
    if (!revisitHunk || revisitHunk.path !== path) return
    const at = hunkHeaderIndexes.findIndex((i) => headerOf(items[i]) === revisitHunk.header)
    if (at < 0) return
    currentHunkIndexRef.current = at
    scrollToCurrent()
    clearRevisitHunk()
  }, [
    revisitHunk,
    path,
    items,
    hunkHeaderIndexes,
    currentHunkIndexRef,
    scrollToCurrent,
    clearRevisitHunk,
  ])
}

/** Scrolls to the current hunk again after the list re-renders, once asked to: a hunk marked read
 *  folds its lines away, which moves every later hunk up. */
function useRescroll(scrollToCurrent: () => void, diffKey: string) {
  const rescrollRef = useRef(false)
  useEffect(() => {
    rescrollRef.current = false
  }, [diffKey])
  useEffect(() => {
    if (!rescrollRef.current) return
    rescrollRef.current = false
    scrollToCurrent()
  }, [scrollToCurrent])
  return useCallback(() => {
    rescrollRef.current = true
  }, [])
}

/** The index of the hunk the keys act on, back to the first hunk when another diff opens. */
function useCurrentHunkIndex(diffKey: string) {
  const currentHunkIndexRef = useRef(0)
  useEffect(() => {
    currentHunkIndexRef.current = 0
  }, [diffKey])
  return currentHunkIndexRef
}

/** Moves between hunks, past the first or last into the previous or next file. The last hunk
 *  scrolled to is kept, since jsdom (and some real layouts) report untrustworthy rects. */
export function useHunkNav(src: HunkNavSource) {
  const { items, diffKey, onPrevFile, onNextFile, listRef } = src
  const currentHunkIndexRef = useCurrentHunkIndex(diffKey)
  const hunkHeaderIndexes = useMemo(
    () => items.flatMap((item, index) => [index].filter(() => item.kind === 'hunk-header')),
    [items]
  )
  const scrollToCurrent = useCallback(() => {
    const index = hunkHeaderIndexes[currentHunkIndexRef.current]
    if (index !== undefined) listRef.current?.scrollToIndex(index, 'start')
  }, [hunkHeaderIndexes, listRef, currentHunkIndexRef])
  useRevisitHunk({ src, hunkHeaderIndexes, currentHunkIndexRef, scrollToCurrent })
  const rescrollAfterRender = useRescroll(scrollToCurrent, diffKey)
  const scrollHunkIntoView = useCallback(
    (direction: 1 | -1) => {
      if (hunkHeaderIndexes.length === 0) return
      const nextIndex = currentHunkIndexRef.current + direction
      if (nextIndex < 0) return onPrevFile()
      if (nextIndex >= hunkHeaderIndexes.length) return onNextFile()
      currentHunkIndexRef.current = nextIndex
      scrollToCurrent()
    },
    [hunkHeaderIndexes, onNextFile, onPrevFile, scrollToCurrent, currentHunkIndexRef]
  )
  const currentHunk = () =>
    items[hunkHeaderIndexes[currentHunkIndexRef.current]] as HunkHeaderItem | undefined
  return { scrollHunkIntoView, currentHunk, rescrollAfterRender }
}

type HunkNav = ReturnType<typeof useHunkNav>

/** Space: marks the current hunk read, then moves to the next. `l`: puts it off, then moves on. */
export function hunkMarks(nav: HunkNav, src: HunkMarkSource) {
  return {
    markHunkRead: () => {
      const current = nav.currentHunk()
      if (current && !current.viewed) {
        nav.rescrollAfterRender()
        src.toggleHunkViewed(src.head, src.path, current.hunk.header)
      }
      nav.scrollHunkIntoView(1)
    },
    deferHunk: () => {
      const current = nav.currentHunk()
      if (current) src.deferHunk(src.laterKey, { path: src.path, header: current.hunk.header })
      nav.scrollHunkIntoView(1)
    },
  }
}

function selectionHere(src: KeyEventSource): LineSelection | null {
  if (src.selection && src.selection.path === src.path) return src.selection
  return null
}

/** What each review key event does in this pane. */
function keyEventHandlers(src: KeyEventSource): Array<[string, () => void]> {
  const commentOnSelection = () => {
    const sel = selectionHere(src)
    if (!sel || src.selectionTouchesRevealed(sel)) return
    src.setComposerAnchor(commentAnchor(sel))
  }
  return [
    [REVIEW_KEY_EVENTS.nextHunk, () => src.scrollHunkIntoView(1)],
    [REVIEW_KEY_EVENTS.prevHunk, () => src.scrollHunkIntoView(-1)],
    [REVIEW_KEY_EVENTS.markHunkRead, src.markHunkRead],
    [REVIEW_KEY_EVENTS.later, src.deferHunk],
    [REVIEW_KEY_EVENTS.comment, commentOnSelection],
  ]
}

/** REVIEW_KEY_EVENTS: the surface-level key handler (useReviewKeys) raises these; only the pane
 *  knows its hunks and selection. */
export function useReviewKeyEvents(src: KeyEventSource): void {
  const {
    enabled,
    selection,
    path,
    scrollHunkIntoView,
    markHunkRead,
    deferHunk,
    selectionTouchesRevealed,
  } = src
  useEffect(() => {
    if (!enabled) return
    const handlers = keyEventHandlers(src)
    for (const [event, handler] of handlers) window.addEventListener(event, handler)
    return () => {
      for (const [event, handler] of handlers) window.removeEventListener(event, handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    selection,
    path,
    scrollHunkIntoView,
    markHunkRead,
    deferHunk,
    selectionTouchesRevealed,
  ])
}
