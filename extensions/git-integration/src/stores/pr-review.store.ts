import { create, type StoreApi } from 'zustand'
import { githubAPI } from '../api/github'
import type {
  ReviewSession,
  PrReviewDetail,
  ReviewQueuePR,
  Thread,
  IssueComment,
  RiskScore,
  SignalDots,
  ReviewNote,
  DraftComment,
  PrHead,
  PrChangedFile,
} from '../schemas/pr-review.schema'

interface RateLimitState {
  resetAt: number
}

interface PrReviewStore {
  // Queue state
  prQueue: ReviewQueuePR[]
  queueLoading: boolean
  loadingMorePrs: boolean
  queueError: string | null
  hasMorePrs: boolean
  /** Open PRs in the repository, not rows loaded. Null until the first load. */
  totalPrCount: number | null
  nextPrCursor: string | undefined

  // Active review state
  activePr: PrReviewDetail | null
  currentChapterId: string | null
  currentFilePath: string | null

  // Per-file viewed tracking
  viewedFiles: Set<string>
  fileOrderOverrides: Record<string, string[]>
  scrollPosition: number | null
  pausedAt: string | null
  /** Head SHA each viewed file was viewed at (S1). */
  viewedAt: Record<string, string>
  /** Files you viewed that a later push changed. Not counted as viewed. */
  changedSince: Set<string>
  /** Files a push added since you last looked (S1 "new file"). */
  newSinceLook: Set<string>
  /** The head the stored session last saw, before this open reconciled it. */
  lastSeenHeadSHA: string | null
  /** The history was rewritten under a viewed file; its interdiff is unavailable. */
  historyRewritten: boolean
  /** When the stored session was last opened, for the resume card (S2). */
  lastAccessedAt: string | null
  notes: ReviewNote[]
  drafts: DraftComment[]

  // Inline comments (keyed by path)
  threads: Record<string, Thread[]>

  // PR-level conversation comments
  issueComments: IssueComment[]

  // Cross-cutting
  rateLimitState: RateLimitState | null
  currentUserLogin: string | null

  // ── Actions ────────────────────────────────────────────────────────────────

  setQueue(prs: ReviewQueuePR[]): void
  appendQueue(prs: ReviewQueuePR[]): void
  setQueueLoading(loading: boolean): void
  setLoadingMorePrs(loading: boolean): void
  setQueueError(error: string | null): void
  setHasMorePrs(hasMore: boolean): void
  setTotalPrCount(total: number | null): void
  setNextPrCursor(cursor: string | undefined): void

  setActivePr(pr: PrReviewDetail | null): void
  setCurrentChapter(chapterId: string | null): void
  setCurrentFile(filePath: string | null): void

  markFileViewed(head: PrHead, filePath: string): void
  markFilesViewed(head: PrHead, filePaths: string[]): void
  unmarkFileViewed(head: PrHead, filePath: string): void
  reorderFiles(head: PrHead, chapterId: string, orderedPaths: string[]): void
  setScrollPosition(pos: number | null): void
  setPaused(head: PrHead, isoTimestamp: string | null): void

  setThreads(path: string, threads: Thread[]): void
  setIssueComments(comments: IssueComment[]): void

  updateFileRiskScore(chapterId: string, filePath: string, riskScore: RiskScore): void
  /** Applies many risk scores in one update, rebuilding the chapters once. */
  updateFileRiskScores(scores: Record<string, RiskScore>): void
  patchFileComplexity(chapterId: string, filePath: string, complexityDelta: number): void
  updateQueuePrRisk(
    prNumber: number,
    riskLevel: 'low' | 'medium' | 'high',
    signalDots: SignalDots
  ): void

  setRateLimitState(state: RateLimitState | null): void
  setCurrentUserLogin(login: string | null): void

  markPrInProgress(prNumber: number): void
  dismissPr(prNumber: number): void

  initSession(session: ReviewSession): void
  /**
   * Moves viewed files a push has since changed out of `viewedFiles` and into
   * `changedSince`. 'all' means the old head is gone (force-push), so every
   * viewed file must be looked at again.
   */
  reconcileHead(head: PrHead, changedPaths: string[] | 'all', addedPaths?: string[]): void

  addNote(head: PrHead, note: ReviewNote): void
  removeNote(head: PrHead, id: string): void
  addDraft(head: PrHead, draft: DraftComment): void
  updateDraft(head: PrHead, id: string, body: string): void
  removeDraft(head: PrHead, id: string): void
  clearDrafts(head: PrHead): void
  reset(): void
}

/**
 * v2 sessions are keyed by PR, not by head: a push must not start a blank
 * session. `legacySessionKey` is only read, to carry a v1 session forward.
 */
