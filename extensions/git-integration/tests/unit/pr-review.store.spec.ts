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
    viewedHunks: {},
    viewedAt: {
      'scripts/e2e-timings.ts': 'aaa111',
      'scripts/e2e-shard.ts': 'aaa111',
      'playwright.config.ts': 'aaa111',
    },
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

const DRAFT = {
  id: 'd1',
  path: 'src/hooks/usePrReview.ts',
  line: 317,
  startLine: null,
  side: 'RIGHT' as const,
  body: 'computeRiskScore runs twice per file here (312 and 317).',
  fromFindingId: 'f1',
}

/** The session the store saved last. */
const lastPersisted = () => sessionSet.mock.calls.at(-1)![1] as ReviewSession

describe('pr-review store — session v2 — drafts persist with the session', () => {
  it('saves a reworded draft with the session', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.addDraft(HEAD_A, DRAFT)
    store.updateDraft(HEAD_A, 'd1', 'Keep the scores from the loop.')
    expect(usePrReviewStore.getState().drafts.map((d) => d.body)).toEqual([
      'Keep the scores from the loop.',
    ])
    expect(lastPersisted().drafts.map((d) => d.body)).toEqual(['Keep the scores from the loop.'])
  })
})

describe('pr-review store — session v2 — removing a draft persists with the session', () => {
  it('removes a draft from the session', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session({ drafts: [DRAFT, { ...DRAFT, id: 'd2' }] }))
    store.removeDraft(HEAD_A, 'd1')
    expect(usePrReviewStore.getState().drafts.map((d) => d.id)).toEqual(['d2'])
    expect(lastPersisted().drafts.map((d) => d.id)).toEqual(['d2'])
  })

  it('clears every draft from the session', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session({ drafts: [DRAFT, { ...DRAFT, id: 'd2' }] }))
    store.clearDrafts(HEAD_A)
    expect(usePrReviewStore.getState().drafts).toEqual([])
    expect(lastPersisted().drafts).toEqual([])
  })
})

const file = (path: string) => ({ path, churn90d: null })

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

describe('pr-review store — session v2 (continued) — viewed marks and churn against an active PR', () => {
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

describe('pr-review store — session v2 (continued) — viewed marks and churn against an active PR — marks several files with one session write and one GitHub request', () => {
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

describe('pr-review store — session v2 (continued) — viewed marks and churn against an active PR — does nothing for an empty batch', () => {
  it('does nothing for an empty batch', () => {
    usePrReviewStore
      .getState()
      .markFilesViewed({ repoRoot: REPO, prNumber: 211, headSHA: 'aaa111' }, [])
    expect(sessionSet).not.toHaveBeenCalled()
    expect(filesViewedSet).not.toHaveBeenCalled()
  })
})

describe('pr-review store — session v2 (continued) — viewed marks and churn against an active PR — sets churn across chapters in one store update', () => {
  it("sets each named file's 90-day commit count across chapters in one store update", () => {
    usePrReviewStore.getState().setActivePr(activePr())
    let updates = 0
    const unsub = usePrReviewStore.subscribe(() => updates++)
    usePrReviewStore.getState().updateFileChurn({ 'a.ts': 4, 'c.ts': 0 })
    unsub()
    const chapters = usePrReviewStore.getState().activePr!.chapters
    expect(updates).toBe(1)
    expect(chapters[0].files.map((f) => f.churn90d)).toEqual([4, null])
    expect(chapters[1].files[0].churn90d).toBe(0)
  })
})

describe('pr-review store — viewed hunks', () => {
  const HUNK = '@@ -9,2 +9,2 @@ in RETRYABLE_CODES'

  it('toggles a hunk viewed, persists it with the session, and toggles it back', () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.toggleHunkViewed(HEAD_A, 'src/faults.py', HUNK)
    expect(usePrReviewStore.getState().viewedHunks['src/faults.py']).toEqual([HUNK])
    expect(sessionSet).toHaveBeenLastCalledWith(
      sessionKey(REPO, 211),
      expect.objectContaining({ viewedHunks: { 'src/faults.py': [HUNK] } })
    )
    store.toggleHunkViewed(HEAD_A, 'src/faults.py', HUNK)
    expect(usePrReviewStore.getState().viewedHunks['src/faults.py']).toBeUndefined()
  })

  it("forgets a file's viewed hunks when the file is unmarked viewed", () => {
    const store = usePrReviewStore.getState()
    store.initSession(session())
    store.toggleHunkViewed(HEAD_A, 'playwright.config.ts', HUNK)
    store.unmarkFileViewed(HEAD_A, 'playwright.config.ts')
    expect(usePrReviewStore.getState().viewedHunks['playwright.config.ts']).toBeUndefined()
  })
})

const AT_HEAD = { repoRoot: REPO, prNumber: 211, headSHA: 'aaa111' }
const SHARD_HUNKS = ['@@ -1,3 +1,4 @@', '@@ -20,2 +21,2 @@']

/** Marks the shard script's hunks read, then reloads the saved session the way PrReviewTab does. */
function readHunksAndReload(): void {
  usePrReviewStore.getState().markHunksViewed(AT_HEAD, { 'scripts/e2e-shard.ts': SHARD_HUNKS })
  const [, saved] = sessionSet.mock.calls.at(-1)!
  usePrReviewStore.getState().reset()
  usePrReviewStore.getState().initSession(saved as ReviewSession)
}

describe('pr-review store — saved hunk progress', () => {
  it('keeps the read hunks across a reload of the same head', () => {
    readHunksAndReload()
    expect(usePrReviewStore.getState().viewedHunks).toEqual({ 'scripts/e2e-shard.ts': SHARD_HUNKS })
  })

  it('drops the read hunks of a file the new head changed, and keeps the others', () => {
    usePrReviewStore
      .getState()
      .markHunksViewed(AT_HEAD, { 'scripts/e2e-timings.ts': ['@@ -5 +5 @@'] })
    readHunksAndReload()
    usePrReviewStore
      .getState()
      .reconcileHead({ ...AT_HEAD, headSHA: 'bbb222' }, ['scripts/e2e-shard.ts'])
    expect(usePrReviewStore.getState().viewedHunks).toEqual({
      'scripts/e2e-timings.ts': ['@@ -5 +5 @@'],
    })
  })

  it('drops every read hunk when the old head is gone', () => {
    readHunksAndReload()
    usePrReviewStore.getState().reconcileHead({ ...AT_HEAD, headSHA: 'bbb222' }, 'all')
    expect(usePrReviewStore.getState().viewedHunks).toEqual({})
  })
})
