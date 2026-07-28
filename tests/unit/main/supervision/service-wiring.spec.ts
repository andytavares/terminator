import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSupervisionService } from '../../../../src/main/supervision/supervision-service.js'

// The composition root's remaining seams: the paths that only exist once a work
// item has actually been published and a lane bound to a session. Assembled
// wrong, each of these fails silently — an empty list where a real answer was
// required.

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'svc-wiring-'))
})

afterEach(() => {
  while (built.length > 0) built.pop()?.stop()
  rmSync(root, { recursive: true, force: true })
})

const built: Array<{ stop(): void }> = []

function memoryStore() {
  let value: unknown
  return { get: () => value, set: (v: unknown) => (value = v) }
}

const APPROVED = { ok: true, at: '2026-07-27T09:12:40Z' }

function publish(over: Record<string, unknown> = {}): void {
  const producerDir = join(root, 'supervision', 'workitems', 'test-producer')
  mkdirSync(producerDir, { recursive: true })
  writeFileSync(
    join(producerDir, 'FLU-220.json'),
    JSON.stringify({
      contract_version: 1,
      id: 'FLU-220',
      source: 'local',
      title: 'Unify session identity',
      created_at: '2026-07-27T09:04:11Z',
      phase: 'implement',
      artifacts: { spec: 'specs/012/spec.md', plan: 'specs/012/plan.md' },
      gates: { spec_approved_by_human: APPROVED, plan_approved_by_human: APPROVED },
      contract: { summary: 'SessionId = ULID', shared_files: ['proto/session.proto'] },
      lanes: [
        {
          ord: 1,
          repo: 'fluent',
          role: 'producer',
          branch: 'feat/session-ulid',
          task_ids: ['T001'],
          blocks: [2],
        },
        {
          ord: 2,
          repo: 'forge',
          role: 'consumer',
          branch: 'feat/session-ulid',
          task_ids: ['T009'],
          blocked_by: [1],
        },
      ],
      ...over,
    })
  )
}

function build(overrides: Record<string, unknown> = {}) {
  const service = createSupervisionService({
    userDataPath: root,
    registryStore: memoryStore(),
    bindingStore: memoryStore(),
    shadowStore: { get: () => undefined, set: () => {} },
    now: () => 10_000,
    ...overrides,
  })
  built.push(service)
  return service
}

const meta = (over: Record<string, unknown> = {}) => ({
  workItemId: null,
  laneOrd: null,
  repoPath: join(root, 'repo'),
  worktreePath: join(root, 'wt'),
  branch: 'feat/session-ulid',
  autonomyLevel: 'edit' as const,
  ...over,
})

