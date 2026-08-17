import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSupervision, type Supervision } from '../../src/runtime/supervision.js'

// A gate that counts and refuses nobody is worse than no gate, because you
// believe you have one. This is the check a run has to pass, and what it does
// when it does not.

let dir: string

function build(reviewLimit = 3): Supervision {
  return createSupervision({
    api: {} as never,
    stateDir: dir,
    reviewLimit,
    run: async (_command, args) => ({
      ok: true,
      stdout: args.includes('ls-files') ? '' : '10\t2\tsrc/a.ts',
    }),
  })
}

async function queueOne(s: Supervision, n: number): Promise<void> {
  s.runs.add({
    sessionId: `session-${n}`,
    featureDir: `/repo/specs/02${n}-card`,
    phase: 'implement',
    worktreePath: '/wt/a',
    branch: `feat/${n}`,
    terminalSessionId: `terminal-${n}`,
    transcriptPath: '/t.jsonl',
    startedAt: 0,
  })
  await s.finishTurn(`session-${n}`, 1, 2_000)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'backpressure-'))
})

afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }))

describe('the gate a run has to pass', () => {
  it('lets one through while there is review capacity', async () => {
    const s = build()
    await queueOne(s, 1)
    expect(s.backpressure.check().allowed).toBe(true)
  })

  it('refuses once the limit is reached', async () => {
    const s = build()
    for (const n of [1, 2, 3]) await queueOne(s, n)
    expect(s.backpressure.check().allowed).toBe(false)
  })

  it('says why and how deep, rather than refusing silently', async () => {
    const s = build()
    for (const n of [1, 2, 3]) await queueOne(s, n)
    const decision = s.backpressure.check()
    expect(decision.reason).toBeTruthy()
    expect(decision.unreviewed).toBe(3)
    expect(decision.limit).toBe(3)
  })

  it('reopens as soon as something is reviewed', async () => {
    const s = build()
    for (const n of [1, 2, 3]) await queueOne(s, n)
    s.review.remove('session-1')
    expect(s.backpressure.check().allowed).toBe(true)
  })

  it('counts a run from every card, since attention does not partition by card', async () => {
    const s = build()
    for (const n of [1, 2, 3]) await queueOne(s, n)
    // Three different cards, one queue.
    expect(new Set(s.review.list().map((i) => i.sessionId)).size).toBe(3)
    expect(s.backpressure.check().allowed).toBe(false)
  })

  it('does not count a run that changed nothing — there is nothing to review', async () => {
    const s = createSupervision({
      api: {} as never,
      stateDir: dir,
      reviewLimit: 1,
      run: async () => ({ ok: true, stdout: '' }),
    })
    await queueOne(s, 1)
    expect(s.backpressure.check().allowed).toBe(true)
  })

  it('records an override with the depth at the moment it was ignored', async () => {
    // A backlog built by overriding should be visible afterwards rather than
    // only felt.
    const s = build()
    for (const n of [1, 2, 3]) await queueOne(s, n)
    s.backpressure.override('/repo/specs/024-card', 9_000)
    expect(s.backpressure.overrides()[0]).toMatchObject({ queueDepth: 3 })
  })

  it('keeps the override record across a restart', async () => {
    const s = build()
    for (const n of [1, 2, 3]) await queueOne(s, n)
    s.backpressure.override('/repo/specs/024-card', 9_000)
    // A fresh gate over the same directory: the record is the point, and a
    // record that vanishes on restart cannot be reviewed later.
    expect(build().backpressure.overrides()).toHaveLength(1)
  })

  it('honours a limit of one, for someone who reviews as they go', async () => {
    const s = build(1)
    await queueOne(s, 1)
    expect(s.backpressure.check().allowed).toBe(false)
  })
})
