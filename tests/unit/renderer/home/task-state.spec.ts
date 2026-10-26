import { describe, it, expect } from 'vitest'
import {
  laneStateOf,
  needsYouInferred,
  taskStateOf,
  type LaneFacts,
} from '../../../../src/renderer/home/task-state'
import { fact } from '../sidebar/fixtures/facts'
import { facet } from './fixtures'

const lane = (patch: Partial<LaneFacts> = {}): LaneFacts => ({ sessions: [], facets: [], ...patch })
const MERGED = { closedAt: '2026-10-18T10:00:00.000Z', whoseMove: 'agents' as const }
const closedSession = () => fact({ isClosed: true, state: 'exited' })

describe('laneStateOf: facts', () => {
  it('is needs-you when a session is awaiting input', () => {
    expect(laneStateOf(lane({ sessions: [fact({ state: 'awaiting-input' })] }))).toBe('needs-you')
  })

  it('is needs-you when a facet says it is your move', () => {
    expect(laneStateOf(lane({ facets: [facet({ whoseMove: 'you' })] }))).toBe('needs-you')
  })

  it('is running when a session is working, including a Claude turn that prints nothing', () => {
    const silentTurn = fact({ state: 'working', runningFrom: 'agent-turn', latestLine: '' })
    expect(laneStateOf(lane({ sessions: [silentTurn] }))).toBe('running')
  })

  it('is waiting when a facet is with others and still open', () => {
    expect(laneStateOf(lane({ facets: [facet({ whoseMove: 'others' })] }))).toBe('waiting')
  })
})

describe('laneStateOf: quiet and done', () => {
  it('is quiet, never waiting, for a branch with no pull request and nothing running', () => {
    expect(laneStateOf(lane({ sessions: [fact({ state: 'idle' })] }))).toBe('quiet')
    expect(laneStateOf(lane())).toBe('quiet')
  })

  it('is quiet, not waiting, when the facet that was with others has closed', () => {
    const merged = facet({ ...MERGED, whoseMove: 'others' })
    expect(laneStateOf(lane({ sessions: [fact()], facets: [merged] }))).toBe('quiet')
  })

  it('never reads a facet stage', () => {
    const shipped = facet({ stage: 'shipped', whoseMove: 'agents' })
    expect(laneStateOf(lane({ facets: [shipped] }))).toBe('quiet')
  })

  it('is done once its pull request is closed and its sessions have ended', () => {
    const state = laneStateOf(lane({ sessions: [closedSession()], facets: [facet(MERGED)] }))
    expect(state).toBe('done')
  })
})

describe('taskStateOf: urgency', () => {
  it('takes the most urgent lane', () => {
    const lanes = [
      lane({ facets: [facet({ whoseMove: 'others' })] }),
      lane({ sessions: [fact({ state: 'working' })] }),
      lane({ sessions: [fact({ state: 'idle' })] }),
    ]
    expect(taskStateOf(lanes, null)).toBe('running')
    lanes.push(lane({ sessions: [fact({ state: 'awaiting-input' })] }))
    expect(taskStateOf(lanes, null)).toBe('needs-you')
  })
})

describe('taskStateOf: done', () => {
  it('is done when doneAt is set, with no pull request at all', () => {
    expect(taskStateOf([lane({ sessions: [fact({ state: 'working' })] })], '2026-10-18')).toBe(
      'done'
    )
  })

  it('is done when every lane has a merged pull request and its sessions are closed', () => {
    const merged = lane({ sessions: [closedSession()], facets: [facet(MERGED)] })
    expect(taskStateOf([merged, merged], null)).toBe('done')
  })

  it('is not done while one lane has no pull request', () => {
    const merged = lane({ sessions: [closedSession()], facets: [facet(MERGED)] })
    expect(taskStateOf([merged, lane({ sessions: [closedSession()] })], null)).toBe('quiet')
  })

  it('is not done while a session on a merged lane is still open', () => {
    const open = lane({ sessions: [fact({ state: 'idle' })], facets: [facet(MERGED)] })
    expect(taskStateOf([open], null)).toBe('quiet')
  })

  it('is quiet with no lanes', () => {
    expect(taskStateOf([], null)).toBe('quiet')
  })
})

describe('needsYouInferred', () => {
  const bell = fact({ state: 'awaiting-input', askInferred: true, askSignal: 'bell' })
  const hook = fact({ sessionId: 'h', state: 'awaiting-input', askMessage: 'Allow Bash?' })

  it('is true for a bell alone', () => {
    expect(needsYouInferred([lane({ sessions: [bell] })])).toBe(true)
  })

  it('is false when a hook reported the ask', () => {
    expect(needsYouInferred([lane({ sessions: [hook] })])).toBe(false)
  })

  it('is false when a hook ask or a facet ask stands beside the bell', () => {
    expect(needsYouInferred([lane({ sessions: [bell, hook] })])).toBe(false)
    expect(
      needsYouInferred([lane({ sessions: [bell], facets: [facet({ whoseMove: 'you' })] })])
    ).toBe(false)
  })

  it('is false when nothing needs you', () => {
    expect(needsYouInferred([lane({ sessions: [fact({ state: 'working' })] })])).toBe(false)
  })
})
