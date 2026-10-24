import { describe, it, expect } from 'vitest'
import { deskCounts } from '../../../../src/renderer/home/desk-summary'
import { buildWorkThreads } from '../../../../src/renderer/home/work-threads'
import { fact } from '../sidebar/fixtures/facts'
import { facet } from './fixtures'

const NOW = Date.parse('2026-10-18T12:00:00.000Z')

const ACTIVE = { lastActivityAt: NOW - 1000 }

function threadsOnDesk() {
  return buildWorkThreads({
    facts: [
      fact({ sessionId: 'a', branch: 'a', state: 'working', ...ACTIVE }),
      fact({ sessionId: 'b', branch: 'a', state: 'working', ...ACTIVE }),
      fact({ sessionId: 'c', branch: 'c', state: 'idle', ...ACTIVE }),
    ],
    facets: [
      facet({ workKey: { repoRoot: '/r', branch: 'c' }, tone: 'bad' }),
      facet({ workKey: { repoRoot: '/r', branch: 'z' }, tone: 'good' }),
    ],
    issues: [],
    tasks: [],
    changeStats: new Map(),
    repos: new Map(),
    repoRoots: new Map([['p1', '/r']]),
    now: NOW,
  })
}

describe('deskCounts', () => {
  it('counts asks, working sessions, threads waiting on others and failing pull requests', () => {
    const threads = threadsOnDesk()
    const asks = [{ id: '1' }, { id: '2' }] as never
    expect(deskCounts(asks, threads)).toEqual({
      yourMove: 2,
      agentsWorking: 2,
      waitingOnOthers: 2,
      failingChecks: 1,
    })
  })

  it('is all zero for an empty desk', () => {
    expect(deskCounts([], [])).toEqual({
      yourMove: 0,
      agentsWorking: 0,
      waitingOnOthers: 0,
      failingChecks: 0,
    })
  })
})
