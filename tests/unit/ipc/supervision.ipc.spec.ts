import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockOn } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockOn: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, on: mockOn, removeHandler: vi.fn() },
  app: { getPath: vi.fn().mockReturnValue('/tmp') },
}))

import { registerSupervisionHandlers } from '../../../src/main/ipc/supervision.ipc.js'
import { SUPERVISION_CHANNELS } from '../../../src/main/ipc/supervision.ipc.js'
import type { SupervisedSession } from '../../../src/shared/schemas/supervision.js'

function session(overrides: Partial<SupervisedSession> = {}): SupervisedSession {
  return {
    id: 's1',
    workItemId: null,
    laneOrd: null,
    repoPath: '/repo',
    worktreePath: '/wt/s1',
    branch: 'feat/x',
    transcriptPath: '/tmp/s1.jsonl',
    runtimeState: 'working',
    stateSince: 1_000,
    lastToolActivityAt: 1_500,
    lastNetChangeAt: null,
    openShellCallId: null,
    turns: 1,
    costUsd: 0,
    contextPct: null,
    pendingPermission: null,
    diffSummary: { files: 0, added: 0, removed: 0 },
    autonomyLevel: 'read',
    lastViewedAt: null,
    ...overrides,
  }
}

function handlerFor(channel: string): (event: unknown, payload?: unknown) => unknown {
  const call = mockHandle.mock.calls.find(([registered]) => registered === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as (event: unknown, payload?: unknown) => unknown
}

describe('registerSupervisionHandlers()', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers every declared supervision channel', () => {
    registerSupervisionHandlers({ listSessions: () => [], getSession: () => null })
    const registered = mockHandle.mock.calls.map(([channel]) => channel)
    for (const channel of Object.values(SUPERVISION_CHANNELS)) {
      expect(registered).toContain(channel)
    }
  })

  it('returns the session list from the supplied source', async () => {
    const sessions = [session(), session({ id: 's2', runtimeState: 'needs_input' })]
    registerSupervisionHandlers({ listSessions: () => sessions, getSession: () => null })
    await expect(handlerFor(SUPERVISION_CHANNELS.listSessions)({})).resolves.toEqual(sessions)
  })

  it('returns a single session by id', async () => {
    const s = session({ id: 's7' })
    registerSupervisionHandlers({
      listSessions: () => [],
      getSession: (id) => (id === 's7' ? s : null),
    })
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getSession)({}, { sessionId: 's7' })
    ).resolves.toEqual(s)
  })

  it('returns null for an unknown session id rather than throwing', async () => {
    registerSupervisionHandlers({ listSessions: () => [], getSession: () => null })
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getSession)({}, { sessionId: 'nope' })
    ).resolves.toBeNull()
  })

  it('rejects a malformed getSession payload without calling the source', async () => {
    const getSession = vi.fn()
    registerSupervisionHandlers({ listSessions: () => [], getSession })
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getSession)({}, { sessionId: 42 })
    ).resolves.toBeNull()
    expect(getSession).not.toHaveBeenCalled()
  })

  it('validates outbound sessions, dropping any that fail the schema', async () => {
    // A malformed session must not reach a surface. Dropping the bad row and
    // serving the rest beats failing the whole list.
    const bad = {
      ...session({ id: 'bad' }),
      runtimeState: 'running',
    } as unknown as SupervisedSession
    registerSupervisionHandlers({
      listSessions: () => [session({ id: 'ok' }), bad],
      getSession: () => null,
    })
    const result = (await handlerFor(SUPERVISION_CHANNELS.listSessions)({})) as SupervisedSession[]
    expect(result.map((s) => s.id)).toEqual(['ok'])
  })
})

