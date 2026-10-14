// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionSet = vi.fn().mockResolvedValue({ ok: true })
const fileViewedSet = vi.fn().mockResolvedValue({ ok: true })
const filesViewedSet = vi.fn().mockResolvedValue({ ok: true })
vi.mock('../../src/api/github', () => ({
  githubAPI: {
    sessionSet: (...a: unknown[]) => sessionSet(...a),
    fileViewedSet: (...a: unknown[]) => fileViewedSet(...a),
    filesViewedSet: (...a: unknown[]) => filesViewedSet(...a),
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

beforeEach(() => {
  usePrReviewStore.getState().reset()
  sessionSet.mockClear()
  fileViewedSet.mockClear()
  filesViewedSet.mockClear()
})

describe('pr-review store — session v2', () => {
  it('keys a session by PR, not by head', () => {
    expect(sessionKey(REPO, 211)).toBe(`${REPO}:::211`)
    expect(legacySessionKey(REPO, 211, 'aaa111')).toBe(`${REPO}:::211:::aaa111`)
  })

  it('keeps unchanged viewed files and moves changed ones to changedSince after a push', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.reconcileHead(
      { repoRoot: REPO, prNumber: 211, headSHA: 'bbb222' },
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
})

describe('pr-review store — session v2 — treats every viewed file as changed when the old head is gone', () => {
  it('treats every viewed file as changed when the old head is gone', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.reconcileHead({ repoRoot: REPO, prNumber: 211, headSHA: 'bbb222' }, 'all')
    const s = usePrReviewStore.getState()
    expect(s.viewedFiles.size).toBe(0)
    expect(s.changedSince.size).toBe(3)
    expect(s.historyRewritten).toBe(true)
  })
})

describe('pr-review store — session v2 — treats every viewed file as changed when the old head is gone — viewing a changed file again records the new head and syncs GitHub', () => {
  it('viewing a changed file again records the new head and syncs GitHub', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.reconcileHead({ repoRoot: REPO, prNumber: 211, headSHA: 'bbb222' }, [
      'scripts/e2e-shard.ts',
    ])
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: REPO, prNumber: 211, headSHA: 'bbb222' }, 'scripts/e2e-shard.ts')
    const s = usePrReviewStore.getState()
    expect(s.changedSince.has('scripts/e2e-shard.ts')).toBe(false)
    expect(s.viewedFiles.has('scripts/e2e-shard.ts')).toBe(true)
    expect(s.viewedAt['scripts/e2e-shard.ts']).toBe('bbb222')
    expect(fileViewedSet).toHaveBeenCalledWith({
      repoRoot: REPO,
      prNumber: 211,
      path: 'scripts/e2e-shard.ts',
      viewed: true,
    })
    const [key, persisted] = sessionSet.mock.calls.at(-1)!
    expect(key).toBe(`${REPO}:::211`)
    expect((persisted as ReviewSession).viewedAt['scripts/e2e-shard.ts']).toBe('bbb222')
  })
})

describe('pr-review store — session v2 — unmarking forgets the viewed SHA and unsyncs GitHub', () => {
  it('unmarking forgets the viewed SHA and unsyncs GitHub', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.unmarkFileViewed(
      { repoRoot: REPO, prNumber: 211, headSHA: 'aaa111' },
      'playwright.config.ts'
    )
    const s = usePrReviewStore.getState()
    expect(s.viewedFiles.has('playwright.config.ts')).toBe(false)
    expect(s.viewedAt['playwright.config.ts']).toBeUndefined()
    expect(fileViewedSet).toHaveBeenCalledWith({
      repoRoot: REPO,
      prNumber: 211,
      path: 'playwright.config.ts',
      viewed: false,
    })
  })
})

const HEAD_A = { repoRoot: REPO, prNumber: 211, headSHA: 'aaa111' }

/** Adds a draft (then rewords it) and a private note to the session. */
function addDraftAndNote(store: ReturnType<typeof usePrReviewStore.getState>) {
  store.addDraft(HEAD_A, {
    id: 'd1',
    path: 'src/hooks/usePrReview.ts',
    line: 317,
    startLine: null,
    side: 'RIGHT',
    body: 'computeRiskScore runs twice per file here (312 and 317).',
    fromFindingId: 'f1',
  })
  store.updateDraft(HEAD_A, 'd1', 'Keep the scores from the loop.')
  store.addNote(HEAD_A, {
    id: 'n1',
    path: 'src/hooks/usePrReview.ts',
    line: 312,
    side: 'RIGHT',
    body: 'why is this recomputed??',
    createdAt: '2026-09-27T10:00:00.000Z',
  })
}

describe('pr-review store — session v2 — drafts and notes persist with the session', () => {
  it('drafts and notes persist with the session', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    addDraftAndNote(store)
    let s = usePrReviewStore.getState()
    expect(s.drafts[0].body).toBe('Keep the scores from the loop.')
    expect(s.notes).toHaveLength(1)
    const persisted = sessionSet.mock.calls.at(-1)![1] as ReviewSession
    expect(persisted.drafts).toHaveLength(1)
    expect(persisted.notes[0].body).toBe('why is this recomputed??')

    store.removeNote(HEAD_A, 'n1')
    store.removeDraft(HEAD_A, 'd1')
    s = usePrReviewStore.getState()
    expect(s.notes).toHaveLength(0)
    expect(s.drafts).toHaveLength(0)

    store.addDraft(HEAD_A, { ...persisted.drafts[0], id: 'd2' })
    store.clearDrafts(HEAD_A)
    expect(usePrReviewStore.getState().drafts).toHaveLength(0)
  })
})

