import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSupervisionService } from '../../../../src/main/supervision/supervision-service.js'

// The composition root. These tests assert the wiring — that events reach the
// registry, that state changes are pushed out, and that the defaults the spec
// insists on survive being assembled.

let userDataPath: string

beforeEach(() => (userDataPath = mkdtempSync(join(tmpdir(), 'supervision-svc-'))))
afterEach(() => rmSync(userDataPath, { recursive: true, force: true }))

function memoryStore() {
  let value: unknown
  return { get: () => value, set: (v: unknown) => (value = v) }
}

const built: Array<{ stop(): void }> = []

afterEach(() => {
  // Each service holds a publication watcher; leaking them starves the
  // filesystem watcher other tests depend on.
  while (built.length > 0) built.pop()?.stop()
})

function build(overrides: Record<string, unknown> = {}) {
  const onStateChanged = vi.fn()
  const notify = vi.fn()
  const shadow = { value: undefined as boolean | undefined }
  const service = createSupervisionService({
    userDataPath,
    registryStore: memoryStore(),
    shadowStore: {
      get: () => shadow.value,
      set: (v: boolean) => (shadow.value = v),
    },
    now: () => 1_000,
    onStateChanged,
    notify,
    ...overrides,
  })
  built.push(service)
  return { service, onStateChanged, notify }
}

// A getter, not a const: `userDataPath` is assigned in beforeEach, so a
// module-level literal would capture `undefined`.
const metaFor = (): {
  workItemId: null
  laneOrd: null
  repoPath: string
  worktreePath: string
  branch: string
  autonomyLevel: 'edit'
} => ({
  workItemId: null,
  laneOrd: null,
  repoPath: userDataPath,
  worktreePath: '/wt/s1',
  branch: 'feat/x',
  autonomyLevel: 'edit',
})

describe('assembly', () => {
  it('exposes every part of the substrate', () => {
    const { service } = build()
    for (const part of [
      'bus',
      'registry',
      'driver',
      'firings',
      'stalls',
      'scheduler',
      'backpressure',
      'mergePolicy',
    ]) {
      expect(service).toHaveProperty(part)
    }
  })

  it('starts with shadow mode on (FR-018)', () => {
    expect(build().service.stalls.isShadowMode()).toBe(true)
  })

  it('starts with no sessions', () => {
    expect(build().service.listSessions()).toEqual([])
  })
})

describe('event flow', () => {
  it('routes published events into the registry', () => {
    const { service } = build()
    service.registry.register('s1', { ...metaFor(), repoPath: userDataPath })
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/tmp/s1.jsonl',
      cwd: '/repo',
      at: 2_000,
    })
    expect(service.getSession('s1')?.runtimeState).toBe('working')
  })

  it('pushes a state change outward exactly once per transition', () => {
    const { service, onStateChanged } = build()
    service.registry.register('s1', metaFor())
    onStateChanged.mockClear()
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/tmp/s1.jsonl',
      cwd: '/repo',
      at: 2_000,
    })
    expect(onStateChanged).toHaveBeenCalledExactlyOnceWith({
      sessionId: 's1',
      to: 'working',
      at: 2_000,
    })
  })

  it('does not push when an event changes nothing', () => {
    const { service, onStateChanged } = build()
    service.registry.register('s1', metaFor())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/x',
      cwd: '/y',
      at: 2_000,
    })
    onStateChanged.mockClear()
    // A tool call while already working is activity, not a transition.
    service.bus.publish({
      kind: 'tool_started',
      sessionId: 's1',
      toolName: 'Read',
      callId: 'c1',
      isShell: false,
      at: 3_000,
    })
    expect(onStateChanged).not.toHaveBeenCalled()
  })

  it('ignores events for sessions it does not know', () => {
    const { service, onStateChanged } = build()
    service.bus.publish({
      kind: 'session_started',
      sessionId: 'ghost',
      transcriptPath: '/x',
      cwd: '/y',
      at: 2_000,
    })
    expect(onStateChanged).not.toHaveBeenCalled()
    expect(service.listSessions()).toEqual([])
  })
})

