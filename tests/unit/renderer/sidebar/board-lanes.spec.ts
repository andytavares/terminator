import { describe, it, expect } from 'vitest'
import { buildLanes } from '../../../../src/renderer/sidebar/board-lanes'
import { STATUS_ORDER } from '../../../../src/renderer/sidebar/view-model'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import type {
  AgentState,
  Project,
  TerminalSession,
  Workspace,
} from '../../../../src/shared/types/index'

const repo: Workspace = {
  id: 'ws-1',
  name: 'terminator',
  folderPath: '/repos/terminator',
  color: '#5c6bc0',
  tags: [],
  createdAt: '',
  updatedAt: '',
}
const other: Workspace = { ...repo, id: 'ws-2', name: 'kalli', color: '#e0995c' }

const branch: Project = {
  id: 'p1',
  workspaceId: 'ws-1',
  name: 'API',
  gitBranch: '034-declutter',
  isWorktree: true,
  createdAt: '',
  updatedAt: '',
}
const branchless: Project = {
  id: 'p2',
  workspaceId: 'ws-2',
  name: 'Web',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

function session(id: string, patch: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    projectId: 'p1',
    tabTitle: id,
    status: 'active',
    type: 'agent',
    scrollbackLimit: 10000,
    createdAt: '',
    lastActivityAt: 1000,
    agentState: 'idle',
    ...patch,
  }
}

const build = (sessions: TerminalSession[], hidden: AgentState[] = []) =>
  buildLanes(sessions, [branch, branchless], [repo, other], hidden)

const laneFor = (lanes: ReturnType<typeof buildLanes>, state: AgentState) =>
  lanes.find((l) => l.state === state)!

