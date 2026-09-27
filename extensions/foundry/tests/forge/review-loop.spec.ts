import { describe, it, expect } from 'vitest'
import {
  MAX_REVIEW_ROUNDS,
  reviewPrompt,
  fixMessage,
  reviewNext,
  shouldReview,
} from '../../src/forge/review-loop.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder, RedTeamFinding } from '../../src/order/schema.js'
import { resolveRole } from '../../src/recipe/resolve.js'
import type { Role } from '../../src/recipe/parse.js'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

// The loop that argues before agreement.
//
// The red team and the architect trade turns without the operator, bounded by
// MAX_REVIEW_ROUNDS, and only a blocking finding keeps the loop going — see
// docs/research/foundry-red-team-loop.md.

const builtInDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

function redTeamRole(): Role {
  const resolved = resolveRole('red-team', { dataRoot: '/nowhere', repoPaths: [], builtInDir })
  if (!resolved.ok) throw new Error(resolved.reason)
  return resolved.resolved.value
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Hide done tickets in the picker',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, ...over }
}

function finding(over: Partial<RedTeamFinding> = {}): RedTeamFinding {
  return {
    id: 'RT-1',
    severity: 'high',
    text: 'the flag does not exist',
    status: 'open',
    reason: '',
    category: 'wrong-outcome',
    round: 1,
    ...over,
  }
}

describe('reviewPrompt', () => {
  it('builds the red-team brief with a round heading', () => {
    const prompt = reviewPrompt({
      order: order(),
      role: redTeamRole(),
      rules: [],
      outputPath: '/tmp/review-1.json',
      round: 1,
    })
    expect(prompt).toContain('Attack this order.')
    expect(prompt).toContain('## Round 1')
    expect(prompt).not.toContain('What changed since the last round')
  })

  it('adds what changed since the last round, on round 2 and later', () => {
    const prompt = reviewPrompt({
      order: order(),
      role: redTeamRole(),
      rules: [],
      outputPath: '/tmp/review-2.json',
      round: 2,
      changed: 'fixed the flag check in src/foo.ts',
    })
    expect(prompt).toContain('## Round 2')
    expect(prompt).toContain('## What changed since the last round')
    expect(prompt).toContain('fixed the flag check in src/foo.ts')
    expect(prompt).toContain('Attack only this.')
  })

  it('does not add the changed section on round 2 when nothing was passed', () => {
    const prompt = reviewPrompt({
      order: order(),
      role: redTeamRole(),
      rules: [],
      outputPath: '/tmp/review-2.json',
      round: 2,
    })
    expect(prompt).not.toContain('What changed since the last round')
  })
})

describe('fixMessage', () => {
  it('is null when there is no open blocking finding', () => {
    expect(fixMessage(order({ redTeam: [finding({ category: 'process' })] }))).toBeNull()
    expect(fixMessage(order({ redTeam: [finding({ status: 'resolved' })] }))).toBeNull()
    expect(fixMessage(order())).toBeNull()
  })

  it('lists every open blocking finding, with its id, category, severity and text', () => {
    const message = fixMessage(
      order({
        redTeam: [
          finding({ id: 'RT-1', category: 'wrong-outcome', severity: 'high', text: 'wrong' }),
          finding({ id: 'RT-2', category: 'regression', severity: 'medium', text: 'breaks it' }),
          finding({ id: 'RT-3', category: 'process', severity: 'low', text: 'a nit' }),
        ],
      })
    )
    expect(message).not.toBeNull()
    expect(message).toContain('RT-1 (wrong-outcome, high) — wrong')
    expect(message).toContain('RT-2 (regression, medium) — breaks it')
    expect(message).not.toContain('RT-3')
  })

  it('tells the architect to fix or dismiss, and how', () => {
    const message = fixMessage(order({ redTeam: [finding()] }))
    expect(message).toContain('resolveFindings')
    expect(message).toContain('dismissFindings')
    expect(message).toContain('90%')
  })
})

describe('reviewNext', () => {
  it('is clean when there is no open blocking finding', () => {
    expect(reviewNext({ order: order(), round: 1 })).toEqual({ kind: 'clean' })
    expect(
      reviewNext({ order: order({ redTeam: [finding({ category: 'scope' })] }), round: 1 })
    ).toEqual({ kind: 'clean' })
  })

  it('is a fix while blocking findings remain and the round is under the cap', () => {
    const next = reviewNext({ order: order({ redTeam: [finding()] }), round: 1 })
    expect(next.kind).toBe('fix')
  })

  it('hands off to the operator once the cap is reached', () => {
    const next = reviewNext({
      order: order({ redTeam: [finding()] }),
      round: MAX_REVIEW_ROUNDS,
    })
    expect(next).toEqual({ kind: 'operator' })
  })

  it('is still a fix one round short of the cap', () => {
    const next = reviewNext({
      order: order({ redTeam: [finding()] }),
      round: MAX_REVIEW_ROUNDS - 1,
    })
    expect(next.kind).toBe('fix')
  })
})

describe('shouldReview', () => {
  it('is false for a bare draft, which fails checks other than redTeam', () => {
    expect(shouldReview(order())).toBe(false)
  })

  it('is true once every other compile check passes', () => {
    const ready = order({
      intent: { problem: 'p', outcome: 'o', nonGoals: [] },
      risk: { grade: 'P3', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
      context: {
        ...order().context,
        toolchain: {
          ...order().context.toolchain,
          test: { command: 'npm test', source: 'package.json' as const },
        },
      },
      acceptance: [
        {
          id: 'AC-1',
          statement: 'it works',
          priority: 'P0',
          verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
      plan: {
        ...order().plan,
        units: [
          {
            id: 'U-1',
            title: 'do it',
            role: 'builder',
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: ['src/a.ts'],
            verify: [],
          },
        ],
        lanes: [{ ord: 1, repo: '/repos/a', branch: '', role: null, blocks: [], blockedBy: [] }],
        sharedFiles: [],
      },
    })
    expect(shouldReview(ready)).toBe(true)
  })

  it('is false when questions are unanswered, even with an otherwise clean order', () => {
    const draft = order({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'which approach?',
          why: 'ambiguous',
          options: ['a', 'b'],
          recommended: 0,
          answer: null,
          rank: 1,
          confidence: 0.5,
        },
      ],
    })
    expect(shouldReview(draft)).toBe(false)
  })
})