describe('the event bus a subscriber broke', () => {
  it('keeps delivering to the rest of the stream and says so', () => {
    const service = build()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const later = vi.fn()

    service.bus.subscribe(() => {
      throw new Error('subscriber exploded')
    })
    service.bus.subscribe(later)
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: '/repo',
      at: 1_000,
    })

    expect(later).toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('the assigner', () => {
  it('is built over the assembled service, so a session can actually be started', () => {
    const service = build()
    expect(typeof service.assigner.assign).toBe('function')
    expect(service.assigner.precheck()).toMatchObject({ allowed: true })
  })
})

describe('work items the console can see', () => {
  it('includes published items and their repositories in the entity index', () => {
    publish()
    const service = build()
    const entities = service.entityIndex([])
    expect(entities.some((entity) => entity.kind === 'workItem' && entity.id === 'FLU-220')).toBe(
      true
    )
    expect(entities.some((entity) => entity.kind === 'repository')).toBe(true)
  })

  it('gates implementation on a published item rather than assuming approval', () => {
    publish()
    const service = build()
    expect(service.mayBeginImplementation('FLU-220').allowed).toBe(true)
  })
})

describe('intake', () => {
  it('takes a local document', () => {
    const service = build()
    const result = service.intake({ filePath: '/specs/idea.md', contents: '# Fix the thing' })
    expect(result.ok).toBe(true)
  })

  it('takes a ticket url', () => {
    const service = build()
    expect(service.intake({ url: 'https://linear.app/team/issue/FLU-220' }).ok).toBe(true)
  })

  it('refuses an empty request rather than inventing a work item', () => {
    const service = build()
    expect(service.intake({})).toEqual({ ok: false, reason: 'nothing to bring in' })
  })
})

describe('a session bound to a lane', () => {
  function boundService(overrides: Record<string, unknown> = {}) {
    publish()
    const service = build(overrides)
    service.registry.register('s1', meta({ workItemId: 'FLU-220', laneOrd: 1 }))
    service.laneBindings.bind('FLU-220', 1, 's1', 10_000)
    return service
  }

  it('takes its expected file scope from the work item contract (FR-051)', () => {
    const service = boundService()
    expect(service.expectedFilesFor('s1')).toEqual(['proto/session.proto'])
  })

  it('has no expected scope when the session is bound to nothing', () => {
    const service = boundService()
    expect(service.expectedFilesFor('unbound')).toEqual([])
  })

  it('carries the shared contract files into the grade (FR-048)', async () => {
    const service = boundService({
      readDiff: async () => ({ files: 1, added: 400, removed: 0 }),
      readFiles: async () => ['proto/session.proto'],
      run: async () => ({ ok: true, stdout: '', stderr: '' }),
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: async () => ({ ok: true, reason: null }),
        isAvailable: async () => true,
      },
    })

    service.registry.apply({
      kind: 'turn_finished',
      sessionId: 's1',
      turns: 1,
      costUsd: 0,
      contextPct: null,
      at: 11_000,
    })
    ;(service.registry.get('s1') as { diffSummary: { files: number } }).diffSummary.files = 1
    service.bus.publish({
      kind: 'session_ended',
      sessionId: 's1',
      outcome: 'success',
      at: 12_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    // A shared contract file is a P1 trigger at minimum; graded without it the
    // change would have been treated as ordinary feature work.
    expect(service.reviewQueue.list()[0].grade).toBe('P1')
  })

  it('records no hunks when the diff command itself fails', async () => {
    const service = boundService({
      readDiff: async () => ({ files: 1, added: 1, removed: 0 }),
      readFiles: async () => ['a.ts'],
      run: async () => {
        throw new Error('git is not installed')
      },
      codeHost: {
        checkState: async () => 'unknown' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: async () => ({ ok: true, reason: null }),
        isAvailable: async () => false,
      },
    })

    service.registry.apply({
      kind: 'turn_finished',
      sessionId: 's1',
      turns: 1,
      costUsd: 0,
      contextPct: null,
      at: 11_000,
    })
    ;(service.registry.get('s1') as { diffSummary: { files: number } }).diffSummary.files = 1
    service.bus.publish({
      kind: 'session_ended',
      sessionId: 's1',
      outcome: 'success',
      at: 12_000,
    })
    await new Promise((resolve) => setTimeout(resolve, 30))

    expect(service.reviewQueue.count()).toBe(1)
    expect(service.hunksFor('s1')).toEqual([])
  })
})

describe('downstream lanes left behind by an upstream merge (FR-090)', () => {
  it('flags a consumer lane that started before the producer merged', () => {
    publish()
    const service = build()
    service.registry.register('s1', meta({ workItemId: 'FLU-220', laneOrd: 1 }))
    service.registry.register('s2', meta({ workItemId: 'FLU-220', laneOrd: 2 }))
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: join(root, 'repo'),
      at: 10_000,
    })
    // Only a branch actually reaching the trunk means merged.
    service.bus.publish({
      kind: 'branch_merged',
      sessionId: 's1',
      unattended: false,
      at: 50_000,
    })

    expect(service.registry.get('s1')?.runtimeState).toBe('merged')
    expect(service.staleLanesFor('FLU-220')).toEqual([2])
  })

  it('flags nothing while no lane has merged', () => {
    publish()
    const service = build()
    service.registry.register('s1', meta({ workItemId: 'FLU-220', laneOrd: 1 }))
    expect(service.staleLanesFor('FLU-220')).toEqual([])
  })
})

describe('reconciling against the transcript', () => {
  it('does nothing for a session with no transcript yet', () => {
    const service = build()
    service.registry.register('s1', meta())
    const seen: unknown[] = []
    service.bus.subscribe((event) => seen.push(event))
    service.reconcileFromTranscript('s1')
    expect(seen).toEqual([])
  })

  it('republishes the latest tool activity the transcript knows about', () => {
    const transcript = join(root, 's1.jsonl')
    writeFileSync(
      transcript,
      `${JSON.stringify({
        timestamp: '2026-07-27T14:07:02Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Edit' }] },
      })}\n`
    )

    const service = build()
    service.registry.register('s1', meta())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: transcript,
      cwd: join(root, 'repo'),
      at: 10_000,
    })

    const seen: Array<{ kind: string; callId?: string }> = []
    service.bus.subscribe((event) => seen.push(event as { kind: string; callId?: string }))
    service.reconcileFromTranscript('s1')

    // The transcript is the source of truth on disagreement, so what it saw is
    // replayed onto the bus rather than merged silently.
    expect(seen.some((event) => event.callId === 'transcript-reconcile')).toBe(true)
  })

  it('does nothing for a session it does not know', () => {
    const service = build()
    const seen: unknown[] = []
    service.bus.subscribe((event) => seen.push(event))
    service.reconcileFromTranscript('ghost')
    expect(seen).toEqual([])
  })
})

