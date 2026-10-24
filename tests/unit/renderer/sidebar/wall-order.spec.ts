import { describe, it, expect } from 'vitest'
import { placeWall } from '../../../../src/renderer/sidebar/wall-order'
import { DEFAULT_WALL_PREFS } from '../../../../src/renderer/sidebar/wall-prefs'
import { fact } from './fixtures/facts'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'

const T1 = '2026-09-15T10:00:00.000Z'
const T2 = '2026-09-15T10:01:00.000Z'
const T3 = '2026-09-15T10:02:00.000Z'
const T4 = '2026-09-15T10:03:00.000Z'
const T5 = '2026-09-15T10:04:00.000Z'

const facts: SessionFacts[] = [
  fact({ sessionId: 'd-idle', state: 'idle', startedAt: T4, projectName: 'b-proj' }),
  fact({ sessionId: 'a-needs-old', state: 'awaiting-input', startedAt: T1 }),
  fact({ sessionId: 'c-work', state: 'working', startedAt: T3, projectName: 'c-proj' }),
  fact({ sessionId: 'e-exited', state: 'exited', startedAt: T5, projectName: 'a-proj' }),
  fact({ sessionId: 'b-needs-new', state: 'awaiting-input', startedAt: T2 }),
  fact({
    sessionId: 'z-closed',
    isClosed: true,
    state: 'exited',
    closedAt: '2026-09-15T00:00:00.000Z',
  }),
]

const inOrder = (wall: ReturnType<typeof placeWall>) =>
  [...wall.placements].sort((a, b) => a.order - b.order).map((p) => p.sessionId)

describe('placeWall', () => {
  it('emits one placement per open session, always in session id order', () => {
    const wall = placeWall(facts, DEFAULT_WALL_PREFS)
    expect(wall.placements.map((p) => p.sessionId)).toEqual([
      'a-needs-old',
      'b-needs-new',
      'c-work',
      'd-idle',
      'e-exited',
    ])
  })

  it('keeps that emission order when a session changes state', () => {
    const before = placeWall(facts, DEFAULT_WALL_PREFS).placements.map((p) => p.sessionId)
    const moved = facts.map((f) =>
      f.sessionId === 'c-work' ? { ...f, state: 'awaiting-input' as const } : f
    )
    const after = placeWall(moved, DEFAULT_WALL_PREFS)
    expect(after.placements.map((p) => p.sessionId)).toEqual(before)
    expect(after.placements.find((p) => p.sessionId === 'c-work')).toMatchObject({
      band: 'needs',
      span: 2,
    })
  })
})

describe('placeWall — pins sessions that need you, oldest first, then the rest by state', () => {
  it('pins sessions that need you, oldest first, then the rest by state', () => {
    const wall = placeWall(facts, DEFAULT_WALL_PREFS)
    expect(wall.needsCount).toBe(2)
    expect(inOrder(wall)).toEqual(['a-needs-old', 'b-needs-new', 'c-work', 'd-idle', 'e-exited'])
    expect(wall.placements.find((p) => p.sessionId === 'a-needs-old')).toMatchObject({
      band: 'needs',
      span: 2,
    })
    expect(wall.placements.find((p) => p.sessionId === 'd-idle')).toMatchObject({
      band: 'rest',
      span: 1,
    })
  })

  it('leaves room in the order for the two band headings', () => {
    const wall = placeWall(facts, DEFAULT_WALL_PREFS)
    const orders = wall.placements.map((p) => p.order)
    expect(orders).not.toContain(0)
    expect(orders).not.toContain(wall.needsCount + 1)
  })

  it('does not pin when pinning is off, and needs-you sorts first by state instead', () => {
    const wall = placeWall(facts, { ...DEFAULT_WALL_PREFS, pinNeeds: false })
    expect(wall.needsCount).toBe(0)
    expect(wall.placements.every((p) => p.band === 'rest' && p.span === 1)).toBe(true)
    expect(inOrder(wall)).toEqual(['a-needs-old', 'b-needs-new', 'c-work', 'd-idle', 'e-exited'])
  })
})

describe('placeWall — orders the rest by workspace and project when asked', () => {
  it('orders the rest by workspace and project when asked', () => {
    const wall = placeWall(facts, { ...DEFAULT_WALL_PREFS, thenBy: 'workspace-project' })
    expect(inOrder(wall).slice(2)).toEqual(['e-exited', 'd-idle', 'c-work'])
  })

  it('places nothing for no sessions', () => {
    expect(placeWall([], DEFAULT_WALL_PREFS)).toEqual({
      placements: [],
      needsCount: 0,
      taskBands: [],
    })
  })
})