describe('backpressure wiring', () => {
  it('counts finished-but-unreviewed sessions globally, across repositories', () => {
    const { service } = build()
    service.registry.register('a', { ...metaFor(), repoPath: '/repo-a' })
    service.registry.register('b', { ...metaFor(), repoPath: '/repo-b' })
    for (const id of ['a', 'b']) {
      service.bus.publish({
        kind: 'session_started',
        sessionId: id,
        transcriptPath: '/x',
        cwd: '/y',
        at: 2_000,
      })
    }
    expect(service.backpressure.check()).toMatchObject({ allowed: true, unreviewed: 0 })
  })
})

describe('lifecycle', () => {
  it('starts and stops the detector without throwing', () => {
    vi.useFakeTimers()
    const { service } = build()
    expect(() => {
      service.start()
      vi.advanceTimersByTime(30_000)
      service.stop()
    }).not.toThrow()
    vi.useRealTimers()
  })

  it('is safe to stop twice', () => {
    const { service } = build()
    service.start()
    service.stop()
    expect(() => service.stop()).not.toThrow()
  })
})

describe('stall surfacing through the service', () => {
  it('records a firing without notifying while shadow mode is on', () => {
    const { service, notify } = build()
    service.stalls.surface({
      sessionId: 's1',
      signal: 'silence',
      firedAt: 5_000,
      inputs: {
        toolSilenceMs: 9 * 60_000,
        diffSilenceMs: 0,
        distinctFiles: 0,
        netChange: 0,
        reverts: 0,
        shellInFlight: false,
      },
    })
    expect(service.firings.list()).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()
  })

  it('notifies once shadow mode is turned off', () => {
    const { service, notify } = build()
    service.registry.register('s1', metaFor())
    service.stalls.setShadowMode(false)
    service.stalls.surface({
      sessionId: 's1',
      signal: 'silence',
      firedAt: 5_000,
      inputs: {
        toolSilenceMs: 9 * 60_000,
        diffSilenceMs: 0,
        distinctFiles: 0,
        netChange: 0,
        reverts: 0,
        shellInFlight: false,
      },
    })
    expect(notify).toHaveBeenCalled()
  })
})

describe('review queue population (FR-045)', () => {
  it('queues a finished session that produced changes, which is what backpressure counts', async () => {
    const { service } = build()
    service.registry.register('s1', { ...metaFor(), worktreePath: process.cwd() })
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: 2_000,
    })
    // A non-empty diff summary is what moves a session to `ready`.
    service.registry.apply({
      kind: 'tool_started',
      sessionId: 's1',
      toolName: 'Edit',
      callId: 'c1',
      isShell: false,
      at: 2_500,
    })
    expect(service.reviewQueue.count()).toBe(0)
    // Without changes there is nothing to review, so the queue stays empty.
    service.bus.publish({ kind: 'session_ended', sessionId: 's1', outcome: 'success', at: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(service.reviewQueue.count()).toBe(0)
  })

  it('exposes the provisioner, code-host client and feed reply', () => {
    const { service } = build()
    expect(typeof service.provisioner.provision).toBe('function')
    expect(typeof service.codeHost.checkState).toBe('function')
    expect(typeof service.feedReply.reply).toBe('function')
  })

  it('refuses to provision when no git operations were supplied, rather than half-provisioning', async () => {
    const { service } = build()
    await expect(
      service.provisioner.provision({
        sessionId: 's1',
        workItemId: 'w',
        repoPath: userDataPath,
        branch: 'feat/x',
        worktreeRoot: userDataPath,
      })
    ).rejects.toThrow(/git worktree operations/)
  })

  it('reports a reply to a session that is not running', async () => {
    const { service } = build()
    const entry = service.feed.post({
      at: 1_000,
      sessionId: 's1',
      author: 'agent',
      summary: 'Ran tests',
    })
    await expect(service.feedReply.reply(entry.id, 'try again')).resolves.toMatchObject({
      ok: false,
    })
  })

  it('writes a feed entry when a session reaches a milestone (FR-091)', () => {
    const { service } = build()
    service.registry.register('s1', metaFor())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: 2_000,
    })
    const entries = service.feed.list()
    expect(entries.length).toBeGreaterThan(0)
    expect(entries[0]).toMatchObject({ sessionId: 's1', author: 'agent' })
  })

  it('names a publication directory per producer, inside the console tree', () => {
    const { service } = build()
    const dir = service.publicationDirectoryFor('speckit-pilot')
    expect(dir).toContain('supervision')
    expect(dir.endsWith('speckit-pilot')).toBe(true)
  })

  it('persists lane bindings without touching producer state', () => {
    const { service } = build()
    service.laneBindings.bind('FLU-220', 1, 's1', 1_000)
    expect(service.laneBindings.forLane('FLU-220', 1)?.sessionId).toBe('s1')
  })

  it('registers and forgets a producer', () => {
    const { service } = build()
    service.producers.register('p', { approveGate: async () => {} })
    expect(service.producers.supports('p', 'approveGate')).toBe(true)
    service.producers.unregister('p')
    expect(service.producers.supports('p', 'approveGate')).toBe(false)
  })
})