// The outbound half of the boundary: the console directs actions at whichever
// producer published the item, and never edits the contract file (FR-076,
// FR-077).

describe('directing an action at a producer', () => {
  it('routes to the producer that published the item', async () => {
    publish()
    const service = build()
    const approveGate = vi.fn().mockResolvedValue(undefined)
    service.producers.register('test-producer', { approveGate })

    await expect(
      service.runProducerAction('FLU-220', 'approveGate', ['FLU-220', 'spec_approved_by_human'])
    ).resolves.toEqual({ ok: true, reason: null })
    expect(approveGate).toHaveBeenCalledWith('FLU-220', 'spec_approved_by_human')
  })

  it('carries the rejection notes through (FR-084)', async () => {
    publish()
    const service = build()
    const rejectGate = vi.fn().mockResolvedValue(undefined)
    service.producers.register('test-producer', { rejectGate })

    await service.runProducerAction('FLU-220', 'rejectGate', [
      'FLU-220',
      'spec_approved_by_human',
      'scope is unbounded',
    ])
    expect(rejectGate).toHaveBeenCalledWith(
      'FLU-220',
      'spec_approved_by_human',
      'scope is unbounded'
    )
  })

  it('reports an item nobody published rather than guessing a producer', async () => {
    const service = build()
    await expect(service.runProducerAction('FLU-999', 'approveGate', [])).resolves.toEqual({
      ok: false,
      reason: 'no work item named FLU-999 is published',
    })
  })

  it('reports a command the producer does not provide (FR-078)', async () => {
    publish()
    const service = build()
    service.producers.register('test-producer', { approveGate: vi.fn() })
    await expect(service.runProducerAction('FLU-220', 'sendBack', [])).resolves.toMatchObject({
      ok: false,
    })
  })

  it('never writes the contract file itself (FR-076)', async () => {
    publish()
    const service = build()
    const file = join(root, 'supervision', 'workitems', 'test-producer', 'FLU-220.json')
    const before = readFileSync(file, 'utf-8')
    service.producers.register('test-producer', { approveGate: vi.fn() })
    await service.runProducerAction('FLU-220', 'approveGate', ['FLU-220', 'spec_approved_by_human'])
    expect(readFileSync(file, 'utf-8')).toBe(before)
  })
})

describe('telling the console a producer wrote something (FR-071)', () => {
  it('reports a publication change without being polled', async () => {
    const onPublicationsChanged = vi.fn()
    build({ onPublicationsChanged })
    publish()

    // The watcher is filesystem-driven; the re-scan backstop bounds how long
    // this can take under load.
    await vi.waitFor(() => expect(onPublicationsChanged).toHaveBeenCalled(), {
      timeout: 3_000,
      interval: 100,
    })
  })
})

// FR-036. "What did I miss" is the one novel part of the focused session view,
// and two of its three answers — the state changes and the diff delta — were
// hardcoded empty at the surface.

