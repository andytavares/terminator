import { create } from 'zustand'
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

  markFileViewed(repoRoot: string, prNumber: number, headSHA: string, filePath: string): void
  markFilesViewed(repoRoot: string, prNumber: number, headSHA: string, filePaths: string[]): void
  unmarkFileViewed(repoRoot: string, prNumber: number, headSHA: string, filePath: string): void
  reorderFiles(
    chapterId: string,
    orderedPaths: string[],
    repoRoot: string,
    prNumber: number,
    headSHA: string
  ): void
  setScrollPosition(pos: number | null): void
  setPaused(repoRoot: string, prNumber: number, headSHA: string, isoTimestamp: string | null): void

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
  reconcileHead(
    repoRoot: string,
    prNumber: number,
    headSHA: string,
    changedPaths: string[] | 'all',
    addedPaths?: string[]
  ): void

  addNote(repoRoot: string, prNumber: number, headSHA: string, note: ReviewNote): void
  removeNote(repoRoot: string, prNumber: number, headSHA: string, id: string): void
  addDraft(repoRoot: string, prNumber: number, headSHA: string, draft: DraftComment): void
  updateDraft(repoRoot: string, prNumber: number, headSHA: string, id: string, body: string): void
  removeDraft(repoRoot: string, prNumber: number, headSHA: string, id: string): void
  clearDrafts(repoRoot: string, prNumber: number, headSHA: string): void
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

