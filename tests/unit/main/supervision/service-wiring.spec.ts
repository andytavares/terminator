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
    // The producer lane reaches `merged` the only way the state machine allows.
    service.bus.publish({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: null,
      cwd: join(root, 'repo'),
      at: 10_000,
    })
    service.bus.publish({
      kind: 'session_ended',
      sessionId: 's1',
      outcome: 'success',
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