describe('what changed since you last looked', () => {
  function started(service: ReturnType<typeof build>) {
    service.registry.register('s1', meta())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: join(root, 'repo'),
      at: 1_000,
    })
    return service
  }

  it('reports nothing viewed yet on the first look', () => {
    const service = started(build())
    expect(service.sinceLastLooked('s1', 5_000).lastViewedAt).toBeNull()
  })

  it('reports no delta on the first look, rather than the whole diff', () => {
    // Reporting every line as "new since you looked" would be a lie.
    const service = started(build())
    expect(service.sinceLastLooked('s1', 5_000).diffDelta).toBeNull()
  })

  it('reports the transitions that happened while you were away', () => {
    const service = started(build())
    service.sinceLastLooked('s1', 2_000)
    service.bus.publish({
      kind: 'permission_requested',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      input: {},
      at: 3_000,
    })

    const since = service.sinceLastLooked('s1', 4_000)
    expect(since.stateChanges.map((change) => change.to)).toContain('needs_input')
  })

  it('leaves out transitions you have already seen', () => {
    const service = started(build())
    service.bus.publish({
      kind: 'permission_requested',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      input: {},
      at: 3_000,
    })
    service.sinceLastLooked('s1', 4_000)
    expect(service.sinceLastLooked('s1', 5_000).stateChanges).toEqual([])
  })

  it('reports the diff delta against the state at your last look', () => {
    const service = started(build())
    const session = service.registry.get('s1') as { diffSummary: { files: number } }
    session.diffSummary.files = 1
    service.sinceLastLooked('s1', 2_000)

    const grown = service.registry.get('s1') as {
      diffSummary: { files: number; added: number; removed: number }
    }
    grown.diffSummary.files = 4
    grown.diffSummary.added = 90

    expect(service.sinceLastLooked('s1', 6_000).diffDelta).toMatchObject({ files: 3, added: 90 })
  })

  it('marks the session viewed, so the next call measures from here', () => {
    const service = started(build())
    service.sinceLastLooked('s1', 7_000)
    expect(service.sinceLastLooked('s1', 9_000).lastViewedAt).toBe(7_000)
  })

  it('answers for a session it does not know without throwing', () => {
    const service = build()
    expect(service.sinceLastLooked('ghost', 1_000)).toMatchObject({
      lastViewedAt: null,
      stateChanges: [],
      diffDelta: null,
    })
  })

  it('bounds the transition history rather than growing without limit', () => {
    const service = started(build())
    for (let i = 0; i < 120; i++) {
      service.bus.publish({
        kind: 'permission_requested',
        sessionId: 's1',
        requestId: `r${i}`,
        toolName: 'Bash',
        input: {},
        at: 10_000 + i * 2,
      })
      service.bus.publish({
        kind: 'permission_resolved',
        sessionId: 's1',
        requestId: `r${i}`,
        decision: 'allow',
        at: 10_001 + i * 2,
      })
    }
    expect(service.sinceLastLooked('s1', 999_999).stateChanges.length).toBeLessThanOrEqual(50)
  })
})

// FR-060/FR-061. The policy was written and tested but nothing ever called it,
// so nothing was ever merged unattended and the merge-audit surface could only
// ever be empty.

describe('unattended merge', () => {
  function repoWithUnattended(enabled: boolean): void {
    mkdirSync(join(root, 'repo', '.terminator'), { recursive: true })
    writeFileSync(
      join(root, 'repo', '.terminator', 'config.json'),
      JSON.stringify({ review: { unattendedMergeLowestGrade: enabled, baseBranch: 'main' } })
    )
  }

  function finished(over: Record<string, unknown> = {}) {
    const merge = vi.fn().mockResolvedValue({ ok: true, reason: null })
    const service = build({
      readDiff: async () => ({ files: 1, added: 2, removed: 0 }),
      // Lockfile-only: the lowest grade.
      readFiles: async () => ['package-lock.json'],
      run: async () => ({ ok: true, stdout: '', stderr: '' }),
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge,
        isAvailable: async () => true,
      },
      ...over,
    })
    service.registry.register('s1', meta())
    service.registry.apply({
      kind: 'turn_finished',
      sessionId: 's1',
      turns: 1,
      costUsd: 0,
      contextPct: null,
      at: 11_000,
    })
    ;(service.registry.get('s1') as { diffSummary: { files: number } }).diffSummary.files = 1
    service.bus.publish({ kind: 'session_ended', sessionId: 's1', outcome: 'success', at: 12_000 })
    return { service, merge }
  }

  it('merges the lowest grade with green checks where the repository opted in', async () => {
    repoWithUnattended(true)
    const { service, merge } = finished()
    await vi.waitFor(() => expect(merge).toHaveBeenCalled())
    expect(service.mergePolicy.unattendedMerges()).toHaveLength(1)
  })

  it('takes it out of the review queue, since nobody needs to look', async () => {
    repoWithUnattended(true)
    const { service } = finished()
    await vi.waitFor(() => expect(service.reviewQueue.count()).toBe(0))
  })

  it('marks the session merged, so its lane unblocks the next one', async () => {
    repoWithUnattended(true)
    const { service } = finished()
    await vi.waitFor(() => expect(service.getSession('s1')?.runtimeState).toBe('merged'))
  })

  it('records it with enough detail to review after the fact (SC-012)', async () => {
    repoWithUnattended(true)
    const { service } = finished()
    await vi.waitFor(() => expect(service.mergePolicy.unattendedMerges()).toHaveLength(1))
    expect(service.mergePolicy.unattendedMerges()[0]).toMatchObject({
      sessionId: 's1',
      checkState: 'passing',
    })
  })

  it('merges nothing where the repository did not opt in', async () => {
    repoWithUnattended(false)
    const { service, merge } = finished()
    await vi.waitFor(() => expect(service.reviewQueue.count()).toBe(1))
    expect(merge).not.toHaveBeenCalled()
  })

  it('merges nothing when the checks are not green', async () => {
    repoWithUnattended(true)
    const { service, merge } = finished({
      codeHost: {
        checkState: async () => 'failing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: vi.fn(),
        isAvailable: async () => true,
      },
    })
    await vi.waitFor(() => expect(service.reviewQueue.count()).toBe(1))
    expect(merge).not.toHaveBeenCalled()
  })

  it('merges nothing above the lowest grade', async () => {
    repoWithUnattended(true)
    const { service, merge } = finished({ readFiles: async () => ['src/auth/token.ts'] })
    await vi.waitFor(() => expect(service.reviewQueue.list()[0]?.grade).toBe('P0'))
    expect(merge).not.toHaveBeenCalled()
  })

  it('leaves the item queued when the merge itself fails', async () => {
    repoWithUnattended(true)
    const { service } = finished({
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: vi.fn().mockResolvedValue({ ok: false, reason: 'branch is behind' }),
        isAvailable: async () => true,
      },
    })
    await vi.waitFor(() => expect(service.reviewQueue.count()).toBe(1))
    expect(service.mergePolicy.unattendedMerges()).toEqual([])
  })
})

