import { describe, it, expect } from 'vitest'
import { paletteEntries } from '../../src/runtime/palette.js'
import type { Run } from '../../src/runtime/run-registry.js'
import type { ReviewItem } from '../../src/runtime/review/review-queue.js'

// What needs me, ranked — the same question the panel answers, one keystroke
// away. The ordering is the whole feature: a palette sorted by name is
// alphabetical noise.

const run = (over: Partial<Run> = {}): Run => ({
  sessionId: 'session-1',
  featureDir: '/repo/specs/021-thing',
  phase: 'implement',
  worktreePath: '/wt/thing',
  branch: 'feat/thing',
  terminalSessionId: 'terminal-1',
  transcriptPath: '/t.jsonl',
  startedAt: 0,
  state: 'working',
  stateSince: 0,
  turns: 1,
  diff: { files: 0, added: 0, removed: 0 },
  asked: 0,
  ...over,
})

const item = (over: Partial<ReviewItem> = {}): ReviewItem =>
  ({
    sessionId: 'session-r',
    repoPath: '/repo/.worktrees/thing',
    branch: 'feat/thing',
    grade: 'P0',
    gradeTrigger: 'touches auth',
    queuedAt: 0,
    diffSummary: { files: 2, added: 10, removed: 1 },
    step: 'intent',
    ...over,
  }) as ReviewItem

describe('what goes in the palette', () => {
  it('names the card, since that is what a person searches by', () => {
    expect(paletteEntries([run()], [])[0].label).toBe('Go to 021-thing')
  })

  it('says what state it is in — "go to" is a different decision when it is stuck', () => {
    expect(paletteEntries([run({ state: 'stalled' })], [])[0].description).toContain('stalled')
  })

  it('leaves out a run that has finished', () => {
    expect(paletteEntries([run({ state: 'finished' })], [])).toEqual([])
  })

  it('carries the session, which is all a handler needs', () => {
    expect(paletteEntries([run()], [])[0]).toMatchObject({ sessionId: 'session-1', kind: 'run' })
  })

  it('keeps an id that does not move between refreshes', () => {
    // Re-registering on every state change would otherwise shuffle the list
    // under the cursor.
    const first = paletteEntries([run()], [])[0].id
    expect(paletteEntries([run({ state: 'waiting' })], [])[0].id).toBe(first)
  })
})

describe('the order', () => {
  it('puts what is blocked above what is merely running', () => {
    const entries = paletteEntries(
      [
        run({ sessionId: 'a', branch: 'feat/a', state: 'working' }),
        run({ sessionId: 'b', branch: 'feat/b', state: 'waiting' }),
        run({ sessionId: 'c', branch: 'feat/c', state: 'stalled' }),
      ],
      []
    )
    expect(entries.map((e) => e.sessionId)).toEqual(['b', 'c', 'a'])
  })

  it('breaks a tie by branch rather than by insertion', () => {
    const entries = paletteEntries(
      [run({ sessionId: 'z', branch: 'feat/z' }), run({ sessionId: 'a', branch: 'feat/a' })],
      []
    )
    expect(entries.map((e) => e.sessionId)).toEqual(['a', 'z'])
  })

  it('puts the review queue after the runs, in the order the queue is kept', () => {
    // Re-sorting here would quietly disagree with the panel.
    const entries = paletteEntries(
      [run()],
      [item({ sessionId: 'r1', grade: 'P0' }), item({ sessionId: 'r2', grade: 'P2' })]
    )
    expect(entries.map((e) => e.sessionId)).toEqual(['session-1', 'r1', 'r2'])
  })
})

describe('a review entry', () => {
  it('says the grade and why, not just the letter', () => {
    const entry = paletteEntries([], [item()])[0]
    expect(entry.description).toContain('P0')
    expect(entry.description).toContain('touches auth')
  })

  it('counts one file as a file', () => {
    const entry = paletteEntries([], [item({ diffSummary: { files: 1, added: 1, removed: 0 } })])[0]
    expect(entry.description).toMatch(/1 file$/)
  })
})

describe('when there is nothing to show', () => {
  it('contributes nothing rather than an empty heading', () => {
    expect(paletteEntries([], [])).toEqual([])
  })
})