describe('provisioning and control channels', () => {
  beforeEach(() => vi.clearAllMocks())

  const base = { listSessions: () => [], getSession: () => null }

  it('provisions a working copy', async () => {
    const provision = vi.fn().mockResolvedValue({ worktreePath: '/wt/s1', ok: true })
    registerSupervisionHandlers({ ...base, provision })
    await expect(
      handlerFor(SUPERVISION_CHANNELS.provision)(
        {},
        { sessionId: 's1', workItemId: 'FLU-220', repoPath: '/repo', branch: 'feat/x' }
      )
    ).resolves.toMatchObject({ ok: true })
    expect(provision).toHaveBeenCalled()
  })

  it('rejects a malformed provision request without calling through', async () => {
    const provision = vi.fn()
    registerSupervisionHandlers({ ...base, provision })
    await expect(
      handlerFor(SUPERVISION_CHANNELS.provision)({}, { sessionId: 's1' })
    ).resolves.toMatchObject({ ok: false })
    expect(provision).not.toHaveBeenCalled()
  })

  it('reports an absent capability rather than throwing', async () => {
    registerSupervisionHandlers(base)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.provision)(
        {},
        { sessionId: 's1', workItemId: 'w', repoPath: '/r', branch: 'b' }
      )
    ).resolves.toMatchObject({ ok: false })
  })

  it('refuses to archive a running session, carrying the reason (FR-036)', async () => {
    const archive = vi.fn().mockResolvedValue({ allowed: false, reason: 'this session is working' })
    registerSupervisionHandlers({ ...base, archive })
    await expect(
      handlerFor(SUPERVISION_CHANNELS.archive)({}, { sessionId: 's1' })
    ).resolves.toMatchObject({ allowed: false, reason: 'this session is working' })
  })

  it('hands a worktree to the external editor (FR-044)', async () => {
    const openInEditor = vi.fn().mockResolvedValue({ ok: true, reason: null })
    registerSupervisionHandlers({ ...base, openInEditor })
    await expect(
      handlerFor(SUPERVISION_CHANNELS.openInEditor)({}, { sessionId: 's1' })
    ).resolves.toMatchObject({ ok: true })
  })

  it('states no editor is configured rather than failing silently', async () => {
    registerSupervisionHandlers(base)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.openInEditor)({}, { sessionId: 's1' })
    ).resolves.toMatchObject({ ok: false, reason: 'no external editor is configured' })
  })

  it('turns shadow mode off, which is what lets stalls surface (FR-019)', async () => {
    const setShadowMode = vi.fn()
    registerSupervisionHandlers({ ...base, setShadowMode })
    await handlerFor(SUPERVISION_CHANNELS.setShadowMode)({}, { value: false })
    expect(setShadowMode).toHaveBeenCalledWith(false)
  })

  it('rejects a non-boolean shadow-mode payload', async () => {
    const setShadowMode = vi.fn()
    registerSupervisionHandlers({ ...base, setShadowMode })
    await handlerFor(SUPERVISION_CHANNELS.setShadowMode)({}, { value: 'off' })
    expect(setShadowMode).not.toHaveBeenCalled()
  })

  it('records a judgement against a firing (FR-020)', async () => {
    const judgeFiring = vi.fn()
    registerSupervisionHandlers({ ...base, judgeFiring })
    await handlerFor(SUPERVISION_CHANNELS.judgeFiring)(
      {},
      { firingId: 'f1', judgement: 'incorrect' }
    )
    expect(judgeFiring).toHaveBeenCalledWith('f1', 'incorrect')
  })

  it('rejects an unknown judgement value', async () => {
    const judgeFiring = vi.fn()
    registerSupervisionHandlers({ ...base, judgeFiring })
    await handlerFor(SUPERVISION_CHANNELS.judgeFiring)({}, { firingId: 'f1', judgement: 'maybe' })
    expect(judgeFiring).not.toHaveBeenCalled()
  })
})

// Every channel has three paths that matter: a valid call, a malformed payload,
// and a console assembled without that capability. A channel that throws on the
// third takes the whole surface down.

const BARE = { listSessions: () => [], getSession: () => null }

function fullSource() {
  return {
    listSessions: () => [session()],
    getSession: () => session(),
    provision: vi.fn().mockResolvedValue({ worktreePath: '/wt/s1', ok: true }),
    release: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue({ allowed: true, reason: null }),
    openInEditor: vi.fn().mockResolvedValue({ ok: true, reason: null }),
    setShadowMode: vi.fn(),
    judgeFiring: vi.fn(),
    resolvePermission: vi.fn(),
    listFeed: () => [{ id: 'f1' }],
    listFirings: () => ({ firings: [{ id: 'x' }], precision: { total: 1 } }),
    listReview: () => [{ sessionId: 's1' }],
    listUnattendedMerges: () => [{ sessionId: 's1' }],
    listWorkItems: () => ({
      items: [{ id: 'FLU-220' }],
      unreadable: [],
      conflicts: [],
      canAct: true,
    }),
    replyToSession: vi.fn().mockResolvedValue({ ok: true, reason: null }),
    getReviewDetail: vi.fn().mockReturnValue({ item: { sessionId: 's1' } }),
    decideHunk: vi.fn(),
    advanceReview: vi.fn(),
    getLanes: vi
      .fn()
      .mockReturnValue({ lanes: [{ ord: 1 }], mergedOrds: [1], staleOrds: [], blockedReasons: {} }),
    mergeLane: vi.fn().mockResolvedValue({ ok: true, reason: null }),
    getProvisioning: vi.fn().mockReturnValue({ worktreePath: '/wt/s1' }),
    getSinceLastLooked: vi.fn().mockReturnValue({ lastViewedAt: 5, entries: [] }),
    precheckBackpressure: vi.fn().mockReturnValue({ allowed: true }),
    entityIndex: () => [{ id: 'e1' }],
    intake: vi.fn().mockReturnValue({ ok: true }),
    assign: vi.fn().mockResolvedValue({ ok: true, sessionId: 's2' }),
    producerAction: vi.fn().mockResolvedValue({ ok: true, reason: null }),
  }
}