export function sessionKey(repoRoot: string, prNumber: number): string {
  return `${repoRoot}:::${prNumber}`
}

export function legacySessionKey(repoRoot: string, prNumber: number, headSHA: string): string {
  return `${repoRoot}:::${prNumber}:::${headSHA}`
}

type SetState = StoreApi<PrReviewStore>['setState']
type GetState = StoreApi<PrReviewStore>['getState']

/** The parts of the store a saved session keeps. */
type SessionFields = Pick<
  PrReviewStore,
  | 'viewedFiles'
  | 'fileOrderOverrides'
  | 'scrollPosition'
  | 'pausedAt'
  | 'currentChapterId'
  | 'currentFilePath'
  | 'viewedAt'
  | 'notes'
  | 'drafts'
>

/** Where a viewed mark is mirrored on GitHub: the PR, and its node id when it is the open one. */
interface ViewedTarget {
  repoRoot: string
  prNumber: number
  nodeId?: string
}

/** The fields reset() clears: everything tied to one open pull request. */
function emptyReviewState() {
  return {
    activePr: null,
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: new Set<string>(),
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    viewedAt: {},
    changedSince: new Set<string>(),
    newSinceLook: new Set<string>(),
    lastSeenHeadSHA: null,
    historyRewritten: false,
    lastAccessedAt: null,
    notes: [],
    drafts: [],
    threads: {},
    issueComments: [],
    rateLimitState: null,
  }
}

async function persistSession(store: SessionFields, head: PrHead): Promise<void> {
  if (typeof window === 'undefined') return
  const session: ReviewSession = {
    repoRoot: head.repoRoot,
    prNumber: head.prNumber,
    headSHA: head.headSHA,
    currentChapterId: store.currentChapterId,
    currentFilePath: store.currentFilePath,
    viewedFiles: [...store.viewedFiles],
    fileOrderOverrides: store.fileOrderOverrides,
    scrollPosition: store.scrollPosition,
    pausedAt: store.pausedAt,
    lastAccessedAt: new Date().toISOString(),
    viewedAt: store.viewedAt,
    notes: store.notes,
    drafts: store.drafts,
  }
  await githubAPI.sessionSet(sessionKey(head.repoRoot, head.prNumber), session)
}

function viewedTarget(state: Pick<PrReviewStore, 'activePr'>, head: PrHead): ViewedTarget {
  const nodeId = state.activePr?.number === head.prNumber ? state.activePr.nodeId : undefined
  return { repoRoot: head.repoRoot, prNumber: head.prNumber, nodeId }
}

/** Runs a GitHub mirror call, ignoring failure: local state is the source of truth (S1). */
function bestEffort(call: () => unknown): void {
  if (typeof window === 'undefined') return
  try {
    void Promise.resolve(call()).catch(() => undefined)
  } catch {
    // No bridge (a test or a detached view): nothing to mirror to.
  }
}

function syncViewedMany(target: ViewedTarget, paths: string[]): void {
  const { repoRoot, prNumber, nodeId } = target
  bestEffort(() => githubAPI.filesViewedSet({ repoRoot, prNumber, nodeId, paths, viewed: true }))
}

/** Mirrors a viewed mark onto GitHub (S1). */
function syncViewed(target: ViewedTarget, path: string, viewed: boolean): void {
  const { repoRoot, prNumber, nodeId } = target
  bestEffort(() => githubAPI.fileViewedSet({ repoRoot, prNumber, path, viewed, nodeId }))
}

function withViewedCount(
  queue: ReviewQueuePR[],
  prNumber: number,
  patch: Partial<ReviewQueuePR>
): ReviewQueuePR[] {
  return queue.map((pr) => (pr.number === prNumber ? { ...pr, ...patch } : pr))
}

/** `paths` marked viewed at `headSHA`, and no longer counted as changed since. */
function viewedAdded(state: PrReviewStore, paths: string[], head: PrHead) {
  const viewedFiles = new Set([...state.viewedFiles, ...paths])
  const changedSince = new Set([...state.changedSince].filter((p) => !paths.includes(p)))
  const viewedAt = { ...state.viewedAt }
  for (const path of paths) viewedAt[path] = head.headSHA
  const patch = { sessionStatus: 'in-progress' as const, viewedFileCount: viewedFiles.size }
  return {
    viewedFiles,
    changedSince,
    viewedAt,
    prQueue: withViewedCount(state.prQueue, head.prNumber, patch),
  }
}

function viewedRemoved(state: PrReviewStore, path: string, prNumber: number) {
  const viewedFiles = new Set([...state.viewedFiles].filter((p) => p !== path))
  const changedSince = new Set([...state.changedSince].filter((p) => p !== path))
  const viewedAt = { ...state.viewedAt }
  delete viewedAt[path]
  const prQueue = withViewedCount(state.prQueue, prNumber, { viewedFileCount: viewedFiles.size })
  return { viewedFiles, changedSince, viewedAt, prQueue }
}

