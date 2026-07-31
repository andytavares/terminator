import { describe, it, expect } from 'vitest'
import { createRunRegistry, type Run } from '../../src/runtime/run-registry.js'

// What everything downstream reads. Keyed by card rather than by a session
// identity of its own — a run belongs to a card, and a parallel identity is what
// made the console and this extension two systems instead of one.

const add = (registry: ReturnType<typeof createRunRegistry>, over: Partial<Run> = {}): Run =>
  registry.add({
    sessionId: 'session-1',
    featureDir: '/repo/specs/021-a',
    phase: 'implement',
    worktreePath: '/wt/a',
    branch: 'feat/a',
    terminalSessionId: 'terminal-1',
    transcriptPath: '/t.jsonl',
    startedAt: 1_000,
    ...over,
  } as Parameters<ReturnType<typeof createRunRegistry>['add']>[0])

describe('adding a run', () => {
  it('starts it working, from when it started', () => {
    const registry = createRunRegistry()
    const run = add(registry)
    expect(run.state).toBe('working')
    expect(run.stateSince).toBe(1_000)
  })

  it('starts with nothing spent and nothing changed', () => {
    const run = add(createRunRegistry())
    expect(run.turns).toBe(0)
    expect(run.asked).toBe(0)
    expect(run.diff).toEqual({ files: 0, added: 0, removed: 0 })
  })

  it('can be read back by its session', () => {
    const registry = createRunRegistry()
    add(registry)
    expect(registry.get('session-1')?.branch).toBe('feat/a')
  })

  it('reports nothing for a run it does not have', () => {
    expect(createRunRegistry().get('nobody')).toBeNull()
  })
})

describe('what counts as live', () => {
  it.each(['working', 'waiting', 'stalled'] as const)('counts a run that is %s', (state) => {
    // All three are still consuming time and attention.
    const registry = createRunRegistry()
    add(registry)
    registry.setState('session-1', state, 2_000)
    expect(registry.live()).toHaveLength(1)
  })

  it.each(['ready', 'finished'] as const)('does not count a run that is %s', (state) => {
    const registry = createRunRegistry()
    add(registry)
    registry.setState('session-1', state, 2_000)
    expect(registry.live()).toEqual([])
  })

  it('lists the ones waiting to be reviewed', () => {
    const registry = createRunRegistry()
    add(registry)
    add(registry, { sessionId: 'session-2' })
    registry.setState('session-1', 'ready', 2_000)
    expect(registry.awaitingReview().map((r) => r.sessionId)).toEqual(['session-1'])
  })
})

describe('recording what happened', () => {
  it('moves the clock only when the state actually changes', () => {
    // `stateSince` is how long it has been like this; rewriting it every tick
    // would make everything look like it just happened.
    const registry = createRunRegistry()
    add(registry)
    registry.setState('session-1', 'waiting', 2_000)
    registry.setState('session-1', 'waiting', 9_000)
    expect(registry.get('session-1')?.stateSince).toBe(2_000)
  })

  it('moves it when the state does change', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.setState('session-1', 'waiting', 2_000)
    registry.setState('session-1', 'working', 5_000)
    expect(registry.get('session-1')?.stateSince).toBe(5_000)
  })

  it('records turns and what changed', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.noteTurns('session-1', 4)
    registry.noteDiff('session-1', { files: 2, added: 9, removed: 1 })
    expect(registry.get('session-1')).toMatchObject({
      turns: 4,
      diff: { files: 2, added: 9, removed: 1 },
    })
  })

  it('counts how often it had to ask', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.noteAsked('session-1')
    registry.noteAsked('session-1')
    expect(registry.get('session-1')?.asked).toBe(2)
  })

  it('ignores anything said about a run it does not have', () => {
    const registry = createRunRegistry()
    expect(() => {
      registry.setState('nobody', 'ready', 1)
      registry.noteTurns('nobody', 1)
      registry.noteDiff('nobody', { files: 1, added: 1, removed: 0 })
      registry.noteAsked('nobody')
    }).not.toThrow()
  })
})

describe('forgetting', () => {
  it('drops one run', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.forget('session-1')
    expect(registry.list()).toEqual([])
  })

  it('drops every run belonging to a card', () => {
    const registry = createRunRegistry()
    add(registry, { sessionId: 'a', featureDir: '/repo/specs/021-a' })
    add(registry, { sessionId: 'b', featureDir: '/repo/specs/021-a' })
    add(registry, { sessionId: 'c', featureDir: '/repo/specs/022-b' })
    registry.forgetCard('/repo/specs/021-a')
    expect(registry.list().map((r) => r.sessionId)).toEqual(['c'])
  })

  it('ignores forgetting something it does not have', () => {
    const registry = createRunRegistry()
    expect(() => {
      registry.forget('nobody')
      registry.forgetCard('/nowhere')
    }).not.toThrow()
  })
})