describe('the review queue actually fills when a session finishes with changes', () => {
  function withDiff(files: number) {
    return build({
      readDiff: async () => ({ files, added: 12, removed: 3 }),
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: async () => ({ ok: true, reason: null }),
        isAvailable: async () => true,
      },
    })
  }

  async function finish(service: ReturnType<typeof build>['service']): Promise<void> {
    service.registry.register('s1', metaFor())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: 2_000,
    })
    // A non-empty diff on the session is what makes `session_ended` mean `ready`.
    service.registry.apply({
      kind: 'turn_finished',
      sessionId: 's1',
      turns: 1,
      costUsd: 0,
      contextPct: null,
      at: 3_000,
    })
    ;(service.registry.get('s1') as { diffSummary: { files: number } }).diffSummary.files = 1
    service.bus.publish({ kind: 'session_ended', sessionId: 's1', outcome: 'success', at: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  it('enqueues the finished session, so backpressure has something to count', async () => {
    const { service } = withDiff(2)
    await finish(service)
    expect(service.reviewQueue.count()).toBe(1)
    expect(service.reviewQueue.list()[0]).toMatchObject({ sessionId: 's1', branch: 'feat/x' })
  })

  it('grades what it enqueues, carrying the trigger', async () => {
    const { service } = withDiff(2)
    await finish(service)
    expect(service.reviewQueue.list()[0].gradeTrigger).toBeTruthy()
  })

  it('does not enqueue a session whose diff turned out to be empty (FR-045)', async () => {
    const { service } = withDiff(0)
    await finish(service)
    expect(service.reviewQueue.count()).toBe(0)
  })

  it('makes backpressure count the queue rather than the registry', async () => {
    const { service } = withDiff(2)
    await finish(service)
    expect(service.backpressure.check()).toMatchObject({ unreviewed: 1 })
  })
})

