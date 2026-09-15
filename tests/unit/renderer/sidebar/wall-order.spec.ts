import { describe, it, expect } from 'vitest'
import { placeWall } from '../../../../src/renderer/sidebar/wall-order'
import { DEFAULT_WALL_PREFS } from '../../../../src/renderer/sidebar/wall-prefs'
import { fact } from './fixtures/facts'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'

const facts: SessionFacts[] = [
  fact({ sessionId: 'd-idle', state: 'idle', lastActivityAt: 4, projectName: 'b-proj' }),
  fact({ sessionId: 'a-needs-old', state: 'awaiting-input', lastActivityAt: 1 }),
  fact({ sessionId: 'c-work', state: 'working', lastActivityAt: 2, projectName: 'c-proj' }),
  fact({ sessionId: 'e-exited', state: 'exited', lastActivityAt: 9, projectName: 'a-proj' }),
  fact({ sessionId: 'b-needs-new', state: 'awaiting-input', lastActivityAt: 8 }),
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

  it('pins sessions that need you, double width, newest first, then the rest by state', () => {
    const wall = placeWall(facts, DEFAULT_WALL_PREFS)
    expect(wall.needsCount).toBe(2)
    expect(inOrder(wall)).toEqual(['b-needs-new', 'a-needs-old', 'c-work', 'd-idle', 'e-exited'])
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
    expect(inOrder(wall)).toEqual(['b-needs-new', 'a-needs-old', 'c-work', 'd-idle', 'e-exited'])
  })

  it('orders the rest by workspace and project when asked', () => {
    const wall = placeWall(facts, { ...DEFAULT_WALL_PREFS, thenBy: 'workspace-project' })
    expect(inOrder(wall).slice(2)).toEqual(['e-exited', 'd-idle', 'c-work'])
  })

  it('orders the rest by most recent activity when asked', () => {
    const wall = placeWall(facts, { ...DEFAULT_WALL_PREFS, thenBy: 'recent' })
    expect(inOrder(wall).slice(2)).toEqual(['e-exited', 'd-idle', 'c-work'])
  })

  it('places nothing for no sessions', () => {
    expect(placeWall([], DEFAULT_WALL_PREFS)).toEqual({ placements: [], needsCount: 0 })
  })
})