describe('merging a lane in order (FR-088)', () => {
  function laned() {
    publish()
    const merge = vi.fn().mockResolvedValue({ ok: true, reason: null })
    const service = build({
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge,
        isAvailable: async () => true,
      },
    })
    service.registry.register('s1', meta({ workItemId: 'FLU-220', laneOrd: 1 }))
    service.registry.register('s2', meta({ workItemId: 'FLU-220', laneOrd: 2 }))
    service.laneBindings.bind('FLU-220', 1, 's1', 10_000)
    service.laneBindings.bind('FLU-220', 2, 's2', 10_000)
    return { service, merge }
  }

  it('merges the producer lane', async () => {
    const { service, merge } = laned()
    await expect(service.mergeLane('FLU-220', 1)).resolves.toMatchObject({ ok: true })
    expect(merge).toHaveBeenCalled()
  })

  it('records the merge, so the next lane actually unblocks', async () => {
    // Merging without recording leaves every downstream lane waiting forever.
    const { service } = laned()
    await service.mergeLane('FLU-220', 1)
    expect(service.getSession('s1')?.runtimeState).toBe('merged')
    await expect(service.mergeLane('FLU-220', 2)).resolves.toMatchObject({ ok: true })
  })

  it('refuses a downstream lane before its upstream merged, naming the blocker', async () => {
    const { service, merge } = laned()
    const result = await service.mergeLane('FLU-220', 2)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/1/)
    expect(merge).not.toHaveBeenCalled()
  })

  it('refuses a work item nobody published', async () => {
    const { service } = laned()
    await expect(service.mergeLane('FLU-999', 1)).resolves.toEqual({
      ok: false,
      reason: 'no such work item',
    })
  })

  it('refuses a lane with no session bound to it', async () => {
    publish()
    const service = build()
    await expect(service.mergeLane('FLU-220', 1)).resolves.toMatchObject({
      reason: 'no session is bound to that lane',
    })
  })

  it('does not record a merge that the code host refused', async () => {
    publish()
    const service = build({
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: vi.fn().mockResolvedValue({ ok: false, reason: 'checks are failing' }),
        isAvailable: async () => true,
      },
    })
    service.registry.register('s1', meta({ workItemId: 'FLU-220', laneOrd: 1 }))
    service.laneBindings.bind('FLU-220', 1, 's1', 10_000)
    await expect(service.mergeLane('FLU-220', 1)).resolves.toMatchObject({ ok: false })
    expect(service.getSession('s1')?.runtimeState).not.toBe('merged')
  })
})

// FR-029. The four actions a stall offers had nothing behind them: driver
// .interrupt() was never called from anywhere in production.