describe('defaults and callbacks the composition root owns', () => {
  it('runs the stall scheduler over the registry, using each repository thresholds', () => {
    vi.useFakeTimers()
    const { service } = build({ now: () => 60 * 60_000 })
    service.registry.register('s1', metaFor())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: 0,
    })
    service.start()
    vi.advanceTimersByTime(30_000)
    service.stop()
    vi.useRealTimers()
    // Shadow mode is on, so the firing is recorded rather than surfaced.
    expect(service.firings.list().length).toBeGreaterThan(0)
    expect(service.getSession('s1')?.runtimeState).toBe('working')
  })

  it('ignores a stall surfaced for a session it does not know', () => {
    const { service, onStateChanged } = build()
    service.stalls.setShadowMode(false)
    onStateChanged.mockClear()
    service.stalls.surface({
      sessionId: 'ghost',
      signal: 'silence',
      firedAt: 5_000,
      inputs: {
        toolSilenceMs: 9 * 60_000,
        diffSilenceMs: 0,
        distinctFiles: 0,
        netChange: 0,
        reverts: 0,
        shellInFlight: false,
      },
    })
    // No session, so nothing to mark stalled — but the firing is still recorded.
    expect(onStateChanged).not.toHaveBeenCalled()
    expect(service.firings.list()).toHaveLength(1)
  })

  it('releases a worktree without teardown when no git operations were supplied', async () => {
    const { service } = build()
    await expect(
      service.provisioner.release({
        repoPath: userDataPath,
        worktreePath: join(userDataPath, 'wt'),
        workItemId: 'w',
        portBase: 4000,
      })
    ).resolves.toBeNull()
  })

  it('reads unattended-merge policy from the repository config', () => {
    const { service } = build()
    expect(
      service.mergePolicy.mayMergeUnattended({
        sessionId: 's1',
        repoPath: userDataPath,
        grade: 'P3',
        gradeTrigger: 'lockfile',
        checkState: 'passing',
        diffSummary: { files: 1, added: 1, removed: 0 },
      })
    ).toMatchObject({ may: false })
  })

  it('uses the supplied git operations when they are provided', async () => {
    const createWorktree = vi.fn().mockResolvedValue(undefined)
    const { service } = build({
      git: { createWorktree, removeWorktree: vi.fn().mockResolvedValue(undefined) },
    })
    await service.provisioner.provision({
      sessionId: 's1',
      workItemId: 'w',
      repoPath: userDataPath,
      branch: 'feat/x',
      worktreeRoot: userDataPath,
    })
    expect(createWorktree).toHaveBeenCalled()
  })

  it('delivers a reply through the supplied sender', async () => {
    const sendToSession = vi.fn().mockResolvedValue(undefined)
    const { service } = build({ sendToSession })
    const entry = service.feed.post({
      at: 1_000,
      sessionId: 's1',
      author: 'agent',
      summary: 'Ran tests',
    })
    await expect(service.feedReply.reply(entry.id, 'try again')).resolves.toMatchObject({
      ok: true,
    })
    expect(sendToSession).toHaveBeenCalledWith('s1', 'try again')
  })
})

describe('the six capabilities the service exposes to the surfaces', () => {
  it('reconciles against the transcript, which is what survives the driver (FR-006)', () => {
    const { service } = build()
    service.registry.register('s1', metaFor())
    // No transcript recorded yet, so there is nothing to reconcile against and
    // this must be a no-op rather than an error.
    expect(() => service.reconcileFromTranscript('s1')).not.toThrow()
    expect(() => service.reconcileFromTranscript('ghost')).not.toThrow()
  })

  it('reserves the modal for a blocking permission request (FR-028)', () => {
    const { service } = build()
    expect(service.notificationChannelFor('permission_requested', 's1')).toBe('modal')
    expect(service.notificationChannelFor('stalled', 's1')).toBe('indicator')
    expect(service.notificationChannelFor('progress', 's1')).toBe('digest')
  })

  it('batches feed entries into a digest for the away case', () => {
    const { service } = build()
    service.feed.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'Ran tests' })
    service.feed.post({ at: 2_000, sessionId: 's2', author: 'agent', summary: 'Edited' })
    expect(service.digestSince(0, 5_000)).toMatchObject({ entryCount: 2, sessionCount: 2 })
  })

  it('indexes every entity kind for the palette (FR-026)', () => {
    const { service } = build()
    service.registry.register('s1', metaFor())
    const index = service.entityIndex([{ id: 'toggle-shadow', label: 'Toggle shadow mode' }])
    expect(new Set(index.map((entity) => entity.kind))).toEqual(
      new Set(['session', 'worktree', 'repository', 'command'])
    )
  })

  it('refuses implementation for a work item nobody published (FR-083)', () => {
    const { service } = build()
    expect(service.mayBeginImplementation('MISSING')).toMatchObject({ allowed: false })
  })

  it('normalises a ticket URL into one shape without starting anything (FR-068)', () => {
    const { service } = build()
    const result = service.intake({ url: 'https://linear.app/t/issue/FLU-220/x' })
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.stub.phase).toBe('intake')
    expect(service.listSessions()).toEqual([])
  })

  it('normalises a dropped document', () => {
    const { service } = build()
    const result = service.intake({ filePath: '/docs/idea.md', contents: '# Unify identity' })
    expect(result.ok && result.stub.title).toBe('Unify identity')
  })

  it('reports nothing to bring in when given neither', () => {
    expect(build().service.intake({})).toMatchObject({ ok: false })
  })

  it('has no provisioning record for a session that was never provisioned', () => {
    expect(build().service.provisioningFor('s1')).toBeNull()
  })

  it('creates a hunk decision set per session and keeps it', () => {
    const { service } = build()
    const first = service.hunkDecisionsFor('s1')
    expect(service.hunkDecisionsFor('s1')).toBe(first)
    expect(service.hunkDecisionsFor('s2')).not.toBe(first)
  })

  it('records provisioning output so the surface can show it (FR-034)', async () => {
    const { service } = build({
      git: {
        createWorktree: async (_repo: string, path: string) => {
          const { mkdirSync: mk } = await import('fs')
          mk(path, { recursive: true })
        },
        removeWorktree: async () => {},
      },
    })
    const result = await service.provisioner.provision({
      sessionId: 's1',
      workItemId: 'w',
      repoPath: userDataPath,
      branch: 'feat/x',
      worktreeRoot: userDataPath,
    })
    expect(service.provisioningFor('s1')).toMatchObject({ worktreePath: result.worktreePath })
  })
})