/** Viewed files a push touched move to `changedSince`; 'all' (a force-push) moves every one. */
function reconciled(state: PrReviewStore, changedPaths: string[] | 'all', addedPaths: string[]) {
  const touched = changedPaths === 'all' ? null : new Set(changedPaths)
  const viewedFiles = new Set<string>()
  const changedSince = new Set(state.changedSince)
  for (const path of state.viewedFiles) {
    if (touched === null || touched.has(path)) changedSince.add(path)
    else viewedFiles.add(path)
  }
  const historyRewritten = changedPaths === 'all' && changedSince.size > 0
  return { viewedFiles, changedSince, historyRewritten, newSinceLook: new Set(addedPaths) }
}

/** The active PR with `update` applied to each file `matches` picks. */
function withFiles(
  activePr: PrReviewDetail,
  matches: (chapterId: string, path: string) => boolean,
  update: (file: PrChangedFile) => PrChangedFile
): PrReviewDetail {
  const chapters = activePr.chapters.map((chapter) => ({
    ...chapter,
    files: chapter.files.map((f) => (matches(chapter.id, f.path) ? update(f) : f)),
  }))
  return { ...activePr, chapters }
}

function riskLevelFor(composite: number): RiskScore['level'] {
  if (composite >= 67) return 'high'
  if (composite >= 34) return 'medium'
  return 'low'
}

/** Adds the complexity weight (0.10 of the 80-point scale) to a scored file's composite. */
function withComplexity(file: PrChangedFile, complexityDelta: number): PrChangedFile {
  const prevComposite = file.riskScore.composite ?? 0
  const compContrib = complexityDelta <= 0 ? 0 : Math.min(1, complexityDelta / 15) * 0.1 * 80
  const scored = file.riskScore.metrics.changeSize != null
  const newComposite = Math.min(
    100,
    Math.round(scored ? prevComposite + compContrib : prevComposite)
  )
  const riskScore: RiskScore = {
    ...file.riskScore,
    composite: newComposite || null,
    level: riskLevelFor(newComposite),
    metrics: { ...file.riskScore.metrics, complexityDelta },
  }
  return { ...file, riskScore }
}

function queueActions(set: SetState) {
  return {
    setQueue: (prs: ReviewQueuePR[]) => set({ prQueue: prs }),
    appendQueue: (prs: ReviewQueuePR[]) => set((s) => ({ prQueue: [...s.prQueue, ...prs] })),
    setQueueLoading: (loading: boolean) => set({ queueLoading: loading }),
    setLoadingMorePrs: (loading: boolean) => set({ loadingMorePrs: loading }),
    setQueueError: (error: string | null) => set({ queueError: error }),
    setHasMorePrs: (hasMore: boolean) => set({ hasMorePrs: hasMore }),
    setTotalPrCount: (total: number | null) => set({ totalPrCount: total }),
    setNextPrCursor: (cursor: string | undefined) => set({ nextPrCursor: cursor }),
    updateQueuePrRisk: (prNumber: number, riskLevel: RiskScore['level'], signalDots: SignalDots) =>
      set((s) => ({ prQueue: withViewedCount(s.prQueue, prNumber, { riskLevel, signalDots }) })),
    markPrInProgress: (prNumber: number) =>
      set((s) => ({
        prQueue: s.prQueue.map((pr) =>
          pr.number === prNumber && pr.sessionStatus === 'not-started'
            ? { ...pr, sessionStatus: 'in-progress' }
            : pr
        ),
      })),
    dismissPr: (prNumber: number) =>
      set((s) => ({ prQueue: s.prQueue.filter((pr) => pr.number !== prNumber) })),
  }
}

function viewedActions(set: SetState, get: GetState) {
  return {
    markFileViewed: (head: PrHead, filePath: string) => {
      set((state) => viewedAdded(state, [filePath], head))
      persistSession(get(), head)
      syncViewed(viewedTarget(get(), head), filePath, true)
    },
    markFilesViewed: (head: PrHead, filePaths: string[]) => {
      if (filePaths.length === 0) return
      set((state) => viewedAdded(state, filePaths, head))
      persistSession(get(), head)
      syncViewedMany(viewedTarget(get(), head), filePaths)
    },
    unmarkFileViewed: (head: PrHead, filePath: string) => {
      set((state) => viewedRemoved(state, filePath, head.prNumber))
      persistSession(get(), head)
      syncViewed(viewedTarget(get(), head), filePath, false)
    },
    reconcileHead: (head: PrHead, changedPaths: string[] | 'all', addedPaths: string[] = []) => {
      set((state) => reconciled(state, changedPaths, addedPaths))
      persistSession(get(), head)
    },
  }
}