describe('interrupting and discarding a session', () => {
  function running(over: Record<string, unknown> = {}) {
    const sent: string[] = []
    const service = build({
      sendToSession: async (_id: string, m: string) => void sent.push(m),
      ...over,
    })
    const interrupt = vi.fn().mockResolvedValue(undefined)
    service.driver.interrupt = interrupt
    service.registry.register('s1', meta())
    return { service, interrupt, sent }
  }

  it('stops the agent where it is', async () => {
    const { service, interrupt } = running()
    await expect(service.interruptSession('s1')).resolves.toMatchObject({ ok: true })
    expect(interrupt).toHaveBeenCalledWith('s1')
  })

  it('redirects it, because stopping alone leaves it as stuck as it was', async () => {
    const { service, sent } = running()
    await service.interruptSession('s1', 'try the integration test instead')
    expect(sent).toEqual(['try the integration test instead'])
  })

  it('does not send an empty redirect', async () => {
    const { service, sent } = running()
    await service.interruptSession('s1', '   ')
    expect(sent).toEqual([])
  })

  it('records the interruption as the console speaking, not the agent (FR-092)', async () => {
    const { service } = running()
    await service.interruptSession('s1', 'do the other thing')
    const entry = service.feed.forSession('s1').at(-1)
    expect(entry).toMatchObject({ author: 'console' })
    expect(entry?.summary).toMatch(/do the other thing/)
  })

  it('refuses to interrupt a session it does not know', async () => {
    const { service } = running()
    await expect(service.interruptSession('ghost')).resolves.toEqual({
      ok: false,
      reason: 'no such session',
    })
  })

  it('discards the session, its queue entry and its working copy', async () => {
    const { service, interrupt } = running()
    service.registry.register('s1', meta())
    await expect(service.discardSession('s1')).resolves.toMatchObject({ ok: true })
    expect(interrupt).toHaveBeenCalledWith('s1')
    expect(service.reviewQueue.count()).toBe(0)
  })

  it('takes everything said about it out of the feed', async () => {
    // A feed still discussing a session you discarded is noise about something
    // that no longer exists.
    const { service } = running()
    service.feed.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'did a thing' })
    await service.discardSession('s1')
    expect(service.feed.forSession('s1')).toEqual([])
  })

  it('leaves other sessions’ entries alone', async () => {
    const { service } = running()
    service.feed.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'mine' })
    service.feed.post({ at: 1_000, sessionId: 's2', author: 'agent', summary: 'theirs' })
    await service.discardSession('s1')
    expect(service.feed.forSession('s2')).toHaveLength(1)
  })

  it('refuses to discard a session it does not know', async () => {
    const { service } = running()
    await expect(service.discardSession('ghost')).resolves.toEqual({
      ok: false,
      reason: 'no such session',
    })
  })
})

// SC-010: after a restart the console's state must match the agent's own
// durable record. A restart is exactly when the two disagree — the driver is
// gone and everything mid-flight is reported from persisted state alone.

describe('starting the console back up', () => {
  it('reconciles against the transcript immediately, not on the next tick', () => {
    const transcript = join(root, 's1.jsonl')
    writeFileSync(
      transcript,
      `${JSON.stringify({
        timestamp: '2026-07-27T14:07:02Z',
        message: { content: [{ type: 'tool_use', id: 'c1', name: 'Edit' }] },
      })}\n`
    )

    const service = build()
    service.registry.register('s1', meta())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: transcript,
      cwd: join(root, 'repo'),
      at: 10_000,
    })

    const seen: Array<{ callId?: string }> = []
    service.bus.subscribe((event) => seen.push(event as { callId?: string }))
    service.start()

    expect(seen.some((event) => event.callId === 'transcript-reconcile')).toBe(true)
    service.stop()
  })

  it('re-queues work that was already finished, so the queue survives a restart', async () => {
    // The queue is in-memory and the sessions are not: without this the status
    // bar counts work to review while the review surface says there is none —
    // on the same screen (FR-045, SC-009).
    const service = build({
      readDiff: async () => ({ files: 2, added: 10, removed: 1 }),
      readFiles: async () => ['src/widgets/button.tsx'],
      run: async () => ({ ok: true, stdout: '', stderr: '' }),
      codeHost: {
        checkState: async () => 'passing' as const,
        pullRequestFor: async () => null,
        createPullRequest: async () => null,
        merge: async () => ({ ok: true, reason: null }),
        isAvailable: async () => true,
      },
    })
    service.registry.register('s1', meta())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: join(root, 'repo'),
      at: 10_000,
    })
    service.registry.apply({
      kind: 'turn_finished',
      sessionId: 's1',
      turns: 1,
      costUsd: 0,
      contextPct: null,
      at: 11_000,
    })
    ;(service.registry.get('s1') as { diffSummary: { files: number } }).diffSummary.files = 1
    service.bus.publish({ kind: 'session_ended', sessionId: 's1', outcome: 'success', at: 12_000 })
    await vi.waitFor(() => expect(service.getSession('s1')?.runtimeState).toBe('ready'))

    // A fresh queue, as a restart produces.
    service.reviewQueue.remove('s1')
    expect(service.reviewQueue.count()).toBe(0)

    service.start()
    await vi.waitFor(() => expect(service.reviewQueue.count()).toBe(1))
    service.stop()
  })

  it('re-queues nothing for sessions that are not finished', async () => {
    const service = build()
    service.registry.register('s1', meta())
    service.start()
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(service.reviewQueue.count()).toBe(0)
    service.stop()
  })

  it('starts the stall scheduler as well', () => {
    const service = build()
    expect(() => service.start()).not.toThrow()
    service.stop()
  })

  it('reconciles nothing when there are no sessions', () => {
    const service = build()
    const seen: unknown[] = []
    service.bus.subscribe((event) => seen.push(event))
    service.start()
    expect(seen).toEqual([])
    service.stop()
  })
})