describe('the write channels', () => {
  beforeEach(() => vi.clearAllMocks())

  it('provisions a worktree', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    const payload = { sessionId: 's1', workItemId: 'FLU-220', repoPath: '/repo', branch: 'feat/x' }
    await expect(handlerFor(SUPERVISION_CHANNELS.provision)({}, payload)).resolves.toEqual({
      worktreePath: '/wt/s1',
      ok: true,
    })
  })

  it('refuses to provision on a malformed request', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.provision)({}, { sessionId: '' })
    ).resolves.toEqual({ worktreePath: null, ok: false })
  })

  it('reports provisioning unavailable rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    const payload = { sessionId: 's1', workItemId: 'w', repoPath: '/repo', branch: 'b' }
    await expect(handlerFor(SUPERVISION_CHANNELS.provision)({}, payload)).resolves.toEqual({
      worktreePath: null,
      ok: false,
    })
  })

  it('releases a worktree', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.release)({}, { sessionId: 's1' })
    ).resolves.toEqual({ ok: true })
    expect(source.release).toHaveBeenCalledWith('s1')
  })

  it('reports release unavailable rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.release)({}, { sessionId: 's1' })
    ).resolves.toEqual({ ok: false })
  })

  it('archives a session', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.archive)({}, { sessionId: 's1' })
    ).resolves.toEqual({ allowed: true, reason: null })
  })

  it('refuses to archive on a malformed request', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.archive)({}, {})).resolves.toMatchObject({
      allowed: false,
    })
  })

  it('says archiving is unavailable rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.archive)({}, { sessionId: 's1' })
    ).resolves.toEqual({ allowed: false, reason: 'archiving is unavailable' })
  })

  it('hands the worktree to an external editor', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.openInEditor)({}, { sessionId: 's1' })
    ).resolves.toEqual({ ok: true, reason: null })
  })

  it('refuses the handoff on a malformed request', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.openInEditor)({}, {})).resolves.toMatchObject({
      ok: false,
    })
  })

  it('says no editor is configured rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.openInEditor)({}, { sessionId: 's1' })
    ).resolves.toEqual({ ok: false, reason: 'no external editor is configured' })
  })

  it('sets shadow mode', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.setShadowMode)({}, { value: false })
    ).resolves.toEqual({ ok: true })
    expect(source.setShadowMode).toHaveBeenCalledWith(false)
  })

  it('rejects a shadow-mode payload that is not a boolean', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.setShadowMode)({}, { value: 'off' })
    ).resolves.toEqual({ ok: false })
    expect(source.setShadowMode).not.toHaveBeenCalled()
  })

  it('records a judgement on a firing', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.judgeFiring)({}, { firingId: 'f1', judgement: 'incorrect' })
    ).resolves.toEqual({ ok: true })
    expect(source.judgeFiring).toHaveBeenCalledWith('f1', 'incorrect')
  })

  it('rejects a judgement that is neither correct nor incorrect', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.judgeFiring)({}, { firingId: 'f1', judgement: 'maybe' })
    ).resolves.toEqual({ ok: false })
  })

  it('resolves a permission request without opening the session (FR-023)', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.resolvePermission)(
        {},
        { sessionId: 's1', requestId: 'r1', decision: 'allow' }
      )
    ).resolves.toEqual({ ok: true })
    expect(source.resolvePermission).toHaveBeenCalledWith('s1', 'r1', 'allow')
  })

  it('rejects a permission decision that is neither allow nor deny', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.resolvePermission)(
        {},
        { sessionId: 's1', requestId: 'r1', decision: 'maybe' }
      )
    ).resolves.toEqual({ ok: false })
  })

  it('decides a hunk', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.decideHunk)(
        {},
        { sessionId: 's1', hunkId: 'h1', decision: 'reject' }
      )
    ).resolves.toEqual({ ok: true })
    expect(source.decideHunk).toHaveBeenCalledWith('s1', 'h1', 'reject')
  })

  it('rejects a hunk decision outside accept/reject', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.decideHunk)(
        {},
        { sessionId: 's1', hunkId: 'h1', decision: 'defer' }
      )
    ).resolves.toEqual({ ok: false })
  })

  it('advances the review flow', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.advanceReview)({}, { sessionId: 's1' })
    ).resolves.toEqual({ ok: true })
    expect(source.advanceReview).toHaveBeenCalledWith('s1')
  })

  it('refuses to advance on a malformed request', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.advanceReview)({}, {})).resolves.toEqual({
      ok: false,
    })
  })

  it('merges a lane', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.mergeLane)({}, { workItemId: 'FLU-220', ord: 1 })
    ).resolves.toEqual({ ok: true, reason: null })
    expect(source.mergeLane).toHaveBeenCalledWith('FLU-220', 1)
  })

  it('rejects a lane ordinal that is not a positive integer', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.mergeLane)({}, { workItemId: 'FLU-220', ord: 0 })
    ).resolves.toEqual({ ok: false, reason: 'invalid request' })
  })

  it('says merging is unavailable rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.mergeLane)({}, { workItemId: 'FLU-220', ord: 1 })
    ).resolves.toEqual({ ok: false, reason: 'merging is unavailable' })
  })

  it('takes an intake request', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.intake)({}, { url: 'https://linear.app/x' })
    ).resolves.toEqual({ ok: true })
  })

  it('rejects an intake payload of the wrong shape', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.intake)({}, { url: 7 })).resolves.toEqual({
      ok: false,
      reason: 'invalid request',
    })
  })

  it('says intake is unavailable rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.intake)({}, { contents: '# spec' })
    ).resolves.toEqual({ ok: false, reason: 'intake is unavailable' })
  })

  it('assigns an agent', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    const payload = { repoPath: '/repo', branch: 'feat/x', autonomyLevel: 'edit' }
    await expect(handlerFor(SUPERVISION_CHANNELS.assign)({}, payload)).resolves.toMatchObject({
      ok: true,
    })
  })

  it('rejects an autonomy level outside the ladder (FR-041)', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.assign)(
        {},
        { repoPath: '/repo', branch: 'b', autonomyLevel: 'god' }
      )
    ).resolves.toEqual({ ok: false, reason: 'invalid request' })
  })

  it('says assigning is unavailable rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.assign)(
        {},
        { repoPath: '/repo', branch: 'b', autonomyLevel: 'read' }
      )
    ).resolves.toEqual({ ok: false, reason: 'assigning is unavailable' })
  })

  it('replies to a session', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.replyToSession)({}, { sessionId: 's1', message: 'what?' })
    ).resolves.toEqual({ ok: true, reason: null })
    expect(source.replyToSession).toHaveBeenCalledWith('s1', 'what?')
  })

  it('rejects an empty reply', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.replyToSession)({}, { sessionId: 's1', message: '' })
    ).resolves.toEqual({ ok: false, reason: 'invalid reply' })
  })

  it('says replying is unavailable rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.replyToSession)({}, { sessionId: 's1', message: 'hi' })
    ).resolves.toEqual({ ok: false, reason: 'replying is unavailable' })
  })
})

