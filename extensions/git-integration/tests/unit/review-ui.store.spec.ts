// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useReviewUiStore } from '../../src/stores/review-ui.store'
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
  useReviewUiStore.setState({
    diffRange: 'since',
    groupBy: 'all',
  })
  useReviewUiStore.getState().resetForPr()
})

describe('review UI store', () => {
  it('remembers the diff range preference', () => {
    useReviewUiStore.getState().setDiffRange('whole')
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!)
    expect(saved).toMatchObject({ diffRange: 'whole' })
  })
})

describe('review UI store — group by', () => {
  it('groups the file list by folders by default and remembers a switch to chapters', () => {
    expect(useReviewUiStore.getState().groupBy).toBe('all')
    useReviewUiStore.getState().setGroupBy('chapters')
    expect(useReviewUiStore.getState().groupBy).toBe('chapters')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).groupBy).toBe('chapters')
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
  it('loads a persisted diff range and grouping on module init', async () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ diffRange: 'whole', groupBy: 'chapters' }))
    vi.resetModules()
    const fresh = await import('../../src/stores/review-ui.store')
    expect(fresh.useReviewUiStore.getState()).toMatchObject({
      diffRange: 'whole',
      groupBy: 'chapters',
    })
  })

  it('falls back to defaults when persisted JSON is malformed', async () => {
    localStorage.setItem(PREFS_KEY, '{not json')
    vi.resetModules()
    const fresh = await import('../../src/stores/review-ui.store')
    expect(fresh.useReviewUiStore.getState()).toMatchObject({
      diffRange: 'since',
      groupBy: 'all',
    })
  })
})

describe('review UI store — resetForPr clears per-PR state but keeps preferences', () => {
  it('resetForPr clears per-PR state but keeps preferences', () => {
    const s = useReviewUiStore.getState()
    s.setDiffRange('whole')
    s.setSelection({ path: 'a.ts', side: 'RIGHT', startLine: 1, endLine: 3 })
    s.upsertAgentRun(run('a', 'running'))
    s.setKeyboardHelpOpen(true)
    s.resetForPr()
    const after = useReviewUiStore.getState()
    expect(after.selection).toBeNull()
    expect(after.agentRuns).toEqual([])
    expect(after.keyboardHelpOpen).toBe(false)
    expect(after.diffRange).toBe('whole')
  })
})
