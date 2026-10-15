import React, { useCallback, useMemo, useRef } from 'react'
import { VirtualDiffList, type VirtualDiffListHandle } from './VirtualDiffList'
import { detectLanguage } from '../FileDiffView'
import { useLoadInlineComments } from '../../hooks/usePrReview'
import { useSplitDrag } from '../../hooks/useSplitDrag'
import type { PrChangedFile, PrReviewDetail, PrHead } from '../../schemas/pr-review.schema'
import type { FileDiff } from '../../schemas/git.schema'
import type { DiffItem } from '../../review/diff-items'
import { REWRITTEN_NOTE, useDiffLoad } from './diff-pane/useDiffLoad'
import { useGaps } from './diff-pane/useFileText'
import { useLineLookups } from './diff-pane/line-lookups'
import { useLineSelection } from './diff-pane/useLineSelection'
import {
  useComposerRequest,
  useFileNavEvents,
  useHunkNav,
  useReviewKeyEvents,
} from './diff-pane/usePaneEvents'
import {
  findChapterId,
  useAnnotating,
  useComplexityPatch,
  useDiffItems,
  useMovedMarks,
  usePaneReviewStore,
  usePaneUiStore,
  useTests,
  useViewedHunks,
} from './diff-pane/usePaneState'
import { maxLineNumber, numColWidthFor } from './diff-pane/lines'
import { renderDiffItem } from './diff-pane/rows'
import { FileHeader } from './diff-pane/FileHeader'
import type { PaneContext } from './diff-pane/types'
import './review-surface.css'

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  file: PrChangedFile
  onMarkViewed: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onShowRisk: () => void
}

type ReviewStore = ReturnType<typeof usePaneReviewStore>

type UiStore = ReturnType<typeof usePaneUiStore>

type DiffView = ReturnType<typeof useDiffView>

type LineState = ReturnType<typeof useLineState>

interface Wiring {
  props: Props
  store: ReviewStore
  ui: UiStore
  view: DiffView
  lines: LineState
  head: PrHead
}

interface ActionExtras {
  refreshComments: () => void
  goToPath: (path: string) => void
  showHiddenComments: () => void
}

interface ContextParts {
  w: Wiring
  tests: PaneContext['tests']
  layout: PaneContext['layout']
  actions: PaneContext['actions']
}

type ScrollRef = React.RefObject<HTMLDivElement>

type ListRef = React.RefObject<VirtualDiffListHandle>

type PaneState = ReturnType<typeof useReviewDiffPane>

/** Which diff to show. Only a since-range view reads when the file was last viewed: depending on
 *  the whole viewedAt map would refetch the open file every time it is marked viewed. */
function diffRequest(props: Props, store: ReviewStore, ui: UiStore) {
  const { pr, file } = props
  const changedSince = store.changedSince.has(file.path)
  const sinceSha =
    (ui.diffRange === 'since' && changedSince && store.viewedAt[file.path]) || undefined
  const range = (sinceSha && `since:${sinceSha}`) || 'whole'
  return {
    diffKey: `${pr.number}:${pr.headSHA}:${file.path}:${range}`,
    repoRoot: props.repoRoot,
    prNumber: pr.number,
    headSHA: pr.headSHA,
    baseRefName: pr.baseRefName,
    path: file.path,
    sinceSha,
  }
}

/** The reading-order uses whose definition is in an earlier step of this review. */
function useUsesWithDefinition(pr: PrReviewDetail, path: string) {
  return useMemo(() => {
    const step = pr.readingOrder.find((s) => s.path === path)
    return (step?.uses ?? []).filter((u) => u.definedInStep != null)
  }, [pr.readingOrder, path])
}

/** Opening another file of the PR, in its own chapter. */
function useGoToPath(pr: PrReviewDetail, store: ReviewStore) {
  const { setCurrentChapter, setCurrentFile } = store
  return useCallback(
    (path: string) => {
      const chapterId = findChapterId(pr.chapters, path)
      if (chapterId) setCurrentChapter(chapterId)
      setCurrentFile(path)
    },
    [pr.chapters, setCurrentChapter, setCurrentFile]
  )
}

function useNumColWidth(diff: FileDiff | null, fileLineCount: number): number {
  return useMemo(() => {
    if (!diff) return 44
    return numColWidthFor(maxLineNumber(diff.hunks, fileLineCount))
  }, [diff, fileLineCount])
}

function readyLineCount(fileText: PaneContext['gaps']['fileText']): number {
  if (fileText.status !== 'ready') return 0
  return fileText.lines.length
}

