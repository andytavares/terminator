// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
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

describe('review UI store', () => {
  beforeEach(() => {
    localStorage.clear()
    useReviewUiStore.setState({
      commentVisibility: 'all',
      agentNotesOn: true,
      diffRange: 'since',
      fileListHidden: false,
      diffViewMode: 'unified',
      hideFormattingHunks: true,
    })
    useReviewUiStore.getState().resetForPr()
  })

  it('cycles comment visibility all → unresolved → hidden → all and remembers it', () => {
    const s = useReviewUiStore.getState()
    s.cycleCommentVisibility()
    expect(useReviewUiStore.getState().commentVisibility).toBe('unresolved')
    s.cycleCommentVisibility()
    expect(useReviewUiStore.getState().commentVisibility).toBe('hidden')
    expect(JSON.parse(localStorage.getItem(PREFS_KEY)!).commentVisibility).toBe('hidden')
    s.cycleCommentVisibility()
    expect(useReviewUiStore.getState().commentVisibility).toBe('all')
  })

  it('remembers agent notes, diff range and file list preferences', () => {
    const s = useReviewUiStore.getState()
    s.setAgentNotesOn(false)
    s.setDiffRange('whole')
    s.toggleFileList()
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!)
    expect(saved).toMatchObject({ agentNotesOn: false, diffRange: 'whole', fileListHidden: true })
  })

  it('defaults both list sorts to oldest and remembers a change per list', () => {
    expect(useReviewUiStore.getState()).toMatchObject({
      queueSort: 'oldest',
      dashboardSort: 'oldest',
    })
    useReviewUiStore.getState().setQueueSort('closest')
    useReviewUiStore.getState().setDashboardSort('started')
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!)
    expect(saved).toMatchObject({ queueSort: 'closest', dashboardSort: 'started' })
    expect(useReviewUiStore.getState().queueSort).toBe('closest')
    expect(useReviewUiStore.getState().dashboardSort).toBe('started')
  })

  it('upserts agent runs newest first without duplicates', () => {
    const s = useReviewUiStore.getState()
    s.upsertAgentRun(run('a', 'running'))
    s.upsertAgentRun(run('b', 'running'))
    s.upsertAgentRun(run('a', 'done'))
    const runs = useReviewUiStore.getState().agentRuns
    expect(runs.map((r) => `${r.id}:${r.status}`)).toEqual(['a:done', 'b:running'])
  })

  it('defaults diffViewMode to unified and hideFormattingHunks to true', () => {
    const s = useReviewUiStore.getState()
    expect(s.diffViewMode).toBe('unified')
    expect(s.hideFormattingHunks).toBe(true)
  })

  it('sets and persists diff view mode and formatting-hunk visibility', () => {
    const s = useReviewUiStore.getState()
    s.setDiffViewMode('split')
    s.setHideFormattingHunks(false)
    expect(useReviewUiStore.getState().diffViewMode).toBe('split')
    expect(useReviewUiStore.getState().hideFormattingHunks).toBe(false)
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY)!)
    expect(saved).toMatchObject({ diffViewMode: 'split', hideFormattingHunks: false })
  })

  it('loads persisted diffViewMode and hideFormattingHunks from localStorage on module init', async () => {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({ diffViewMode: 'split', hideFormattingHunks: false })
    )
    vi.resetModules()
    const fresh = await import('../../src/stores/review-ui.store')
    expect(fresh.useReviewUiStore.getState()).toMatchObject({
      diffViewMode: 'split',
      hideFormattingHunks: false,
    })
  })

  it('falls back to defaults when persisted JSON is malformed', async () => {
    localStorage.setItem(PREFS_KEY, '{not json')
    vi.resetModules()
    const fresh = await import('../../src/stores/review-ui.store')
    expect(fresh.useReviewUiStore.getState()).toMatchObject({
      diffViewMode: 'unified',
      hideFormattingHunks: true,
    })
  })

  it('resetForPr clears per-PR state but keeps preferences', () => {
    const s = useReviewUiStore.getState()
    s.setCommentVisibility('hidden')
    s.setSelection({ path: 'a.ts', side: 'RIGHT', startLine: 1, endLine: 3 })
    s.upsertAgentRun(run('a', 'running'))
    s.setKeyboardHelpOpen(true)
    s.resetForPr()
    const after = useReviewUiStore.getState()
    expect(after.selection).toBeNull()
    expect(after.agentRuns).toEqual([])
    expect(after.keyboardHelpOpen).toBe(false)
    expect(after.commentVisibility).toBe('hidden')
  })
})
