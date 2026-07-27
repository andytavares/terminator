import { describe, it, expect, beforeEach } from 'vitest'
import { createSessionRegistry } from '../../../../../src/main/supervision/state/session-registry.js'
import type { SessionEvent } from '../../../../../src/main/supervision/events/session-event.js'

// FR-009 is the requirement with teeth here: on restart a session is either
// restored from evidence or marked `unknown`. It is never reported as `working`
// because it was `working` when we last looked.

function inMemoryStore() {
  let data: unknown = undefined
  return {
    get: () => data,
    set: (value: unknown) => {
      data = value
    },
  }
}

let store: ReturnType<typeof inMemoryStore>

beforeEach(() => {
  store = inMemoryStore()
})

const meta = {
  workItemId: null,
  laneOrd: null,
  repoPath: '/repo',
  worktreePath: '/wt/s1',
  branch: 'feat/x',
  autonomyLevel: 'edit' as const,
}

describe('tracking sessions', () => {
  it('registers a session in `starting`', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.register('s1', meta)
    expect(registry.get('s1')?.runtimeState).toBe('starting')
  })

  it('lists every registered session', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.register('s1', meta)
    registry.register('s2', meta)
    expect(
      registry
        .list()
        .map((s) => s.id)
        .sort()
    ).toEqual(['s1', 's2'])
  })

  it('returns null for a session it does not know', () => {
    expect(createSessionRegistry({ store, now: () => 100 }).get('nope')).toBeNull()
  })

  it('advances state by applying events', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.register('s1', meta)
    const started: SessionEvent = {
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/tmp/s1.jsonl',
      cwd: '/repo',
      at: 200,
    }
    registry.apply(started)
    expect(registry.get('s1')?.runtimeState).toBe('working')
  })

  it('ignores an event for an unregistered session rather than inventing one', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.apply({
      kind: 'session_started',
      sessionId: 'ghost',
      transcriptPath: '/x',
      cwd: '/y',
      at: 200,
    })
    expect(registry.list()).toEqual([])
  })
})

describe('persistence and restart (FR-009)', () => {
  it('persists on every change, so a crash cannot lose the registry', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.register('s1', meta)
    expect(store.get()).toBeDefined()
  })

  it('restores a terminal session exactly as it was', () => {
    const first = createSessionRegistry({ store, now: () => 100 })
    first.register('s1', meta)
    first.apply({ kind: 'session_ended', sessionId: 's1', outcome: 'error', at: 300 })
    expect(first.get('s1')?.runtimeState).toBe('failed')

    const second = createSessionRegistry({ store, now: () => 999 })
    // `failed` is settled — nothing about a restart makes it less true.
    expect(second.get('s1')?.runtimeState).toBe('failed')
  })

  it('marks a session that was mid-flight as `unknown`, never as `working`', () => {
    const first = createSessionRegistry({ store, now: () => 100 })
    first.register('s1', meta)
    first.apply({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/tmp/s1.jsonl',
      cwd: '/repo',
      at: 200,
    })
    expect(first.get('s1')?.runtimeState).toBe('working')

    const second = createSessionRegistry({ store, now: () => 999 })
    expect(second.get('s1')?.runtimeState).toBe('unknown')
    expect(second.get('s1')?.stateSince).toBe(999)
  })

  it('marks a session that was awaiting input as `unknown` too — the callback died with the driver', () => {
    const first = createSessionRegistry({ store, now: () => 100 })
    first.register('s1', meta)
    first.apply({
      kind: 'permission_requested',
      sessionId: 's1',
      requestId: 'r1',
      toolName: 'Bash',
      summary: 'ls',
      at: 200,
    })
    const second = createSessionRegistry({ store, now: () => 999 })
    expect(second.get('s1')?.runtimeState).toBe('unknown')
    // The prompt cannot be answered any more; leaving it on screen would be a lie.
    expect(second.get('s1')?.pendingPermission).toBeNull()
  })

  it('survives a corrupt persisted payload by starting empty rather than throwing', () => {
    store.set({ not: 'a registry' })
    expect(() => createSessionRegistry({ store, now: () => 100 })).not.toThrow()
    expect(createSessionRegistry({ store, now: () => 100 }).list()).toEqual([])
  })

  it('keeps the transcript path across a restart, so the tailer can re-adopt the session', () => {
    const first = createSessionRegistry({ store, now: () => 100 })
    first.register('s1', meta)
    first.apply({
      kind: 'session_started',
      sessionId: 's1',
      transcriptPath: '/tmp/s1.jsonl',
      cwd: '/repo',
      at: 200,
    })
    const second = createSessionRegistry({ store, now: () => 999 })
    expect(second.get('s1')?.transcriptPath).toBe('/tmp/s1.jsonl')
  })
})

