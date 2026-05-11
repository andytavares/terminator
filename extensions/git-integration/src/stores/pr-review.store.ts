import { create } from 'zustand'
import type {
  ReviewSession,
  PrReviewDetail,
  ReviewQueuePR,
  Thread,
  RiskScore,
  SignalDots,
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
  nextPrCursor: string | undefined
  includeClosedPrs: boolean

  // Active review state
  activePr: PrReviewDetail | null
  currentChapterId: string | null
  currentFilePath: string | null

  // Per-file viewed tracking
  viewedFiles: Set<string>
  fileOrderOverrides: Record<string, string[]>
  scrollPosition: number | null
  pausedAt: string | null

  // Inline comments (keyed by path)
  threads: Record<string, Thread[]>

  // Cross-cutting
  rateLimitState: RateLimitState | null

  // ── Actions ────────────────────────────────────────────────────────────────

  setQueue(prs: ReviewQueuePR[]): void
  appendQueue(prs: ReviewQueuePR[]): void
  setQueueLoading(loading: boolean): void
  setLoadingMorePrs(loading: boolean): void
  setQueueError(error: string | null): void
  setHasMorePrs(hasMore: boolean): void
  setNextPrCursor(cursor: string | undefined): void
  setIncludeClosedPrs(include: boolean): void

  setActivePr(pr: PrReviewDetail | null): void
  setCurrentChapter(chapterId: string | null): void
  setCurrentFile(filePath: string | null): void

  markFileViewed(repoRoot: string, prNumber: number, headSHA: string, filePath: string): void
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

  updateFileRiskScore(chapterId: string, filePath: string, riskScore: RiskScore): void
  patchFileComplexity(chapterId: string, filePath: string, complexityDelta: number): void
  updateQueuePrRisk(
    prNumber: number,
    riskLevel: 'low' | 'medium' | 'high',
    signalDots: SignalDots
  ): void

  setRateLimitState(state: RateLimitState | null): void

  markPrInProgress(prNumber: number): void

  initSession(session: ReviewSession): void
  reset(): void
}

function sessionKey(repoRoot: string, prNumber: number, headSHA: string): string {
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
  }
  const key = sessionKey(repoRoot, prNumber, headSHA)
  await window.electronAPI.github.sessionSet(key, session)
}

export const usePrReviewStore = create<PrReviewStore>((set, get) => ({
  prQueue: [],
  queueLoading: false,
  loadingMorePrs: false,
  queueError: null,
  hasMorePrs: false,
  nextPrCursor: undefined,
  includeClosedPrs: false,
  activePr: null,
  currentChapterId: null,
  currentFilePath: null,
  viewedFiles: new Set(),
  fileOrderOverrides: {},
  scrollPosition: null,
  pausedAt: null,
  threads: {},
  rateLimitState: null,

  setQueue: (prs) => set({ prQueue: prs }),
  appendQueue: (prs) => set((state) => ({ prQueue: [...state.prQueue, ...prs] })),
  setQueueLoading: (loading) => set({ queueLoading: loading }),
  setLoadingMorePrs: (loading) => set({ loadingMorePrs: loading }),
  setQueueError: (error) => set({ queueError: error }),
  setHasMorePrs: (hasMore) => set({ hasMorePrs: hasMore }),
  setNextPrCursor: (cursor) => set({ nextPrCursor: cursor }),
  setIncludeClosedPrs: (include) => set({ includeClosedPrs: include }),

  setActivePr: (pr) => set({ activePr: pr }),
  setCurrentChapter: (chapterId) => set({ currentChapterId: chapterId }),
  setCurrentFile: (filePath) => set({ currentFilePath: filePath }),

  markFileViewed: (repoRoot, prNumber, headSHA, filePath) => {
    set((state) => {
      const next = new Set(state.viewedFiles)
      next.add(filePath)
      return { viewedFiles: next }
    })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
  },

  unmarkFileViewed: (repoRoot, prNumber, headSHA, filePath) => {
    set((state) => {
      const next = new Set(state.viewedFiles)
      next.delete(filePath)
      return { viewedFiles: next }
    })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
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

  markPrInProgress: (prNumber) =>
    set((state) => ({
      prQueue: state.prQueue.map((pr) =>
        pr.number === prNumber && pr.sessionStatus === 'not-started'
          ? { ...pr, sessionStatus: 'in-progress' }
          : pr
      ),
    })),

  initSession: (session) => {
    set({
      currentChapterId: session.currentChapterId,
      currentFilePath: session.currentFilePath,
      viewedFiles: new Set(session.viewedFiles),
      fileOrderOverrides: session.fileOrderOverrides,
      scrollPosition: session.scrollPosition,
      pausedAt: session.pausedAt,
    })
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
      threads: {},
      rateLimitState: null,
    }),
}))