/** The diff, its gaps and the list's entries for the file shown. */
function useDiffView(props: Props, store: ReviewStore, ui: UiStore) {
  const { pr, file } = props
  const request = diffRequest(props, store, ui)
  const loaded = useDiffLoad(request, Boolean(file.isBinary))
  const { diff } = loaded
  useComplexityPatch({
    diff,
    path: file.path,
    chapters: pr.chapters,
    patchFileComplexity: store.patchFileComplexity,
  })
  const target = {
    repoRoot: props.repoRoot,
    prNumber: pr.number,
    headSHA: pr.headSHA,
    path: file.path,
  }
  const gaps = useGaps({ target, diff, isBinary: file.isBinary, diffKey: request.diffKey })
  const moved = useMovedMarks(pr.movedBlocks, file.path)
  const viewedHunks = useViewedHunks(store.viewedHunks[file.path])
  const items = useDiffItems({
    diff,
    mode: ui.diffViewMode,
    hideFormattingHunks: ui.hideFormattingHunks,
    gapViews: gaps.gapViews,
    movedMark: moved.movedMark,
    viewedHunks,
  })
  return { request, loaded, gaps, moved, items }
}

/** The line lookups, drag selection and composers for the file shown. */
function useLineState(src: { props: Props; store: ReviewStore; ui: UiStore; head: PrHead }) {
  const { props, store, ui, head } = src
  const { pr, file } = props
  const fileThreads = useMemo(() => store.threads[file.path] ?? [], [store.threads, file.path])
  const lookups = useLineLookups({
    path: file.path,
    fileThreads,
    commentVisibility: ui.commentVisibility,
    agentRuns: ui.agentRuns,
    notes: store.notes,
    drafts: store.drafts,
    insights: pr.insights,
  })
  const drag = useLineSelection({
    path: file.path,
    selection: ui.selection,
    setSelection: ui.setSelection,
  })
  const annot = useAnnotating({ head, path: file.path, addNote: store.addNote })
  useComposerRequest({
    path: file.path,
    composerRequest: ui.composerRequest,
    requestComposer: ui.requestComposer,
    setComposerAnchor: annot.setComposerAnchor,
  })
  return { lookups, drag, annot }
}

/** Opens the file defining the first symbol this file uses from an earlier step. */
function peekFirstDefinition(
  usesWithDef: ReturnType<typeof useUsesWithDefinition>,
  goToPath: (path: string) => void
): void {
  const use = usesWithDef[0]
  if (use?.definedInPath) goToPath(use.definedInPath)
}

/** Hunk keys, file keys and the review key events the surface raises for this pane. */
function useNavigation(
  w: Wiring,
  usesWithDef: ReturnType<typeof useUsesWithDefinition>,
  listRef: React.RefObject<VirtualDiffListHandle>
) {
  const { props, ui, view } = w
  const goToPath = useGoToPath(props.pr, w.store)
  useFileNavEvents(props.onPrevFile, props.onMarkViewed)
  const { onPrevFile, onNextFile } = props
  const nav = useHunkNav({
    items: view.items,
    diffKey: view.request.diffKey,
    onPrevFile,
    onNextFile,
    listRef,
  })
  const peekDefinition = () => peekFirstDefinition(usesWithDef, goToPath)
  useReviewKeyEvents({
    selection: ui.selection,
    path: props.file.path,
    diff: view.loaded.diff,
    scrollHunkIntoView: nav.scrollHunkIntoView,
    openAgentPanel: ui.openAgentPanel,
    selectionTouchesRevealed: view.gaps.selectionTouchesRevealed,
    setComposerAnchor: w.lines.annot.setComposerAnchor,
    setNoteAnchor: w.lines.annot.setNoteAnchor,
    peekDefinition,
  })
  return { goToPath, peekDefinition }
}

function paneActions(w: Wiring, extra: ActionExtras) {
  const { store, ui } = w
  return {
    ...extra,
    commentVisibility: ui.commentVisibility,
    agentNotesOn: ui.agentNotesOn,
    setHideFormattingHunks: ui.setHideFormattingHunks,
    openAgentPanel: ui.openAgentPanel,
    removeNote: store.removeNote,
    updateDraft: store.updateDraft,
    removeDraft: store.removeDraft,
    toggleMoved: w.view.moved.toggleMoved,
    toggleHunkViewed: store.toggleHunkViewed,
  }
}

function paneContext(parts: ContextParts): PaneContext {
  const { w, tests, layout, actions } = parts
  const { props, ui, lines, view } = w
  return {
    repoRoot: props.repoRoot,
    pr: props.pr,
    file: props.file,
    head: w.head,
    diff: view.loaded.diff,
    mode: ui.diffViewMode,
    lang: detectLanguage(props.file.path),
    selection: ui.selection,
    lookups: lines.lookups,
    drag: lines.drag,
    annot: lines.annot,
    tests,
    layout,
    gaps: view.gaps,
    actions,
  }
}

