import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { readRefineryState, writeRefineryState } from '../../src/line/refinery-state.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-refinery-state-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('readRefineryState', () => {
  it('defaults to never-merged when nothing was ever written', async () => {
    expect(await readRefineryState(root, 'WO-1')).toEqual({ mergedAt: null, restackedFor: [] })
  })

  it('defaults on a malformed file rather than throwing', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), 'not json')
    expect(await readRefineryState(root, 'WO-1')).toEqual({ mergedAt: null, restackedFor: [] })
  })

  it('reads back exactly what was written', async () => {
    await writeRefineryState(root, 'WO-1', {
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: ['WO-2'],
    })
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: ['WO-2'],
    })
  })

  it('is scoped per order', async () => {
    await writeRefineryState(root, 'WO-1', {
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: [],
    })
    expect(await readRefineryState(root, 'WO-2')).toEqual({ mergedAt: null, restackedFor: [] })
  })

  it('defaults mergedAt when it is not a string, and drops non-string restackedFor entries', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'refinery.json'),
      JSON.stringify({ mergedAt: 12345, restackedFor: ['WO-2', 7, null] })
    )
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: ['WO-2'],
    })
  })

  it('defaults restackedFor when the file has none at all', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), JSON.stringify({ mergedAt: null }))
    expect(await readRefineryState(root, 'WO-1')).toEqual({ mergedAt: null, restackedFor: [] })
  })

  it('defaults on a JSON array rather than an object', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), JSON.stringify([1, 2, 3]))
    expect(await readRefineryState(root, 'WO-1')).toEqual({ mergedAt: null, restackedFor: [] })
  })
})
