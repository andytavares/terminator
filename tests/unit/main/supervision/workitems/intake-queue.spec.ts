import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createIntakeQueue } from '../../../../../src/main/supervision/workitems/intake-queue.js'
import type { IntakeStub } from '../../../../../src/main/supervision/workitems/intake.js'

// Intake returned a stub that nothing kept, so the board never showed one and
// "it waits until you start it" was true of nothing.

let dir: string
beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'intake-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const path = () => join(dir, 'intake.jsonl')

const stub = (over: Partial<IntakeStub> = {}): IntakeStub => ({
  id: 'FLU-220',
  source: 'linear',
  sourceUrl: 'https://linear.app/team/issue/FLU-220',
  title: 'Unify session identity',
  createdAt: 1_000,
  phase: 'intake',
  ...over,
})

describe('the intake queue', () => {
  it('keeps what was taken in', () => {
    const queue = createIntakeQueue(path())
    queue.add(stub())
    expect(queue.list()).toEqual([expect.objectContaining(stub())])
  })

  it('survives a restart, which is the whole point of keeping it', () => {
    createIntakeQueue(path()).add(stub())
    expect(createIntakeQueue(path()).list()).toHaveLength(1)
  })

  it('updates rather than duplicating when the same ticket arrives twice', () => {
    // Pulling from Linear again is normal and must be safe to do whenever.
    const queue = createIntakeQueue(path())
    queue.add(stub())
    queue.add(stub({ title: 'Renamed in Linear' }))
    expect(queue.list()).toHaveLength(1)
    expect(queue.list()[0].title).toBe('Renamed in Linear')
  })

  it('removes one', () => {
    const queue = createIntakeQueue(path())
    queue.add(stub())
    queue.remove('FLU-220', 2_000)
    expect(queue.list()).toEqual([])
  })

  it('keeps a removal across a restart', () => {
    const queue = createIntakeQueue(path())
    queue.add(stub())
    queue.remove('FLU-220', 2_000)
    expect(createIntakeQueue(path()).list()).toEqual([])
  })

  it('lets a removed ticket be taken in again', () => {
    const queue = createIntakeQueue(path())
    queue.add(stub())
    queue.remove('FLU-220', 2_000)
    queue.add(stub())
    expect(queue.list()).toHaveLength(1)
  })

  it('puts the newest first', () => {
    const queue = createIntakeQueue(path())
    queue.add(stub({ id: 'A', createdAt: 1_000 }))
    queue.add(stub({ id: 'B', createdAt: 5_000 }))
    expect(queue.list().map((entry) => entry.id)).toEqual(['B', 'A'])
  })

  it('drops a row that is not a whole ticket rather than surfacing it', () => {
    writeFileSync(path(), `${JSON.stringify({ nonsense: true })}\n${JSON.stringify(stub())}\n`)
    expect(createIntakeQueue(path()).list()).toHaveLength(1)
  })

  it('is empty before anything is taken in', () => {
    expect(createIntakeQueue(path()).list()).toEqual([])
  })
})