/** The pane's stores, diff and line state, wired together. */
function useWiring(props: Props): Wiring {
  const { repoRoot, pr } = props
  const store = usePaneReviewStore()
  const ui = usePaneUiStore()
  const head = useMemo(
    () => ({ repoRoot, prNumber: pr.number, headSHA: pr.headSHA }),
    [repoRoot, pr.number, pr.headSHA]
  )
  const view = useDiffView(props, store, ui)
  const lines = useLineState({ props, store, ui, head })
  return { props, store, ui, view, lines, head }
}

function useReviewDiffPane(props: Props, scrollRef: ScrollRef, listRef: ListRef) {
  const w = useWiring(props)
  const { pr, file } = props
  const usesWithDef = useUsesWithDefinition(pr, file.path)
  const nav = useNavigation(w, usesWithDef, listRef)
  const divider = useSplitDrag(scrollRef)
  const refreshComments = useLoadInlineComments(props.repoRoot)
  const { setCommentVisibility } = w.ui
  const showHiddenComments = useCallback(() => setCommentVisibility('all'), [setCommentVisibility])
  const { diff } = w.view.loaded
  const tests = useTests({
    head: w.head,
    path: file.path,
    chapters: pr.chapters,
    goToPath: nav.goToPath,
    diff,
    items: w.view.items,
    listRef,
  })
  const layout = {
    numColWidth: useNumColWidth(diff, readyLineCount(w.view.gaps.fileText)),
    splitLeftPct: divider.splitLeftPct,
    onSplitDividerMouseDown: divider.onDividerMouseDown,
  }
  const actions = paneActions(w, { refreshComments, goToPath: nav.goToPath, showHiddenComments })
  return { ctx: paneContext({ w, tests, layout, actions }), w, usesWithDef, nav }
}

function PaneDiffBody(props: { pane: PaneState; scrollRef: ScrollRef; listRef: ListRef }) {
  const { ctx, w } = props.pane
  const { diff, diffLoading, diffError } = w.view.loaded
  if (ctx.file.isBinary)
    return <div className="review-diff-binary">Binary file — diff not available.</div>
  if (diffLoading) return <div className="review-diff-loading">Loading diff…</div>
  if (diffError) return <div className="review-diff-error">Failed to load diff: {diffError}</div>
  if (!diff) return null
  return (
    <div className={`review-diff-table-wrap review-diff-table-wrap--${ctx.mode}`}>
      <VirtualDiffList
        items={w.view.items}
        scrollRef={props.scrollRef}
        renderItem={(item: DiffItem) => renderDiffItem(ctx, item)}
        handleRef={props.listRef}
      />
    </div>
  )
}

/** The note beside the view menu: the diff's own note, else the rewritten-history note. */
function menuNote(pane: PaneState): string | null {
  const { store } = pane.w
  const path = pane.ctx.file.path
  const historyNote =
    (store.historyRewritten && store.changedSince.has(path) && REWRITTEN_NOTE) || null
  return pane.w.view.loaded.sinceNote ?? historyNote
}

function toggleFileViewed(store: ReviewStore) {
  return (head: PrHead, path: string, viewed: boolean) => {
    if (viewed) store.markFileViewed(head, path)
    else store.unmarkFileViewed(head, path)
  }
}

function PaneHeader({ pane, props }: { pane: PaneState; props: Props }) {
  const { store, ui } = pane.w
  const { file } = props
  return (
    <FileHeader
      file={file}
      head={pane.ctx.head}
      isViewed={store.viewedFiles.has(file.path)}
      viewedFiles={store.viewedFiles}
      showChangedSince={store.changedSince.has(file.path) && ui.diffRange === 'since'}
      usesWithDef={pane.usesWithDef}
      menuNote={menuNote(pane)}
      onShowRisk={props.onShowRisk}
      onPeekDefinition={pane.nav.peekDefinition}
      setViewed={toggleFileViewed(store)}
    />
  )
}

export function ReviewDiffPane(props: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<VirtualDiffListHandle>(null)
  const pane = useReviewDiffPane(props, scrollRef, listRef)
  return (
    <div className="review-diff-pane">
      <PaneHeader pane={pane} props={props} />
      <div
        className="review-diff-scroll"
        ref={scrollRef}
        onClick={pane.ctx.drag.clearSelectionOnBackgroundClick}
      >
        <PaneDiffBody pane={pane} scrollRef={scrollRef} listRef={listRef} />
      </div>
    </div>
  )
}
