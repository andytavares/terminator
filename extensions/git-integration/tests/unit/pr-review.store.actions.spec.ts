import { describe, it, expect, beforeEach } from 'vitest'
import { usePrReviewStore } from '../../src/stores/pr-review.store'
import {
  PrReviewDetailSchema,
  ReviewSessionSchema,
  ThreadSchema,
  type PrReviewDetail,
} from '../../src/schemas/pr-review.schema'
import { reviewQueuePr } from './support/review-queue-pr'

// persistSession checks `typeof window === 'undefined'` and returns early in Node
// so all state-mutation tests work cleanly without a DOM mock.

const makePR = reviewQueuePr

/** One chapter with one modified file: what the schema is handed for an active review. */
const DETAIL_INPUT = {
  number: 42,
  title: 'Fix: memory leak',
  body: 'Description here',
  author: 'alice',
  authorAvatarUrl: '',
  openedAt: '2024-01-01T00:00:00Z',
  headRefName: 'fix/memory-leak',
  baseRefName: 'main',
  headSHA: 'abc1234',
  ciStatus: 'passing',
  chapters: [
    {
      id: 'ch-1',
      name: 'Core Changes',
      files: [
        {
          path: 'src/app.ts',
          changeType: 'modified',
          additions: 10,
          deletions: 5,
          isBinary: false,
          whyHere: 'core logic',
        },
      ],
      status: 'not-started',
    },
  ],
}

/** Parses afresh each time, so no case sees another's changes. */
const makeDetail = (): PrReviewDetail => PrReviewDetailSchema.parse(DETAIL_INPUT)

function resetStore() {
  usePrReviewStore.setState({
    prQueue: [],
    queueLoading: false,
    loadingMorePrs: false,
    queueError: null,
    hasMorePrs: false,
    nextPrCursor: undefined,
    activePr: null,
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: new Set(),
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    threads: {},
    rateLimitState: null,
  })
}

function useFreshPrReviewStore(): void {
  beforeEach(resetStore)
}

describe('usePrReviewStore — queue management', () => {
  useFreshPrReviewStore()

  it('appendQueue adds to existing queue', () => {
    usePrReviewStore.setState({ prQueue: [makePR(1)] })
    usePrReviewStore.getState().appendQueue([makePR(2), makePR(3)])
    expect(usePrReviewStore.getState().prQueue).toHaveLength(3)
  })
})

