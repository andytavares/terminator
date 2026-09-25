import { describe, it, expect } from 'vitest'
import { drawCrew } from '../../../src/factory/art/crew.js'
import type { Crew, CrewAnim, Facing } from '../../../src/factory/sim.js'
import { createRecordingPaint } from './paint-fake.js'

const ALL_ANIMS: readonly CrewAnim[] = [
  'walk',
  'idle',
  'type',
  'reach',
  'scan',
  'wave',
  'slump',
  'couch',
]
const ALL_FACINGS: readonly Facing[] = ['N', 'S', 'E', 'W']

function crew(overrides: Partial<Crew> = {}): Crew {
  return {
    nodeId: 'n1',
    role: 'builder',
    x: 40,
    y: 60,
    facing: 'S',
    anim: 'idle',
    path: [],
    goal: null,
    then: 'idle',
    present: true,
    ...overrides,
  }
}

describe('factory/art/crew drawCrew', () => {
  it('draws every anim in every facing without throwing', () => {
    for (const anim of ALL_ANIMS) {
      for (const facing of ALL_FACINGS) {
        const paint = createRecordingPaint()
        expect(() => drawCrew(paint, crew({ anim, facing }), 0)).not.toThrow()
        expect(paint.calls.length).toBeGreaterThan(0)
      }
    }
  })

  it('draws nothing for a crew member marked not present (orphaned)', () => {
    const paint = createRecordingPaint()
    drawCrew(paint, crew({ present: false, anim: 'type' }), 0)
    expect(paint.calls).toHaveLength(0)
  })

  it('changes the walk pose across the four-frame cycle', () => {
    const frames = [0, 110, 220, 330].map((tMs) => {
      const paint = createRecordingPaint()
      drawCrew(paint, crew({ anim: 'walk' }), tMs)
      return paint.calls
    })
    const distinct = new Set(frames.map((f) => JSON.stringify(f)))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('gives a builder a hat mark and a foreman a vest mark', () => {
    const builder = createRecordingPaint()
    drawCrew(builder, crew({ role: 'builder' }), 0)
    const foreman = createRecordingPaint()
    drawCrew(foreman, crew({ role: 'foreman' }), 0)
    expect(foreman.calls.some((c) => c.op === 'fillRect' && c.style === '#f28c28')).toBe(true)
    expect(builder.calls.some((c) => c.op === 'fillRect' && c.style === '#f28c28')).toBe(false)
  })

  it('does not throw for an unknown role (neutral silhouette)', () => {
    const paint = createRecordingPaint()
    expect(() => drawCrew(paint, crew({ role: 'integrator' }), 0)).not.toThrow()
  })

  it('draws a visor for a visored role facing every direction', () => {
    for (const facing of ALL_FACINGS) {
      const paint = createRecordingPaint()
      drawCrew(paint, crew({ role: 'verifier', facing }), 0)
      expect(paint.calls.length).toBeGreaterThan(0)
    }
  })

  it('alternates the typing arms across the tick', () => {
    const a = createRecordingPaint()
    drawCrew(a, crew({ anim: 'type' }), 0)
    const b = createRecordingPaint()
    drawCrew(b, crew({ anim: 'type' }), 100)
    expect(a.calls).not.toEqual(b.calls)
  })
})