describe('reclaiming a working copy', () => {
  function withWorktrees() {
    const wtRoot = join(root, 'worktrees')
    mkdirSync(join(wtRoot, 'orphan'), { recursive: true })
    mkdirSync(join(wtRoot, 'live'), { recursive: true })
    const removed: string[] = []
    const service = build({
      worktreeRoot: wtRoot,
      git: {
        createWorktree: async () => {},
        removeWorktree: async (_repo: string, path: string) => void removed.push(path),
      },
    })
    return { service, wtRoot, removed }
  }

  it('lists a directory no session references', () => {
    const { service, wtRoot } = withWorktrees()
    expect(service.reclaimableWorktrees().map((entry) => entry.path)).toContain(
      join(wtRoot, 'orphan')
    )
  })

  it('does not list one a session is still using', () => {
    const { service, wtRoot } = withWorktrees()
    service.registry.register('s1', meta({ worktreePath: join(wtRoot, 'live') }))
    expect(service.reclaimableWorktrees().map((entry) => entry.path)).not.toContain(
      join(wtRoot, 'live')
    )
  })

  it('removes the working copy it was given', async () => {
    const { service, wtRoot, removed } = withWorktrees()
    await expect(service.reclaimWorktree(join(wtRoot, 'orphan'))).resolves.toMatchObject({
      ok: true,
    })
    expect(removed).toContain(join(wtRoot, 'orphan'))
  })

  it('refuses one that is still in use rather than deleting it', async () => {
    const { service, wtRoot, removed } = withWorktrees()
    service.registry.register('s1', meta({ worktreePath: join(wtRoot, 'live') }))
    // Pulling a checkout out from under a running agent destroys its work.
    await expect(service.reclaimWorktree(join(wtRoot, 'live'))).resolves.toMatchObject({
      ok: false,
    })
    expect(removed).toEqual([])
  })

  it('refuses a path it does not know', async () => {
    const { service } = withWorktrees()
    await expect(service.reclaimWorktree('/tmp/somewhere-else')).resolves.toEqual({
      ok: false,
      reason: 'that working copy is not reclaimable',
    })
  })

  it('reports a teardown that threw rather than claiming success', async () => {
    const wtRoot = join(root, 'worktrees')
    mkdirSync(join(wtRoot, 'orphan'), { recursive: true })
    const service = build({
      worktreeRoot: wtRoot,
      git: {
        createWorktree: async () => {},
        removeWorktree: async () => {
          throw new Error('worktree is locked')
        },
      },
    })
    await expect(service.reclaimWorktree(join(wtRoot, 'orphan'))).resolves.toMatchObject({
      ok: false,
      reason: 'worktree is locked',
    })
  })

  it('takes the session’s feed entries with the working copy', async () => {
    const wtRoot = join(root, 'worktrees')
    mkdirSync(join(wtRoot, 'done'), { recursive: true })
    const service = build({
      worktreeRoot: wtRoot,
      git: { createWorktree: async () => {}, removeWorktree: async () => {} },
    })
    service.registry.register('s1', meta({ worktreePath: join(wtRoot, 'done') }))
    service.bus.publish({
      kind: 'branch_merged',
      sessionId: 's1',
      unattended: false,
      at: 20_000,
    })

    service.feed.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'did a thing' })
    await service.reclaimWorktree(join(wtRoot, 'done'))
    // Nothing left to go back to, so nothing left for the feed to be about.
    expect(service.feed.forSession('s1')).toEqual([])
  })
})

// Discarding has to end with the session leaving the console. Releasing the
// working copy while leaving the record behind put rows on the attention queue
// that had no action and could never be removed.

