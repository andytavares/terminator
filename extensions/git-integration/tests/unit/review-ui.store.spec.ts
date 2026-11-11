// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { laterKey, useReviewUiStore } from '../../src/stores/review-ui.store'
import type { AgentRun } from '../../src/schemas/review-agent.schema'

const PREFS_KEY = 'git-integration.review-ui.prefs'

function run(id: string, status: AgentRun['status']): AgentRun {
  return {
    id,
    repoRoot: '/r',
    prNumber: 211,
    headSHA: 'aaa111',
    sessionId: `s-${id}`,
    scope: {
      kind: 'lines',
      path: 'src/hooks/usePrReview.ts',
      startLine: 309,
      endLine: 317,
      side: 'RIGHT',
      chapter: null,
    },
    request: 'review',
    question: null,
    status,
    startedAt: '2026-09-27T10:00:00.000Z',
    finishedAt: null,
    activity: [],
    summary: null,
    findings: [],
    walkthrough: [],
    error: null,
  }
}

beforeEach(() => {
  localStorage.clear()
  useReviewUiStore.setState({ diffRange: 'since' })
  useReviewUiStore.getState().resetForPr()
})

describe('review UI store', () => {
  it('remembers the diff range preference', () => {
    useReviewUiStore.getState().setDiffRange('whole')
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!)
    expect(saved).toMatchObject({ diffRange: 'whole' })
  })
})

describe('review UI store — defaults both list sorts to newest and remembers a change per list', () => {
  it('defaults both list sorts to newest and remembers a change per list', () => {
    expect(useReviewUiStore.getState()).toMatchObject({
      queueSort: 'newest',
      dashboardSort: 'newest',
    })
    useReviewUiStore.getState().setQueueSort('closest')
    useReviewUiStore.getState().setDashboardSort('started')
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!)
    expect(saved).toMatchObject({ queueSort: 'closest', dashboardSort: 'started' })
    expect(useReviewUiStore.getState().queueSort).toBe('closest')
    expect(useReviewUiStore.getState().dashboardSort).toBe('started')
  })

  it('replaces a saved sort that no longer exists with newest', async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ queueSort: 'oldest', dashboardSort: 'closest' })
    )
    vi.resetModules()
    const { useReviewUiStore: fresh } = await import('../../src/stores/review-ui.store')
    expect(fresh.getState()).toMatchObject({ queueSort: 'newest', dashboardSort: 'closest' })
  })
})

describe('review UI store — upserts agent runs newest first without duplicates', () => {
  it('upserts agent runs newest first without duplicates', () => {
    const s = useReviewUiStore.getState()
    s.upsertAgentRun(run('a', 'running'))
    s.upsertAgentRun(run('b', 'running'))
    s.upsertAgentRun(run('a', 'done'))
    const runs = useReviewUiStore.getState().agentRuns
    expect(runs.map((r) => `${r.id}:${r.status}`)).toEqual(['a:done', 'b:running'])
  })
})

describe('review UI store — loads persisted preferences from localStorage on module init', () => {
  it('loads a persisted diff range on module init', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ diffRange: 'whole' }))
    vi.resetModules()
    const fresh = await import('../../src/stores/review-ui.store')
    expect(fresh.useReviewUiStore.getState()).toMatchObject({ diffRange: 'whole' })
  })

  it('falls back to defaults when persisted JSON is malformed', async () => {
    localStorage.setItem(PREFS_KEY, '{not json')
    vi.resetModules()
    const fresh = await import('../../src/stores/review-ui.store')
    expect(fresh.useReviewUiStore.getState()).toMatchObject({ diffRange: 'since' })
  })
})

describe('review UI store — resetForPr clears per-PR state but keeps preferences', () => {
  it('resetForPr clears per-PR state but keeps preferences', () => {
    const s = useReviewUiStore.getState()
    s.setDiffRange('whole')
    s.setSelection({ path: 'a.ts', side: 'RIGHT', startLine: 1, endLine: 3 })
    s.upsertAgentRun(run('a', 'running'))
    s.setKeyboardHelpOpen(true)
    s.setFileHunks('a.ts', ['@@ -1 +1 @@'])
    s.resetForPr()
    const after = useReviewUiStore.getState()
    expect(after.fileHunks).toEqual({})
    expect(after.selection).toBeNull()
    expect(after.agentRuns).toEqual([])
    expect(after.keyboardHelpOpen).toBe(false)
    expect(after.diffRange).toBe('whole')
  })
})

describe('review UI store — later hunks', () => {
  const key = laterKey('/r', 211)
  const first = { path: 'src/a.ts', header: '@@ -1,2 +1,3 @@' }
  const second = { path: 'src/b.ts', header: '@@ -8,1 +8,2 @@' }

  beforeEach(() => useReviewUiStore.setState({ laterHunks: {}, revisitHunk: null }))

  it('hands back later hunks in the order they were put off, and marks each for revisiting', () => {
    const s = useReviewUiStore.getState()
    s.deferHunk(key, first)
    s.deferHunk(key, second)
    expect(s.takeLaterHunk(key)).toEqual(first)
    expect(useReviewUiStore.getState().revisitHunk).toEqual(first)
    expect(useReviewUiStore.getState().laterHunks[key]).toEqual([second])
  })

  it('keeps a hunk put off twice once, at the end', () => {
    const s = useReviewUiStore.getState()
    s.deferHunk(key, first)
    s.deferHunk(key, second)
    s.deferHunk(key, first)
    expect(useReviewUiStore.getState().laterHunks[key]).toEqual([second, first])
  })

  it('keeps each pull request’s later hunks apart, and across resetForPr', () => {
    const s = useReviewUiStore.getState()
    s.deferHunk(key, first)
    s.resetForPr()
    expect(s.takeLaterHunk(laterKey('/r', 212))).toBeNull()
    expect(useReviewUiStore.getState().laterHunks[key]).toEqual([first])
  })
})