describe('projection to the shared shape', () => {
  it('produces sessions that satisfy the IPC schema', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.register('s1', meta)
    const [session] = registry.list()
    expect(session).toMatchObject({
      id: 's1',
      repoPath: '/repo',
      worktreePath: '/wt/s1',
      branch: 'feat/x',
      autonomyLevel: 'edit',
      runtimeState: 'starting',
    })
  })

  it('reports an initial session with an empty diff summary rather than omitting it', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.register('s1', meta)
    expect(registry.list()[0].diffSummary).toEqual({ files: 0, added: 0, removed: 0 })
  })

  it('records that a session was viewed, which drives "since you last looked"', () => {
    const registry = createSessionRegistry({ store, now: () => 100 })
    registry.register('s1', meta)
    registry.markViewed('s1', 500)
    expect(registry.get('s1')?.lastViewedAt).toBe(500)
  })
})

describe('forgetting a session', () => {
  it('removes it from the listing', () => {
    const registry = createSessionRegistry({ store, now: () => 1_000 })
    registry.register('s1', meta)
    registry.forget('s1')
    expect(registry.get('s1')).toBeNull()
    expect(registry.list()).toEqual([])
  })

  it('survives the console restarting', () => {
    const registry = createSessionRegistry({ store, now: () => 1_000 })
    registry.register('s1', meta)
    registry.forget('s1')
    // Persisted, not just dropped in memory: it must not come back.
    const reopened = createSessionRegistry({ store, now: () => 2_000 })
    expect(reopened.list()).toEqual([])
  })

  it('ignores one it does not know', () => {
    const registry = createSessionRegistry({ store, now: () => 1_000 })
    registry.register('s1', meta)
    registry.forget('ghost')
    expect(registry.list()).toHaveLength(1)
  })
})

describe('the agent runtime’s own session id', () => {
  it('is recorded, since `claude --resume` takes that one and not ours', () => {
    const registry = createSessionRegistry({ store, now: () => 1_000 })
    registry.register('s1', meta)
    registry.noteRuntimeSessionId('s1', 'runtime-abc')
    expect(registry.get('s1')?.runtimeSessionId).toBe('runtime-abc')
  })

  it('is null until the runtime has told us', () => {
    const registry = createSessionRegistry({ store, now: () => 1_000 })
    registry.register('s1', meta)
    expect(registry.get('s1')?.runtimeSessionId).toBeNull()
  })

  it('survives a restart, so a session can still be resumed by hand', () => {
    const registry = createSessionRegistry({ store, now: () => 1_000 })
    registry.register('s1', meta)
    registry.noteRuntimeSessionId('s1', 'runtime-abc')
    const reopened = createSessionRegistry({ store, now: () => 2_000 })
    expect(reopened.get('s1')?.runtimeSessionId).toBe('runtime-abc')
  })

  it('ignores a session it does not know', () => {
    const registry = createSessionRegistry({ store, now: () => 1_000 })
    expect(() => registry.noteRuntimeSessionId('ghost', 'x')).not.toThrow()
  })
})