function riskActions(set: SetState) {
  const updateFiles = (
    matches: (chapterId: string, path: string) => boolean,
    update: (file: PrChangedFile) => PrChangedFile
  ) =>
    set((state) => (state.activePr ? { activePr: withFiles(state.activePr, matches, update) } : {}))
  return {
    updateFileRiskScore: (chapterId: string, filePath: string, riskScore: RiskScore) =>
      updateFiles(
        (c, p) => c === chapterId && p === filePath,
        (f) => ({ ...f, riskScore })
      ),
    updateFileRiskScores: (scores: Record<string, RiskScore>) =>
      updateFiles(
        (_c, p) => !!scores[p],
        (f) => ({ ...f, riskScore: scores[f.path] })
      ),
    patchFileComplexity: (chapterId: string, filePath: string, complexityDelta: number) =>
      updateFiles(
        (c, p) => c === chapterId && p === filePath,
        (f) => withComplexity(f, complexityDelta)
      ),
  }
}

/** Notes and drafts, each change saved with the session. */
function noteActions(set: SetState, get: GetState) {
  const thenPersist = (head: PrHead) => persistSession(get(), head)
  return {
    addNote: (head: PrHead, note: ReviewNote) => {
      set((s) => ({ notes: [...s.notes, note] }))
      thenPersist(head)
    },
    removeNote: (head: PrHead, id: string) => {
      set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
      thenPersist(head)
    },
    addDraft: (head: PrHead, draft: DraftComment) => {
      set((s) => ({ drafts: [...s.drafts, draft] }))
      thenPersist(head)
    },
    updateDraft: (head: PrHead, id: string, body: string) => {
      set((s) => ({ drafts: s.drafts.map((d) => (d.id === id ? { ...d, body } : d)) }))
      thenPersist(head)
    },
    removeDraft: (head: PrHead, id: string) => {
      set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) }))
      thenPersist(head)
    },
    clearDrafts: (head: PrHead) => {
      set({ drafts: [] })
      thenPersist(head)
    },
  }
}

function sessionActions(set: SetState, get: GetState) {
  return {
    reorderFiles: (head: PrHead, chapterId: string, orderedPaths: string[]) => {
      set((s) => ({ fileOrderOverrides: { ...s.fileOrderOverrides, [chapterId]: orderedPaths } }))
      persistSession(get(), head)
    },
    setPaused: (head: PrHead, isoTimestamp: string | null) => {
      set({ pausedAt: isoTimestamp })
      persistSession(get(), head)
    },
    initSession: (session: ReviewSession) =>
      set({
        currentChapterId: session.currentChapterId,
        currentFilePath: session.currentFilePath,
        viewedFiles: new Set(session.viewedFiles),
        fileOrderOverrides: session.fileOrderOverrides,
        scrollPosition: session.scrollPosition,
        pausedAt: session.pausedAt,
        viewedAt: session.viewedAt ?? {},
        changedSince: new Set(),
        newSinceLook: new Set(),
        lastSeenHeadSHA: session.headSHA,
        historyRewritten: false,
        lastAccessedAt: session.lastAccessedAt,
        notes: session.notes ?? [],
        drafts: session.drafts ?? [],
      }),
  }
}

function viewActions(set: SetState) {
  return {
    setActivePr: (pr: PrReviewDetail | null) => set({ activePr: pr }),
    setCurrentChapter: (chapterId: string | null) => set({ currentChapterId: chapterId }),
    setCurrentFile: (filePath: string | null) => set({ currentFilePath: filePath }),
    setScrollPosition: (pos: number | null) => set({ scrollPosition: pos }),
    setThreads: (path: string, threads: Thread[]) =>
      set((s) => ({ threads: { ...s.threads, [path]: threads } })),
    setIssueComments: (comments: IssueComment[]) => set({ issueComments: comments }),
    setRateLimitState: (s: RateLimitState | null) => set({ rateLimitState: s }),
    setCurrentUserLogin: (login: string | null) => set({ currentUserLogin: login }),
    reset: () => set(emptyReviewState()),
  }
}

export const usePrReviewStore = create<PrReviewStore>((set, get) => ({
  prQueue: [],
  queueLoading: false,
  loadingMorePrs: false,
  queueError: null,
  hasMorePrs: false,
  totalPrCount: null,
  nextPrCursor: undefined,
  ...emptyReviewState(),
  currentUserLogin: null,
  ...queueActions(set),
  ...viewActions(set),
  ...viewedActions(set, get),
  ...riskActions(set),
  ...noteActions(set, get),
  ...sessionActions(set, get),
}))