describe('usePrReviewStore — viewed files tracking', () => {
  useFreshPrReviewStore()

  it('markFileViewed adds file to viewedFiles set', () => {
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    expect(usePrReviewStore.getState().viewedFiles.has('src/app.ts')).toBe(true)
  })

  it('markFileViewed is idempotent', () => {
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    expect(usePrReviewStore.getState().viewedFiles.size).toBe(1)
  })

  it('unmarkFileViewed removes file from viewedFiles', () => {
    usePrReviewStore.setState({ viewedFiles: new Set(['src/app.ts']) })
    usePrReviewStore
      .getState()
      .unmarkFileViewed({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc1234' }, 'src/app.ts')
    expect(usePrReviewStore.getState().viewedFiles.has('src/app.ts')).toBe(false)
  })
})

describe('usePrReviewStore — file reordering', () => {
  useFreshPrReviewStore()

  it('reorderFiles updates fileOrderOverrides', () => {
    usePrReviewStore
      .getState()
      .reorderFiles({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, 'ch-1', [
        'src/b.ts',
        'src/a.ts',
      ])
    expect(usePrReviewStore.getState().fileOrderOverrides['ch-1']).toEqual(['src/b.ts', 'src/a.ts'])
  })

  it('reorderFiles preserves overrides for other chapters', () => {
    usePrReviewStore.setState({ fileOrderOverrides: { 'ch-2': ['x.ts'] } })
    usePrReviewStore
      .getState()
      .reorderFiles({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, 'ch-1', ['src/b.ts'])
    expect(usePrReviewStore.getState().fileOrderOverrides['ch-2']).toEqual(['x.ts'])
  })
})

describe('usePrReviewStore — pause state', () => {
  useFreshPrReviewStore()

  it('setPaused stores timestamp', () => {
    usePrReviewStore
      .getState()
      .setPaused({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, '2024-01-01T12:00:00Z')
    expect(usePrReviewStore.getState().pausedAt).toBe('2024-01-01T12:00:00Z')
  })

  it('setPaused clears with null', () => {
    usePrReviewStore.setState({ pausedAt: '2024-01-01T12:00:00Z' })
    usePrReviewStore.getState().setPaused({ repoRoot: '/repo', prNumber: 42, headSHA: 'abc' }, null)
    expect(usePrReviewStore.getState().pausedAt).toBeNull()
  })
})

describe('usePrReviewStore — threads', () => {
  useFreshPrReviewStore()

  it('setThreads stores thread list by path', () => {
    const threads = [
      ThreadSchema.parse({
        id: 't-1',
        path: 'src/app.ts',
        line: 42,
        startLine: null,
        side: 'RIGHT',
        outdated: false,
        comments: [],
        collapsed: false,
      }),
    ]
    usePrReviewStore.getState().setThreads('src/app.ts', threads)
    expect(usePrReviewStore.getState().threads['src/app.ts']).toEqual(threads)
  })
})

describe('usePrReviewStore — replacing threads', () => {
  useFreshPrReviewStore()

  it('setThreads overwrites existing threads for the same path', () => {
    usePrReviewStore.setState({ threads: { 'src/app.ts': [] } })
    const threads = [
      ThreadSchema.parse({
        id: 't-1',
        path: 'src/app.ts',
        line: 10,
        startLine: null,
        side: 'RIGHT',
        outdated: false,
        comments: [],
        collapsed: false,
      }),
    ]
    usePrReviewStore.getState().setThreads('src/app.ts', threads)
    expect(usePrReviewStore.getState().threads['src/app.ts']).toHaveLength(1)
  })
})

describe('usePrReviewStore — updateFileChurn', () => {
  useFreshPrReviewStore()

  it('sets the 90-day commit count of each file it names', () => {
    usePrReviewStore.setState({ activePr: makeDetail() })
    usePrReviewStore.getState().updateFileChurn({ 'src/app.ts': 12 })
    expect(usePrReviewStore.getState().activePr?.chapters[0].files[0].churn90d).toBe(12)
  })

  it('leaves a file it does not name unmeasured', () => {
    usePrReviewStore.setState({ activePr: makeDetail() })
    usePrReviewStore.getState().updateFileChurn({ 'src/other.ts': 3 })
    expect(usePrReviewStore.getState().activePr?.chapters[0].files[0].churn90d).toBeNull()
  })

  it('is a no-op when activePr is null', () => {
    usePrReviewStore.getState().updateFileChurn({ 'src/app.ts': 12 })
    expect(usePrReviewStore.getState().activePr).toBeNull()
  })
})

describe('usePrReviewStore — initSession', () => {
  useFreshPrReviewStore()

  it('restores session state from ReviewSession object', () => {
    const session = ReviewSessionSchema.parse({
      repoRoot: '/repo',
      prNumber: 42,
      headSHA: 'abc',
      currentChapterId: 'ch-2',
      currentFilePath: 'src/util.ts',
      viewedFiles: ['src/app.ts', 'src/util.ts'],
      fileOrderOverrides: { 'ch-1': ['src/b.ts', 'src/a.ts'] },
      scrollPosition: 500,
      pausedAt: null,
      lastAccessedAt: '2024-01-01T00:00:00Z',
    })
    usePrReviewStore.getState().initSession(session)
    const state = usePrReviewStore.getState()
    expect(state.currentChapterId).toBe('ch-2')
    expect(state.currentFilePath).toBe('src/util.ts')
    expect(state.viewedFiles.has('src/app.ts')).toBe(true)
    expect(state.viewedFiles.has('src/util.ts')).toBe(true)
    expect(state.fileOrderOverrides['ch-1']).toEqual(['src/b.ts', 'src/a.ts'])
    expect(state.scrollPosition).toBe(500)
  })
})

describe('usePrReviewStore — reset', () => {
  useFreshPrReviewStore()

  it('clears active PR, chapters, viewed files, and threads', () => {
    usePrReviewStore.setState({
      activePr: makeDetail(),
      currentChapterId: 'ch-1',
      currentFilePath: 'src/app.ts',
      viewedFiles: new Set(['src/app.ts']),
      fileOrderOverrides: { 'ch-1': ['a.ts'] },
      scrollPosition: 200,
      threads: { 'src/app.ts': [] },
    })
    usePrReviewStore.getState().reset()
    const state = usePrReviewStore.getState()
    expect(state.activePr).toBeNull()
    expect(state.currentChapterId).toBeNull()
    expect(state.currentFilePath).toBeNull()
    expect(state.viewedFiles.size).toBe(0)
    expect(Object.keys(state.fileOrderOverrides)).toHaveLength(0)
    expect(state.scrollPosition).toBeNull()
    expect(Object.keys(state.threads)).toHaveLength(0)
  })

  it('does not clear prQueue', () => {
    usePrReviewStore.setState({ prQueue: [makePR(1)] })
    usePrReviewStore.getState().reset()
    expect(usePrReviewStore.getState().prQueue).toHaveLength(1)
  })
})

describe('usePrReviewStore — updateFileBlastRadius', () => {
  useFreshPrReviewStore()

  it('sets the blast radius of each file it names', () => {
    usePrReviewStore.setState({ activePr: makeDetail() })
    usePrReviewStore
      .getState()
      .updateFileBlastRadius({ 'src/app.ts': { usedIn: 14, alsoDefinedIn: 2 } })
    expect(usePrReviewStore.getState().activePr?.chapters[0].files[0].blastRadius).toEqual({
      usedIn: 14,
      alsoDefinedIn: 2,
    })
  })

  it('leaves a file it does not name unmeasured', () => {
    usePrReviewStore.setState({ activePr: makeDetail() })
    usePrReviewStore
      .getState()
      .updateFileBlastRadius({ 'src/other.ts': { usedIn: 3, alsoDefinedIn: 0 } })
    expect(usePrReviewStore.getState().activePr?.chapters[0].files[0].blastRadius).toBeNull()
  })
})