describe('buildLanes', () => {
  // BL-1. The board reads the same severity constant as the sidebar, so the
  // two cannot disagree about which state comes first.
  it('returns one lane per state, in STATUS_ORDER', () => {
    const lanes = build([])
    expect(lanes.map((l) => l.state)).toEqual(STATUS_ORDER)
  })

  it('labels the lanes for a person, not for the enum', () => {
    const lanes = build([])
    expect(lanes.map((l) => l.label)).toEqual(['Needs you', 'Working', 'Idle', 'Exited'])
  })

  // BL-3. Every open terminal lands in exactly one lane.
  it('places each terminal in the lane matching its state', () => {
    const lanes = build([
      session('a', { agentState: 'awaiting-input' }),
      session('b', { agentState: 'working' }),
      session('c', { agentState: 'idle' }),
    ])
    expect(laneFor(lanes, 'awaiting-input').cards.map((c) => c.sessionId)).toEqual(['a'])
    expect(laneFor(lanes, 'working').cards.map((c) => c.sessionId)).toEqual(['b'])
    expect(laneFor(lanes, 'idle').cards.map((c) => c.sessionId)).toEqual(['c'])
  })

  it('puts a terminal in exactly one lane and no other', () => {
    const lanes = build([session('a', { agentState: 'working' })])
    const appearances = lanes.flatMap((l) => l.cards).filter((c) => c.sessionId === 'a')
    expect(appearances).toHaveLength(1)
  })

  it('files a closed terminal under exited whatever its stored state says', () => {
    const lanes = build([session('a', { status: 'closed', agentState: 'working' })])
    expect(laneFor(lanes, 'exited').cards.map((c) => c.sessionId)).toEqual(['a'])
    expect(laneFor(lanes, 'working').cards).toHaveLength(0)
  })

  // BL-2. The number on a lane header is the number of cards under it — the
  // first thing to drift when the two are computed separately.
  it('reports a count equal to the cards it holds', () => {
    const lanes = build([
      session('a', { agentState: 'working' }),
      session('b', { agentState: 'working' }),
      session('c', { agentState: 'idle' }),
    ])
    for (const lane of lanes) expect(lane.count).toBe(lane.cards.length)
    expect(laneFor(lanes, 'working').count).toBe(2)
  })

  // BL-4. Exited is a record, not a queue: it disappears rather than sitting
  // there empty.
  it('hides the exited lane while it holds nothing', () => {
    expect(laneFor(build([]), 'exited').visible).toBe(false)
  })

  it('shows the exited lane once something has exited', () => {
    const lanes = build([session('a', { status: 'closed' })])
    expect(laneFor(lanes, 'exited').visible).toBe(true)
  })

  it('marks only the exited lane as history', () => {
    const lanes = build([])
    expect(lanes.filter((l) => l.isHistory).map((l) => l.state)).toEqual(['exited'])
  })

  it('leaves a live lane visible even when it is empty', () => {
    // An empty active lane still draws its header and count — that a lane is
    // empty is information. Only its body is blank.
    const lanes = build([session('a', { agentState: 'working' })])
    const idle = laneFor(lanes, 'idle')
    expect(idle.visible).toBe(true)
    expect(idle.cards).toHaveLength(0)
  })

  // BL-5. Hiding is presentational: the cards are still there, so unhiding
  // costs nothing and needs no recomputation.
  it('keeps a user-hidden lane populated and only flips visible', () => {
    const lanes = build([session('a', { agentState: 'working' })], ['working'])
    const working = laneFor(lanes, 'working')
    expect(working.visible).toBe(false)
    expect(working.cards).toHaveLength(1)
  })

  describe('the card', () => {
    it('names the terminal, and its repo and branch on one line', () => {
      const [card] = laneFor(build([session('a', { agentState: 'working' })]), 'working').cards
      expect(card.title).toBe('a')
      expect(card.sourceLabel).toBe('terminator / 034-declutter')
    })

    it('falls back to the stored name when the folder is not a repo', () => {
      const lanes = build([session('a', { projectId: 'p2', agentState: 'working' })])
      expect(laneFor(lanes, 'working').cards[0].sourceLabel).toBe('kalli / Web')
    })

    // BL-6. A scratch terminal belongs to no repo, so it draws no rail.
    it('says "no branch" for a scratch terminal and gives it no colour', () => {
      const lanes = build([session('a', { projectId: SCRATCH_PROJECT_ID, agentState: 'working' })])
      const [card] = laneFor(lanes, 'working').cards
      expect(card.sourceLabel).toBe('no branch')
      expect(card.workspaceColor).toBeNull()
    })

    it('carries the repo colour for a terminal that has one', () => {
      const lanes = build([session('a', { agentState: 'working' })])
      expect(laneFor(lanes, 'working').cards[0].workspaceColor).toBe('#5c6bc0')
    })

    it('carries the bell count and the activity stamp', () => {
      const lanes = build([
        session('a', { agentState: 'awaiting-input', bellCount: 3, lastActivityAt: 4242 }),
      ])
      const [card] = laneFor(lanes, 'awaiting-input').cards
      expect(card.bellCount).toBe(3)
      expect(card.lastActivityAt).toBe(4242)
    })

    it('reports no bells rather than undefined when none have rung', () => {
      const lanes = build([session('a', { agentState: 'working' })])
      expect(laneFor(lanes, 'working').cards[0].bellCount).toBe(0)
    })

    it('drops a terminal whose branch has gone rather than crashing the board', () => {
      const lanes = build([session('a', { projectId: 'gone', agentState: 'working' })])
      expect(laneFor(lanes, 'working').cards).toHaveLength(0)
    })

    it('orders cards most recently active first', () => {
      const lanes = build([
        session('old', { agentState: 'working', lastActivityAt: 10 }),
        session('new', { agentState: 'working', lastActivityAt: 99 }),
      ])
      expect(laneFor(lanes, 'working').cards.map((c) => c.sessionId)).toEqual(['new', 'old'])
    })
  })

  // BL-7. Pure: no clock, no store, and it does not disturb its arguments.
  it('is deterministic and does not mutate its inputs', () => {
    const sessions = [session('a', { agentState: 'working' }), session('b')]
    const order = sessions.map((s) => s.id)
    expect(JSON.stringify(build(sessions))).toBe(JSON.stringify(build(sessions)))
    expect(sessions.map((s) => s.id)).toEqual(order)
  })
})