describe('discarding takes the session off the console', () => {
  function running(over: Record<string, unknown> = {}) {
    const service = build(over)
    service.driver.interrupt = async () => {}
    service.registry.register('s1', meta())
    return service
  }

  it('forgets the session', async () => {
    const service = running()
    await service.discardSession('s1')
    expect(service.getSession('s1')).toBeNull()
    expect(service.listSessions()).toEqual([])
  })

  it('forgets it even when the working copy could not be removed', async () => {
    // Already gone, or a teardown that failed: stranding it on the queue is
    // the state the operator is trying to get out of.
    const service = running({
      git: {
        createWorktree: async () => {},
        removeWorktree: async () => {
          throw new Error('worktree is locked')
        },
      },
    })
    await expect(service.discardSession('s1')).resolves.toMatchObject({ ok: true })
    expect(service.getSession('s1')).toBeNull()
  })

  it('says in the feed that the copy could not be removed', async () => {
    const service = running({
      git: {
        createWorktree: async () => {},
        removeWorktree: async () => {
          throw new Error('worktree is locked')
        },
      },
    })
    service.feed.post({ at: 1_000, sessionId: 's1', author: 'agent', summary: 'did a thing' })
    await service.discardSession('s1')
    // The rest is cleared; a directory still on disk is the one thing worth
    // keeping a line about.
    const said = service.feed.forSession('s1').map((entry) => entry.summary)
    expect(said).toHaveLength(1)
    expect(said[0]).toContain('worktree is locked')
  })

  it('leaves other sessions alone', async () => {
    const service = running()
    service.registry.register('s2', meta())
    await service.discardSession('s1')
    expect(service.listSessions().map((entry) => entry.id)).toEqual(['s2'])
  })
})

// Stopping keeps the working copy. Its reason reaches the agent before the run
// closes and lands in the feed, so a half-finished diff still says why.

describe('stopping a session', () => {
  function running() {
    const stopped: Array<{ id: string; reason?: string }> = []
    const service = build()
    service.driver.stop = async (id: string, reason?: string) => {
      stopped.push({ id, reason })
      return true
    }
    service.registry.register('s1', meta())
    return { service, stopped }
  }

  it('ends the run', async () => {
    const { service, stopped } = running()
    await expect(service.stopSession('s1')).resolves.toMatchObject({ ok: true })
    expect(stopped[0]?.id).toBe('s1')
  })

  it('tells the agent why, so its own record says so too', async () => {
    const { service, stopped } = running()
    await service.stopSession('s1', 'wrong branch')
    expect(stopped[0]?.reason).toBe('Stopped by the operator: wrong branch')
  })

  it('still says it was the operator when no reason was given', async () => {
    const { service, stopped } = running()
    await service.stopSession('s1')
    expect(stopped[0]?.reason).toBe('Stopped by the operator.')
  })

  it('records it in the feed as the console speaking, not the agent', async () => {
    const { service } = running()
    await service.stopSession('s1', 'wrong branch')
    const entry = service.feed.forSession('s1').at(-1)
    expect(entry).toMatchObject({ author: 'console' })
    expect(entry?.summary).toBe('Stopped by the operator: wrong branch')
  })

  it('keeps the session and its working copy', async () => {
    const { service } = running()
    await service.stopSession('s1')
    // You stop an agent to look at what it did, not to lose it.
    expect(service.getSession('s1')).not.toBeNull()
  })

  it('refuses a session it does not know', async () => {
    const { service } = running()
    await expect(service.stopSession('ghost')).resolves.toEqual({
      ok: false,
      reason: 'no such session',
    })
  })

  it('ends a session whose run is already gone, so Stop is never a no-op', async () => {
    // After a restart the driver has nothing to stop. Without this the session
    // stayed `working` and the button appeared to do nothing.
    const service = build()
    service.driver.stop = async () => false
    service.registry.register('s1', meta())
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: join(root, 'repo'),
      at: 10_000,
    })

    await service.stopSession('s1')
    expect(service.getSession('s1')?.runtimeState).not.toBe('working')
  })

  it('does not end it twice when the driver did stop a live run', async () => {
    const { service } = running()
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: join(root, 'repo'),
      at: 10_000,
    })
    const seen: string[] = []
    service.bus.subscribe((event) => seen.push(event.kind))
    await service.stopSession('s1')
    // The run's own completion publishes it; publishing here as well would
    // report the session ending twice.
    expect(seen.filter((kind) => kind === 'session_ended')).toEqual([])
  })
})