const riskScore = (composite: number) =>
  ({
    level: 'low',
    composite,
    dominantDriver: 'changeSize',
    topImporters: [],
    importerCount: 0,
    metrics: {},
  }) as never

const file = (path: string) => ({ path, riskScore: riskScore(0) })

const activePr = () =>
  ({
    number: 211,
    headSHA: 'aaa111',
    nodeId: 'PR_node_211',
    chapters: [
      { id: 'ch-1', files: [file('a.ts'), file('b.ts')] },
      { id: 'ch-2', files: [file('c.ts')] },
    ],
  }) as never

describe('pr-review store — session v2 (continued) — viewed marks and risk scores against an active PR', () => {
  it('passes the PR node id so a single mark costs one GitHub call', () => {
    usePrReviewStore.getState().setActivePr(activePr())
    usePrReviewStore
      .getState()
      .markFileViewed({ repoRoot: REPO, prNumber: 211, headSHA: 'aaa111' }, 'a.ts')
    expect(fileViewedSet).toHaveBeenCalledWith({
      repoRoot: REPO,
      prNumber: 211,
      path: 'a.ts',
      viewed: true,
      nodeId: 'PR_node_211',
    })
  })
})

describe('pr-review store — session v2 (continued) — viewed marks and risk scores against an active PR — marks several files with one session write and one GitHub request', () => {
  it('marks several files with one session write and one GitHub request', () => {
    usePrReviewStore.getState().setActivePr(activePr())
    usePrReviewStore
      .getState()
      .markFilesViewed({ repoRoot: REPO, prNumber: 211, headSHA: 'aaa111' }, ['a.ts', 'b.ts'])
    const s = usePrReviewStore.getState()
    expect([...s.viewedFiles].sort()).toEqual(['a.ts', 'b.ts'])
    expect(s.viewedAt).toEqual({ 'a.ts': 'aaa111', 'b.ts': 'aaa111' })
    expect(sessionSet).toHaveBeenCalledTimes(1)
    expect(fileViewedSet).not.toHaveBeenCalled()
    expect(filesViewedSet).toHaveBeenCalledTimes(1)
    expect(filesViewedSet).toHaveBeenCalledWith({
      repoRoot: REPO,
      prNumber: 211,
      nodeId: 'PR_node_211',
      paths: ['a.ts', 'b.ts'],
      viewed: true,
    })
  })
})

describe('pr-review store — session v2 (continued) — viewed marks and risk scores against an active PR — does nothing for an empty batch', () => {
  it('does nothing for an empty batch', () => {
    usePrReviewStore
      .getState()
      .markFilesViewed({ repoRoot: REPO, prNumber: 211, headSHA: 'aaa111' }, [])
    expect(sessionSet).not.toHaveBeenCalled()
    expect(filesViewedSet).not.toHaveBeenCalled()
  })
})

describe('pr-review store — session v2 (continued) — viewed marks and risk scores against an active PR — applies many risk scores across chapters in one store update', () => {
  it('applies many risk scores across chapters in one store update', () => {
    usePrReviewStore.getState().setActivePr(activePr())
    let updates = 0
    const unsub = usePrReviewStore.subscribe(() => updates++)
    usePrReviewStore.getState().updateFileRiskScores({
      'a.ts': riskScore(40),
      'c.ts': riskScore(80),
    })
    unsub()
    const chapters = usePrReviewStore.getState().activePr!.chapters
    expect(updates).toBe(1)
    expect(chapters[0].files.map((f) => f.riskScore.composite)).toEqual([40, 0])
    expect(chapters[1].files[0].riskScore.composite).toBe(80)
  })
})
