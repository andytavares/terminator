import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createLaneBindings } from '../../../../../src/main/supervision/workitems/lane-bindings.js'

function memoryStore() {
  let value: unknown
  return { get: () => value, set: (v: unknown) => (value = v) }
}

describe('binding', () => {
  it('binds a session to a lane', () => {
    const bindings = createLaneBindings(memoryStore())
    bindings.bind('FLU-220', 1, 'b1e2', 1_000)
    expect(bindings.forLane('FLU-220', 1)).toMatchObject({ sessionId: 'b1e2', boundAt: 1_000 })
  })

  it('returns null for a lane with no binding', () => {
    expect(createLaneBindings(memoryStore()).forLane('FLU-220', 1)).toBeNull()
  })

  it('is single-valued per lane — re-binding replaces (spec Edge Cases)', () => {
    const bindings = createLaneBindings(memoryStore())
    bindings.bind('FLU-220', 1, 'first', 1_000)
    bindings.bind('FLU-220', 1, 'second', 2_000)
    expect(bindings.forLane('FLU-220', 1)?.sessionId).toBe('second')
    expect(bindings.forWorkItem('FLU-220')).toHaveLength(1)
  })

  it('keeps lanes of the same work item separate', () => {
    const bindings = createLaneBindings(memoryStore())
    bindings.bind('FLU-220', 1, 'a', 1_000)
    bindings.bind('FLU-220', 2, 'b', 1_000)
    expect(bindings.forWorkItem('FLU-220').map((b) => b.sessionId)).toEqual(['a', 'b'])
  })

  it('returns a work item lanes in merge order', () => {
    const bindings = createLaneBindings(memoryStore())
    bindings.bind('FLU-220', 3, 'c', 1_000)
    bindings.bind('FLU-220', 1, 'a', 1_000)
    expect(bindings.forWorkItem('FLU-220').map((b) => b.laneOrd)).toEqual([1, 3])
  })

  it('keeps work items separate', () => {
    const bindings = createLaneBindings(memoryStore())
    bindings.bind('A', 1, 'a', 1_000)
    bindings.bind('B', 1, 'b', 1_000)
    expect(bindings.forWorkItem('A')).toHaveLength(1)
  })

  it('finds the lane a session is running', () => {
    const bindings = createLaneBindings(memoryStore())
    bindings.bind('FLU-220', 2, 'b1e2', 1_000)
    expect(bindings.forSession('b1e2')).toMatchObject({ workItemId: 'FLU-220', laneOrd: 2 })
  })

  it('returns null for a session that is bound to nothing — ad-hoc work (FR-081)', () => {
    expect(createLaneBindings(memoryStore()).forSession('ad-hoc')).toBeNull()
  })
})

describe('unbinding', () => {
  it('removes a binding', () => {
    const bindings = createLaneBindings(memoryStore())
    bindings.bind('FLU-220', 1, 'b1e2', 1_000)
    bindings.unbind('FLU-220', 1)
    expect(bindings.forLane('FLU-220', 1)).toBeNull()
  })

  it('is a no-op for a lane with no binding', () => {
    const bindings = createLaneBindings(memoryStore())
    expect(() => bindings.unbind('FLU-220', 1)).not.toThrow()
  })
})

describe('persistence', () => {
  it('survives a reopen', () => {
    const store = memoryStore()
    createLaneBindings(store).bind('FLU-220', 1, 'b1e2', 1_000)
    expect(createLaneBindings(store).forLane('FLU-220', 1)?.sessionId).toBe('b1e2')
  })

  it('drops a corrupt entry without losing the rest', () => {
    const store = memoryStore()
    store.set({
      'FLU-220#1': { workItemId: 'FLU-220', laneOrd: 1, sessionId: 'good', boundAt: 1 },
      'FLU-220#2': 'not a binding',
    })
    const bindings = createLaneBindings(store)
    expect(bindings.forWorkItem('FLU-220')).toHaveLength(1)
  })

  it('starts empty for a corrupt payload', () => {
    const store = memoryStore()
    store.set('garbage')
    expect(createLaneBindings(store).forWorkItem('X')).toEqual([])
  })
})

describe('the producer file is never touched (FR-073, FR-075)', () => {
  it('leaves the published contract byte-for-byte unchanged when a session is bound', () => {
    // The sharpest test of the boundary, and the one quickstart.md § P6 runs.
    const dir = mkdtempSync(join(tmpdir(), 'producer-'))
    try {
      const producerDir = join(dir, 'producer-a')
      mkdirSync(producerDir, { recursive: true })
      const contractPath = join(producerDir, 'FLU-220.json')
      const original = JSON.stringify({ contract_version: 1, id: 'FLU-220' })
      writeFileSync(contractPath, original)

      createLaneBindings(memoryStore()).bind('FLU-220', 1, 'b1e2', 1_000)

      expect(readFileSync(contractPath, 'utf-8')).toBe(original)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