async function persistSession(
  store: Pick<
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
  >,
  repoRoot: string,
  prNumber: number,
  headSHA: string
): Promise<void> {
  if (typeof window === 'undefined') return
  const session: ReviewSession = {
    repoRoot,
    prNumber,
    headSHA,
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
  const key = sessionKey(repoRoot, prNumber)
  await githubAPI.sessionSet(key, session)
}

function nodeIdFor(state: Pick<PrReviewStore, 'activePr'>, prNumber: number): string | undefined {
  return state.activePr?.number === prNumber ? state.activePr.nodeId : undefined
}

function syncViewedMany(
  repoRoot: string,
  prNumber: number,
  paths: string[],
  nodeId?: string
): void {
  if (typeof window === 'undefined') return
  try {
    void Promise.resolve(githubAPI.filesViewedSet(repoRoot, prNumber, nodeId, paths, true)).catch(
      () => undefined
    )
  } catch {
    // No bridge: nothing to mirror to.
  }
}

/** Mirrors a viewed mark onto GitHub (S1). Best-effort: local state is the source of truth. */
function syncViewed(
  repoRoot: string,
  prNumber: number,
  path: string,
  viewed: boolean,
  nodeId?: string
): void {
  if (typeof window === 'undefined') return
  try {
    void Promise.resolve(githubAPI.fileViewedSet(repoRoot, prNumber, path, viewed, nodeId)).catch(
      () => undefined
    )
  } catch {
    // No bridge (a test or a detached view): nothing to mirror to.
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
  activePr: null,
  currentChapterId: null,
  currentFilePath: null,
  viewedFiles: new Set(),
  fileOrderOverrides: {},
  scrollPosition: null,
  pausedAt: null,
  viewedAt: {},
  changedSince: new Set(),
  newSinceLook: new Set(),
  lastSeenHeadSHA: null,
  historyRewritten: false,
  lastAccessedAt: null,
  notes: [],
  drafts: [],
  threads: {},
  issueComments: [],
  rateLimitState: null,
  currentUserLogin: null,

  setQueue: (prs) => set({ prQueue: prs }),
  appendQueue: (prs) => set((state) => ({ prQueue: [...state.prQueue, ...prs] })),
  setQueueLoading: (loading) => set({ queueLoading: loading }),
  setLoadingMorePrs: (loading) => set({ loadingMorePrs: loading }),
  setQueueError: (error) => set({ queueError: error }),
  setHasMorePrs: (hasMore) => set({ hasMorePrs: hasMore }),
  setTotalPrCount: (total) => set({ totalPrCount: total }),
  setNextPrCursor: (cursor) => set({ nextPrCursor: cursor }),

  setActivePr: (pr) => set({ activePr: pr }),
  setCurrentChapter: (chapterId) => set({ currentChapterId: chapterId }),
  setCurrentFile: (filePath) => set({ currentFilePath: filePath }),

  markFileViewed: (repoRoot, prNumber, headSHA, filePath) => {
    set((state) => {
      const next = new Set(state.viewedFiles)
      next.add(filePath)
      const changed = new Set(state.changedSince)
      changed.delete(filePath)
      return {
        viewedFiles: next,
        changedSince: changed,
        viewedAt: { ...state.viewedAt, [filePath]: headSHA },
        prQueue: state.prQueue.map((pr) =>
          pr.number === prNumber
            ? { ...pr, sessionStatus: 'in-progress' as const, viewedFileCount: next.size }
            : pr
        ),
      }
    })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
    syncViewed(repoRoot, prNumber, filePath, true, nodeIdFor(state, prNumber))
  },

  markFilesViewed: (repoRoot, prNumber, headSHA, filePaths) => {
    if (filePaths.length === 0) return
    set((state) => {
      const next = new Set(state.viewedFiles)
      const changed = new Set(state.changedSince)
      const viewedAt = { ...state.viewedAt }
      for (const path of filePaths) {
        next.add(path)
        changed.delete(path)
        viewedAt[path] = headSHA
      }
      return {
        viewedFiles: next,
        changedSince: changed,
        viewedAt,
        prQueue: state.prQueue.map((pr) =>
          pr.number === prNumber
            ? { ...pr, sessionStatus: 'in-progress' as const, viewedFileCount: next.size }
            : pr
        ),
      }
    })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
    syncViewedMany(repoRoot, prNumber, filePaths, nodeIdFor(state, prNumber))
  },

  unmarkFileViewed: (repoRoot, prNumber, headSHA, filePath) => {
    set((state) => {
      const next = new Set(state.viewedFiles)
      next.delete(filePath)
      const changed = new Set(state.changedSince)
      changed.delete(filePath)
      const viewedAt = { ...state.viewedAt }
      delete viewedAt[filePath]
      return {
        viewedFiles: next,
        changedSince: changed,
        viewedAt,
        prQueue: state.prQueue.map((pr) =>
          pr.number === prNumber ? { ...pr, viewedFileCount: next.size } : pr
        ),
      }
    })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
    syncViewed(repoRoot, prNumber, filePath, false, nodeIdFor(state, prNumber))
  },

  reorderFiles: (chapterId, orderedPaths, repoRoot, prNumber, headSHA) => {
    set((state) => ({
      fileOrderOverrides: { ...state.fileOrderOverrides, [chapterId]: orderedPaths },
    }))
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
  },

  setScrollPosition: (pos) => set({ scrollPosition: pos }),

  setPaused: (repoRoot, prNumber, headSHA, isoTimestamp) => {
    set({ pausedAt: isoTimestamp })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
  },

  setThreads: (path, threads) =>
    set((state) => ({ threads: { ...state.threads, [path]: threads } })),

  setIssueComments: (comments) => set({ issueComments: comments }),

  updateFileRiskScore: (chapterId, filePath, riskScore) =>
    set((state) => {
      if (!state.activePr) return {}
      const chapters = state.activePr.chapters.map((chapter) => {
        if (chapter.id !== chapterId) return chapter
        return {
          ...chapter,
          files: chapter.files.map((f) => (f.path === filePath ? { ...f, riskScore } : f)),
        }
      })
      return { activePr: { ...state.activePr, chapters } }
    }),

  updateFileRiskScores: (scores) =>
    set((state) => {
      if (!state.activePr) return {}
      const chapters = state.activePr.chapters.map((chapter) => ({
        ...chapter,
        files: chapter.files.map((f) => (scores[f.path] ? { ...f, riskScore: scores[f.path] } : f)),
      }))
      return { activePr: { ...state.activePr, chapters } }
    }),

  patchFileComplexity: (chapterId, filePath, complexityDelta) =>
    set((state) => {
      if (!state.activePr) return {}
      const chapters = state.activePr.chapters.map((chapter) => {
        if (chapter.id !== chapterId) return chapter
        return {
          ...chapter,
          files: chapter.files.map((f) => {
            if (f.path !== filePath) return f
            const prevComposite = f.riskScore.composite ?? 0
            // Simple adjustment: apply complexity weight (0.10 * 80) relative to thresholds
            const compContrib =
              complexityDelta <= 0 ? 0 : Math.min(1, complexityDelta / 15) * 0.1 * 80
            const newComposite = Math.min(
              100,
              Math.round(
                f.riskScore.metrics.changeSize != null ? prevComposite + compContrib : prevComposite
              )
            )
            const level: 'low' | 'medium' | 'high' =
              newComposite >= 67 ? 'high' : newComposite >= 34 ? 'medium' : 'low'
            return {
              ...f,
              riskScore: {
                ...f.riskScore,
                composite: newComposite || null,
                level,
                metrics: { ...f.riskScore.metrics, complexityDelta },
              },
            }
          }),
        }
      })
      return { activePr: { ...state.activePr, chapters } }
    }),

  updateQueuePrRisk: (prNumber, riskLevel, signalDots) =>
    set((state) => ({
      prQueue: state.prQueue.map((pr) =>
        pr.number === prNumber ? { ...pr, riskLevel, signalDots } : pr
      ),
    })),

  setRateLimitState: (s) => set({ rateLimitState: s }),
  setCurrentUserLogin: (login) => set({ currentUserLogin: login }),

  markPrInProgress: (prNumber) =>
    set((state) => ({
      prQueue: state.prQueue.map((pr) =>
        pr.number === prNumber && pr.sessionStatus === 'not-started'
          ? { ...pr, sessionStatus: 'in-progress' }
          : pr
      ),
    })),

  dismissPr: (prNumber) =>
    set((state) => ({
      prQueue: state.prQueue.filter((pr) => pr.number !== prNumber),
    })),

  initSession: (session) => {
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
    })
  },

  reconcileHead: (repoRoot, prNumber, headSHA, changedPaths, addedPaths = []) => {
    set((state) => {
      const touched = changedPaths === 'all' ? null : new Set(changedPaths)
      const viewed = new Set<string>()
      const changed = new Set(state.changedSince)
      for (const path of state.viewedFiles) {
        if (touched === null || touched.has(path)) changed.add(path)
        else viewed.add(path)
      }
      return {
        viewedFiles: viewed,
        changedSince: changed,
        historyRewritten: changedPaths === 'all' && changed.size > 0,
        newSinceLook: new Set(addedPaths),
      }
    })
    persistSession(get(), repoRoot, prNumber, headSHA)
  },

  addNote: (repoRoot, prNumber, headSHA, note) => {
    set((state) => ({ notes: [...state.notes, note] }))
    persistSession(get(), repoRoot, prNumber, headSHA)
  },

  removeNote: (repoRoot, prNumber, headSHA, id) => {
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }))
    persistSession(get(), repoRoot, prNumber, headSHA)
  },

  addDraft: (repoRoot, prNumber, headSHA, draft) => {
    set((state) => ({ drafts: [...state.drafts, draft] }))
    persistSession(get(), repoRoot, prNumber, headSHA)
  },

  updateDraft: (repoRoot, prNumber, headSHA, id, body) => {
    set((state) => ({ drafts: state.drafts.map((d) => (d.id === id ? { ...d, body } : d)) }))
    persistSession(get(), repoRoot, prNumber, headSHA)
  },

  removeDraft: (repoRoot, prNumber, headSHA, id) => {
    set((state) => ({ drafts: state.drafts.filter((d) => d.id !== id) }))
    persistSession(get(), repoRoot, prNumber, headSHA)
  },

  clearDrafts: (repoRoot, prNumber, headSHA) => {
    set({ drafts: [] })
    persistSession(get(), repoRoot, prNumber, headSHA)
  },

  reset: () =>
    set({
      activePr: null,
      currentChapterId: null,
      currentFilePath: null,
      viewedFiles: new Set(),
      fileOrderOverrides: {},
      scrollPosition: null,
      pausedAt: null,
      viewedAt: {},
      changedSince: new Set(),
      newSinceLook: new Set(),
      lastSeenHeadSHA: null,
      historyRewritten: false,
      lastAccessedAt: null,
      notes: [],
      drafts: [],
      threads: {},
      issueComments: [],
      rateLimitState: null,
    }),
}))