describe('placeWall — output never moves a session (055/058)', () => {
  const running: SessionFacts[] = [
    fact({ sessionId: 'r1', state: 'working', startedAt: T1, lastActivityAt: 100 }),
    fact({ sessionId: 'r2', state: 'idle', startedAt: T2, lastActivityAt: 200 }),
  ]

  it('keeps two running sessions in place when their lastActivityAt values swap', () => {
    const before = inOrder(placeWall(running, DEFAULT_WALL_PREFS))
    const swapped = running.map((f) => ({
      ...f,
      lastActivityAt: f.sessionId === 'r1' ? 999 : 1,
    }))
    const after = inOrder(placeWall(swapped, DEFAULT_WALL_PREFS))
    expect(after).toEqual(before)
  })

  it('does not move a session when it flips from working to idle', () => {
    const before = inOrder(placeWall(running, DEFAULT_WALL_PREFS))
    const flipped = running.map((f) =>
      f.sessionId === 'r1' ? { ...f, state: 'idle' as const } : f
    )
    const after = inOrder(placeWall(flipped, DEFAULT_WALL_PREFS))
    expect(after).toEqual(before)
  })

  it('puts a session with a newer startedAt last within its rank', () => {
    const wall = placeWall(
      [...running, fact({ sessionId: 'r3', state: 'working', startedAt: T3 })],
      DEFAULT_WALL_PREFS
    )
    expect(inOrder(wall)).toEqual(['r1', 'r2', 'r3'])
  })
})

describe("placeWall — thenBy 'recent' orders by when a session was last opened", () => {
  const opened: SessionFacts[] = [
    fact({ sessionId: 'never', state: 'working', startedAt: T1, lastAttendedAt: null }),
    fact({ sessionId: 'older', state: 'working', startedAt: T2, lastAttendedAt: 100 }),
    fact({ sessionId: 'newer', state: 'working', startedAt: T3, lastAttendedAt: 200 }),
  ]

  it('orders most recently opened first, with never-attended sessions last', () => {
    const wall = placeWall(opened, { ...DEFAULT_WALL_PREFS, thenBy: 'recent' })
    expect(inOrder(wall)).toEqual(['newer', 'older', 'never'])
  })
})

const BY_TASK = { ...DEFAULT_WALL_PREFS, thenBy: 'task' as const }
const LOGIN = { id: 'task-login', title: 'Login rework' }
const BILLING = { id: 'task-billing', title: 'Billing' }

const taskFacts: SessionFacts[] = [
  fact({ sessionId: 'a', state: 'working', startedAt: T1, workspaceName: 'api' }),
  fact({ sessionId: 'b', state: 'idle', startedAt: T2, workspaceName: 'web' }),
  fact({ sessionId: 'c', state: 'working', startedAt: T3, workspaceName: 'api' }),
  fact({ sessionId: 'd', state: 'idle', startedAt: T4, workspaceName: 'api' }),
  fact({ sessionId: 'e', state: 'idle', startedAt: T5, workspaceName: 'web' }),
]
const taskOfSession = new Map([
  ['a', LOGIN],
  ['b', BILLING],
  ['c', LOGIN],
  ['d', LOGIN],
])

describe('placeWall — then by task', () => {
  it('puts each task’s tiles together, tasks in title order, tiles in no task last', () => {
    const wall = placeWall(taskFacts, BY_TASK, taskOfSession)
    expect(inOrder(wall)).toEqual(['b', 'a', 'c', 'd', 'e'])
  })

  it('counts each band’s repos and terminals', () => {
    const { taskBands } = placeWall(taskFacts, BY_TASK, taskOfSession)
    expect(taskBands.map((b) => [b.title, b.repoCount, b.terminalCount])).toEqual([
      ['Billing', 1, 1],
      ['Login rework', 1, 3],
      ['Not in a task', 1, 1],
    ])
  })

  it('gives every band a heading slot before its first tile', () => {
    const wall = placeWall(taskFacts, BY_TASK, taskOfSession)
    const firstTile = (id: string) => wall.placements.find((p) => p.sessionId === id)!.order
    const [billing, login, loose] = wall.taskBands
    expect(billing.order).toBe(firstTile('b') - 1)
    expect(login.order).toBe(firstTile('a') - 1)
    expect(loose.order).toBe(firstTile('e') - 1)
  })

  it('draws no bands for any other arrangement', () => {
    expect(placeWall(taskFacts, DEFAULT_WALL_PREFS, taskOfSession).taskBands).toEqual([])
  })

  it('draws no “Not in a task” band when every tile is in a task', () => {
    const { taskBands } = placeWall(taskFacts.slice(0, 4), BY_TASK, taskOfSession)
    expect(taskBands.map((b) => b.title)).toEqual(['Billing', 'Login rework'])
  })
})
