import { create } from 'zustand'
import type { ReviewSession, PrReviewDetail, ReviewQueuePR, Thread } from '../../../../src/shared/schemas/pr-review.schema'

interface RateLimitState {
  resetAt: number
}

interface PrReviewStore {
  // Queue state
  prQueue: ReviewQueuePR[]
  queueLoading: boolean
  queueError: string | null

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
  setQueueLoading(loading: boolean): void
  setQueueError(error: string | null): void

  setActivePr(pr: PrReviewDetail | null): void
  setCurrentChapter(chapterId: string | null): void
  setCurrentFile(filePath: string | null): void

  markFileViewed(repoRoot: string, prNumber: number, headSHA: string, filePath: string): void
  unmarkFileViewed(repoRoot: string, prNumber: number, headSHA: string, filePath: string): void
  reorderFiles(chapterId: string, orderedPaths: string[], repoRoot: string, prNumber: number, headSHA: string): void
  setScrollPosition(pos: number | null): void
  setPaused(repoRoot: string, prNumber: number, headSHA: string, isoTimestamp: string | null): void

  setThreads(path: string, threads: Thread[]): void

  setRateLimitState(state: RateLimitState | null): void

  initSession(session: ReviewSession): void
  reset(): void
}

function sessionKey(repoRoot: string, prNumber: number, headSHA: string): string {
  return `${repoRoot}:::${prNumber}:::${headSHA}`
}

async function persistSession(
  store: Pick<PrReviewStore, 'viewedFiles' | 'fileOrderOverrides' | 'scrollPosition' | 'pausedAt' | 'currentChapterId' | 'currentFilePath'>,
  repoRoot: string,
  prNumber: number,
  headSHA: string,
): Promise<void> {
  if (typeof window === 'undefined') return
  const session: ReviewSession = {
    repoRoot,
    prNumber,
    headSHA,
    currentChapterId:   store.currentChapterId,
    currentFilePath:    store.currentFilePath,
    viewedFiles:        [...store.viewedFiles],
    fileOrderOverrides: store.fileOrderOverrides,
    scrollPosition:     store.scrollPosition,
    pausedAt:           store.pausedAt,
    lastAccessedAt:     new Date().toISOString(),
  }
  const key = sessionKey(repoRoot, prNumber, headSHA)
  await window.electronAPI.github.sessionSet(key, session)
}

export const usePrReviewStore = create<PrReviewStore>((set, get) => ({
  prQueue:            [],
  queueLoading:       false,
  queueError:         null,
  activePr:           null,
  currentChapterId:   null,
  currentFilePath:    null,
  viewedFiles:        new Set(),
  fileOrderOverrides: {},
  scrollPosition:     null,
  pausedAt:           null,
  threads:            {},
  rateLimitState:     null,

  setQueue: (prs) => set({ prQueue: prs }),
  setQueueLoading: (loading) => set({ queueLoading: loading }),
  setQueueError: (error) => set({ queueError: error }),

  setActivePr: (pr) => set({ activePr: pr }),
  setCurrentChapter: (chapterId) => set({ currentChapterId: chapterId }),
  setCurrentFile: (filePath) => set({ currentFilePath: filePath }),

  markFileViewed: (repoRoot, prNumber, headSHA, filePath) => {
    set(state => {
      const next = new Set(state.viewedFiles)
      next.add(filePath)
      return { viewedFiles: next }
    })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
  },

  unmarkFileViewed: (repoRoot, prNumber, headSHA, filePath) => {
    set(state => {
      const next = new Set(state.viewedFiles)
      next.delete(filePath)
      return { viewedFiles: next }
    })
    const state = get()
    persistSession(state, repoRoot, prNumber, headSHA)
  },

  reorderFiles: (chapterId, orderedPaths, repoRoot, prNumber, headSHA) => {
    set(state => ({
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
    set(state => ({ threads: { ...state.threads, [path]: threads } })),

  setRateLimitState: (s) => set({ rateLimitState: s }),

  initSession: (session) => {
    set({
      currentChapterId:   session.currentChapterId,
      currentFilePath:    session.currentFilePath,
      viewedFiles:        new Set(session.viewedFiles),
      fileOrderOverrides: session.fileOrderOverrides,
      scrollPosition:     session.scrollPosition,
      pausedAt:           session.pausedAt,
    })
  },

  reset: () => set({
    activePr:           null,
    currentChapterId:   null,
    currentFilePath:    null,
    viewedFiles:        new Set(),
    fileOrderOverrides: {},
    scrollPosition:     null,
    pausedAt:           null,
    threads:            {},
    rateLimitState:     null,
  }),
}))