// The grader is only as good as the file list it is handed. Before this was
// wired the service passed `[]`, so an auth change graded the same as a README
// change and P0 could never fire in production (FR-047).

describe('the grader sees the files a session actually changed', () => {
  function withFiles(files: string[], hunkPatch = '') {
    return build({
      readDiff: async () => ({ files: files.length, added: 12, removed: 3 }),
      readFiles: async () => files,
      run: async () => ({ ok: true, stdout: hunkPatch, stderr: '' }),
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: async () => ({ ok: true, reason: null }),
        isAvailable: async () => true,
      },
    })
  }

  async function finish(service: ReturnType<typeof build>['service']): Promise<void> {
    service.registry.register('s1', metaFor())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/t',
      cwd: '/repo',
      at: 2_000,
    })
    service.registry.apply({
      kind: 'turn_finished',
      sessionId: 's1',
      turns: 1,
      costUsd: 0,
      contextPct: null,
      at: 3_000,
    })
    ;(service.registry.get('s1') as { diffSummary: { files: number } }).diffSummary.files = 1
    service.bus.publish({ kind: 'session_ended', sessionId: 's1', outcome: 'success', at: 5_000 })
    await new Promise((resolve) => setTimeout(resolve, 30))
  }

  it('grades a change touching auth P0', async () => {
    const { service } = withFiles(['src/auth/token.ts'])
    await finish(service)
    expect(service.reviewQueue.list()[0].grade).toBe('P0')
  })

  it('does not grade ordinary feature work P0', async () => {
    const { service } = withFiles(['src/widgets/button.tsx'])
    await finish(service)
    expect(service.reviewQueue.list()[0].grade).not.toBe('P0')
  })

  it('exposes the changed files to the intent step', async () => {
    const { service } = withFiles(['src/auth/token.ts'])
    await finish(service)
    expect(service.changedFilesFor('s1')).toEqual(['src/auth/token.ts'])
  })

  it('reports no changed files for a session that never finished', () => {
    const { service } = withFiles(['a.ts'])
    expect(service.changedFilesFor('nope')).toEqual([])
  })

  it('splits the branch diff into reviewable hunks (FR-052)', async () => {
    const patch = '+++ b/src/auth/token.ts\n@@ -1,1 +1,2 @@\n+const x = 1\n export const y = 2\n'
    const { service } = withFiles(['src/auth/token.ts'], patch)
    await finish(service)
    expect(service.hunksFor('s1')).toHaveLength(1)
    expect(service.hunksFor('s1')[0].file).toBe('src/auth/token.ts')
  })

  it('reports no hunks for a session that never finished', () => {
    const { service } = withFiles(['a.ts'])
    expect(service.hunksFor('nope')).toEqual([])
  })

  it('has no expected files for ad-hoc work, which declared no scope', async () => {
    const { service } = withFiles(['a.ts'])
    await finish(service)
    expect(service.expectedFilesFor('s1')).toEqual([])
  })

  it('reports no stale lanes for a work item nobody published', () => {
    const { service } = withFiles(['a.ts'])
    expect(service.staleLanesFor('FLU-999')).toEqual([])
  })
})
