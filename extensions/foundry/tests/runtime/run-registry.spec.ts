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

describe('moving on to the next phase in the same conversation', () => {
  it('renames the run, so it does not still read as the phase it opened with', () => {
    // A card keeps one conversation across its phases now. Without this the
    // run list said `specify` for a card three phases in.
    const registry = createRunRegistry()
    add(registry)
    registry.notePhase('session-1', 'plan', 5_000)
    expect(registry.get('session-1')?.phase).toBe('plan')
  })

  it('restarts the clock, since "how long like this" is now about this phase', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.notePhase('session-1', 'plan', 5_000)
    expect(registry.get('session-1')?.stateSince).toBe(5_000)
  })

  it('brings an archived run back to working, which is what starting a phase means', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.archive('session-1', 'approved', 4_000)
    registry.notePhase('session-1', 'plan', 5_000)
    expect(registry.get('session-1')?.state).toBe('working')
    expect(registry.live()).toHaveLength(1)
  })

  it('does nothing at all when the phase has not actually changed', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.setState('session-1', 'waiting', 2_000)
    registry.notePhase('session-1', 'implement', 5_000)
    expect(registry.get('session-1')?.state).toBe('waiting')
    expect(registry.get('session-1')?.stateSince).toBe(2_000)
  })

  it('ignores a session it has never heard of', () => {
    expect(() => createRunRegistry().notePhase('nobody', 'plan', 1)).not.toThrow()
  })
})

describe('the record of what is over', () => {
  it('starts empty, and says so rather than inventing a row', () => {
    expect(createRunRegistry().history()).toEqual([])
  })

  it('takes an approved phase off the live list', () => {
    // The run list used to stack every approved phase forever, so by the third
    // card it answered "what has this workspace ever done" instead of "what is
    // happening now".
    const registry = createRunRegistry()
    add(registry)
    registry.archive('session-1', 'approved', 9_000)
    expect(registry.live()).toEqual([])
    expect(registry.get('session-1')?.state).toBe('finished')
  })

  it('keeps what the phase actually did, not just that it happened', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.noteTurns('session-1', 12)
    registry.noteDiff('session-1', { files: 3, added: 90, removed: 4 })
    registry.noteAsked('session-1')
    const entry = registry.archive('session-1', 'approved', 9_000)
    expect(entry).toMatchObject({
      phase: 'implement',
      branch: 'feat/a',
      outcome: 'approved',
      endedAt: 9_000,
      turns: 12,
      diff: { files: 3, added: 90, removed: 4 },
      asked: 1,
    })
  })

  it('copies the diff rather than aliasing it, so later work cannot rewrite history', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.noteDiff('session-1', { files: 1, added: 1, removed: 0 })
    registry.archive('session-1', 'approved', 9_000)
    registry.noteDiff('session-1', { files: 99, added: 99, removed: 99 })
    expect(registry.history()[0].diff).toEqual({ files: 1, added: 1, removed: 0 })
  })

  it('reads newest first, because the last thing that happened is what you want', () => {
    const registry = createRunRegistry()
    add(registry)
    add(registry, { sessionId: 'session-2', branch: 'feat/b' })
    registry.archive('session-1', 'approved', 1_000)
    registry.archive('session-2', 'discarded', 2_000)
    expect(registry.history().map((entry) => entry.sessionId)).toEqual(['session-2', 'session-1'])
  })

  it('records every phase of one conversation separately', () => {
    // The point of the view: "specify approved, then plan approved", not one
    // row per session.
    const registry = createRunRegistry()
    add(registry)
    registry.archive('session-1', 'approved', 1_000)
    registry.notePhase('session-1', 'plan', 1_100)
    registry.archive('session-1', 'approved', 2_000)
    expect(registry.history().map((entry) => entry.phase)).toEqual(['plan', 'implement'])
  })

  it('is bounded, since it lives in memory for as long as the app does', () => {
    const registry = createRunRegistry()
    add(registry)
    for (let n = 0; n < 250; n++) {
      registry.notePhase('session-1', `phase-${n}`, n)
      registry.archive('session-1', 'approved', n)
    }
    expect(registry.history()).toHaveLength(200)
  })

  it('hands back a copy, so a surface cannot mutate the record it is showing', () => {
    const registry = createRunRegistry()
    add(registry)
    registry.archive('session-1', 'approved', 1_000)
    registry.history().length = 0
    expect(registry.history()).toHaveLength(1)
  })

  it('reports nothing for a session it does not have', () => {
    expect(createRunRegistry().archive('nobody', 'approved', 1)).toBeNull()
  })
})