describe('the read channels', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serves the feed, the firings, the review queue and the merges', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.listFeed)({})).resolves.toHaveLength(1)
    await expect(handlerFor(SUPERVISION_CHANNELS.listFirings)({})).resolves.toMatchObject({
      firings: [{ id: 'x' }],
    })
    await expect(handlerFor(SUPERVISION_CHANNELS.listReview)({})).resolves.toHaveLength(1)
    await expect(handlerFor(SUPERVISION_CHANNELS.listUnattendedMerges)({})).resolves.toHaveLength(1)
  })

  it('serves the board, the entity index and the backpressure precheck', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.listWorkItems)({})).resolves.toMatchObject({
      canAct: true,
    })
    await expect(handlerFor(SUPERVISION_CHANNELS.entityIndex)({})).resolves.toHaveLength(1)
    await expect(handlerFor(SUPERVISION_CHANNELS.precheckBackpressure)({})).resolves.toEqual({
      allowed: true,
    })
  })

  it('serves empty defaults on a console built without those capabilities (SC-011)', async () => {
    registerSupervisionHandlers(BARE)
    await expect(handlerFor(SUPERVISION_CHANNELS.listFeed)({})).resolves.toEqual([])
    await expect(handlerFor(SUPERVISION_CHANNELS.listReview)({})).resolves.toEqual([])
    await expect(handlerFor(SUPERVISION_CHANNELS.listUnattendedMerges)({})).resolves.toEqual([])
    await expect(handlerFor(SUPERVISION_CHANNELS.entityIndex)({})).resolves.toEqual([])
    await expect(handlerFor(SUPERVISION_CHANNELS.precheckBackpressure)({})).resolves.toBeNull()
    await expect(handlerFor(SUPERVISION_CHANNELS.listFirings)({})).resolves.toMatchObject({
      firings: [],
    })
    await expect(handlerFor(SUPERVISION_CHANNELS.listWorkItems)({})).resolves.toMatchObject({
      canAct: false,
    })
  })

  it('serves the review detail for an open session', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getReviewDetail)({}, { sessionId: 's1' })
    ).resolves.toMatchObject({ item: { sessionId: 's1' } })
  })

  it('returns no review detail for a malformed request or an absent capability', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.getReviewDetail)({}, {})).resolves.toBeNull()
    vi.clearAllMocks()
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getReviewDetail)({}, { sessionId: 's1' })
    ).resolves.toBeNull()
  })

  it('serves the lanes of a work item', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getLanes)({}, { workItemId: 'FLU-220' })
    ).resolves.toMatchObject({ mergedOrds: [1] })
  })

  it('serves empty lanes for a malformed request or an absent capability', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.getLanes)({}, {})).resolves.toEqual({
      lanes: [],
      mergedOrds: [],
      staleOrds: [],
      blockedReasons: {},
    })
    vi.clearAllMocks()
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getLanes)({}, { workItemId: 'FLU-220' })
    ).resolves.toEqual({ lanes: [], mergedOrds: [], staleOrds: [], blockedReasons: {} })
  })

  it('serves the provisioning record for a session', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getProvisioning)({}, { sessionId: 's1' })
    ).resolves.toMatchObject({ worktreePath: '/wt/s1' })
  })

  it('returns no provisioning record for a malformed request or an absent capability', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.getProvisioning)({}, {})).resolves.toBeNull()
    vi.clearAllMocks()
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getProvisioning)({}, { sessionId: 's1' })
    ).resolves.toBeNull()
  })

  it('serves what changed since you last looked', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getSinceLastLooked)({}, { sessionId: 's1' })
    ).resolves.toMatchObject({ lastViewedAt: 5 })
  })

  it('serves an empty since-panel for a malformed request or an absent capability', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(handlerFor(SUPERVISION_CHANNELS.getSinceLastLooked)({}, {})).resolves.toEqual({
      lastViewedAt: null,
      entries: [],
    })
    vi.clearAllMocks()
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.getSinceLastLooked)({}, { sessionId: 's1' })
    ).resolves.toEqual({ lastViewedAt: null, entries: [] })
  })
})

