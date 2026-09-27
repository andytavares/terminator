// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionSet = vi.fn().mockResolvedValue({ ok: true })
const fileViewedSet = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../src/api/github', () => ({
  githubAPI: {
    sessionSet: (...a: unknown[]) => sessionSet(...a),
    fileViewedSet: (...a: unknown[]) => fileViewedSet(...a),
  },
}))

import { usePrReviewStore, sessionKey, legacySessionKey } from '../../src/stores/pr-review.store'
import type { ReviewSession } from '../../src/schemas/pr-review.schema'

const REPO = '/Users/me/repos/terminator'

function session(overrides: Partial<ReviewSession> = {}): ReviewSession {
  return {
    repoRoot: REPO,
    prNumber: 211,
    headSHA: 'aaa111',
    currentChapterId: null,
    currentFilePath: null,
    viewedFiles: ['scripts/e2e-timings.ts', 'scripts/e2e-shard.ts', 'playwright.config.ts'],
    fileOrderOverrides: {},
    scrollPosition: null,
    pausedAt: null,
    lastAccessedAt: '2026-09-27T10:00:00.000Z',
    viewedAt: {
      'scripts/e2e-timings.ts': 'aaa111',
      'scripts/e2e-shard.ts': 'aaa111',
      'playwright.config.ts': 'aaa111',
    },
    notes: [],
    drafts: [],
    ...overrides,
  }
}

describe('pr-review store — session v2', () => {
  beforeEach(() => {
    usePrReviewStore.getState().reset()
    sessionSet.mockClear()
    fileViewedSet.mockClear()
  })

  it('keys a session by PR, not by head', () => {
    expect(sessionKey(REPO, 211)).toBe(`${REPO}:::211`)
    expect(legacySessionKey(REPO, 211, 'aaa111')).toBe(`${REPO}:::211:::aaa111`)
  })

  it('keeps unchanged viewed files and moves changed ones to changedSince after a push', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.reconcileHead(
      REPO,
      211,
      'bbb222',
      ['scripts/e2e-shard.ts', 'scripts/e2e-burn-in.ts'],
      ['scripts/e2e-burn-in.ts']
    )
    const s = usePrReviewStore.getState()
    expect([...s.newSinceLook]).toEqual(['scripts/e2e-burn-in.ts'])
    expect([...s.viewedFiles].sort()).toEqual(['playwright.config.ts', 'scripts/e2e-timings.ts'])
    expect([...s.changedSince]).toEqual(['scripts/e2e-shard.ts'])
    expect(s.historyRewritten).toBe(false)
    expect(s.lastSeenHeadSHA).toBe('aaa111')
  })

  it('treats every viewed file as changed when the old head is gone', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.reconcileHead(REPO, 211, 'bbb222', 'all')
    const s = usePrReviewStore.getState()
    expect(s.viewedFiles.size).toBe(0)
    expect(s.changedSince.size).toBe(3)
    expect(s.historyRewritten).toBe(true)
  })

  it('viewing a changed file again records the new head and syncs GitHub', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.reconcileHead(REPO, 211, 'bbb222', ['scripts/e2e-shard.ts'])
    usePrReviewStore.getState().markFileViewed(REPO, 211, 'bbb222', 'scripts/e2e-shard.ts')
    const s = usePrReviewStore.getState()
    expect(s.changedSince.has('scripts/e2e-shard.ts')).toBe(false)
    expect(s.viewedFiles.has('scripts/e2e-shard.ts')).toBe(true)
    expect(s.viewedAt['scripts/e2e-shard.ts']).toBe('bbb222')
    expect(fileViewedSet).toHaveBeenCalledWith(REPO, 211, 'scripts/e2e-shard.ts', true)
    const [key, persisted] = sessionSet.mock.calls.at(-1)!
    expect(key).toBe(`${REPO}:::211`)
    expect((persisted as ReviewSession).viewedAt['scripts/e2e-shard.ts']).toBe('bbb222')
  })

  it('unmarking forgets the viewed SHA and unsyncs GitHub', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.unmarkFileViewed(REPO, 211, 'aaa111', 'playwright.config.ts')
    const s = usePrReviewStore.getState()
    expect(s.viewedFiles.has('playwright.config.ts')).toBe(false)
    expect(s.viewedAt['playwright.config.ts']).toBeUndefined()
    expect(fileViewedSet).toHaveBeenCalledWith(REPO, 211, 'playwright.config.ts', false)
  })

  it('drafts and notes persist with the session', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.addDraft(REPO, 211, 'aaa111', {
      id: 'd1',
      path: 'src/hooks/usePrReview.ts',
      line: 317,
      startLine: null,
      side: 'RIGHT',
      body: 'computeRiskScore runs twice per file here (312 and 317).',
      fromFindingId: 'f1',
    })
    store.updateDraft(REPO, 211, 'aaa111', 'd1', 'Keep the scores from the loop.')
    store.addNote(REPO, 211, 'aaa111', {
      id: 'n1',
      path: 'src/hooks/usePrReview.ts',
      line: 312,
      body: 'why is this recomputed??',
      createdAt: '2026-09-27T10:00:00.000Z',
    })
    let s = usePrReviewStore.getState()
    expect(s.drafts[0].body).toBe('Keep the scores from the loop.')
    expect(s.notes).toHaveLength(1)
    const persisted = sessionSet.mock.calls.at(-1)![1] as ReviewSession
    expect(persisted.drafts).toHaveLength(1)
    expect(persisted.notes[0].body).toBe('why is this recomputed??')

    store.removeNote(REPO, 211, 'aaa111', 'n1')
    store.removeDraft(REPO, 211, 'aaa111', 'd1')
    s = usePrReviewStore.getState()
    expect(s.notes).toHaveLength(0)
    expect(s.drafts).toHaveLength(0)

    store.addDraft(REPO, 211, 'aaa111', { ...persisted.drafts[0], id: 'd2' })
    store.clearDrafts(REPO, 211, 'aaa111')
    expect(usePrReviewStore.getState().drafts).toHaveLength(0)
  })
})