// Approving a gate is what makes implementation legal (FR-083). Without this
// channel the gate can never be satisfied and no session bound to a work item
// could ever start.

describe('directing an action at the producer that published an item', () => {
  beforeEach(() => vi.clearAllMocks())

  it('forwards the action and its arguments', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.producerAction)(
        {},
        {
          workItemId: 'FLU-220',
          action: 'approveGate',
          args: ['FLU-220', 'spec_approved_by_human'],
        }
      )
    ).resolves.toEqual({ ok: true, reason: null })
    expect(source.producerAction).toHaveBeenCalledWith('FLU-220', 'approveGate', [
      'FLU-220',
      'spec_approved_by_human',
    ])
  })

  it('defaults the arguments to none rather than rejecting the call', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.producerAction)(
        {},
        { workItemId: 'FLU-220', action: 'advancePhase' }
      )
    ).resolves.toMatchObject({ ok: true })
    expect(source.producerAction).toHaveBeenCalledWith('FLU-220', 'advancePhase', [])
  })

  it('refuses an action outside the closed set', async () => {
    const source = fullSource()
    registerSupervisionHandlers(source)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.producerAction)(
        {},
        { workItemId: 'FLU-220', action: 'deleteEverything', args: [] }
      )
    ).resolves.toEqual({ ok: false, reason: 'invalid request' })
    expect(source.producerAction).not.toHaveBeenCalled()
  })

  it('refuses a request with no work item', async () => {
    registerSupervisionHandlers(fullSource())
    await expect(
      handlerFor(SUPERVISION_CHANNELS.producerAction)({}, { action: 'approveGate' })
    ).resolves.toEqual({ ok: false, reason: 'invalid request' })
  })

  it('says no producer is registered rather than throwing', async () => {
    registerSupervisionHandlers(BARE)
    await expect(
      handlerFor(SUPERVISION_CHANNELS.producerAction)(
        {},
        { workItemId: 'FLU-220', action: 'approveGate', args: [] }
      )
    ).resolves.toEqual({ ok: false, reason: 'no producer is registered' })
  })
})
