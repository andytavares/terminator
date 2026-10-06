import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { writeCiState, readCiState, ciLabel } from '../../src/line/ci-state.js'
import type { CiState } from '../../src/line/ci-state.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-ci-state-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function state(over: Partial<CiState> = {}): CiState {
  return {
    round: 0,
    max: 2,
    status: 'watching',
    pulls: [{ url: 'https://github.com/o/r/pull/1', checks: [] }],
    reason: '',
    at: '2026-09-26T10:00:00.000Z',
    ...over,
  }
}

describe('ci-state', () => {
  it('reads back exactly what it wrote', async () => {
    await writeCiState(root, 'WO-1', state())
    const loaded = await readCiState(root, 'WO-1')
    expect(loaded).toEqual(state())
  })

  it('returns null for a missing file', async () => {
    expect(await readCiState(root, 'WO-missing')).toBeNull()
  })
})

describe('ciLabel', () => {
  it('says the first run is the first run, with the fixes still available', () => {
    expect(ciLabel(state({ round: 0, max: 2, status: 'watching' }))).toBe(
      'First run · up to 2 fixes'
    )
  })

  it('says which fix is being watched', () => {
    expect(ciLabel(state({ round: 1, max: 2, status: 'watching' }))).toBe('Fix 1 of 2')
  })

  it('says passed', () => {
    expect(ciLabel(state({ status: 'green' }))).toBe('Passed')
  })

  it('says how many fixes were spent when it failed', () => {
    expect(ciLabel(state({ round: 2, max: 2, status: 'red' }))).toBe('Failed after 2 fixes')
  })

  it('says why it was not measured', () => {
    expect(ciLabel(state({ status: 'not_measured', reason: 'no checks reported' }))).toBe(
      'Not measured: no checks reported'
    )
  })

  it('says a fix is under way', () => {
    expect(ciLabel(state({ round: 1, max: 2, status: 'reworking' }))).toBe('Fixing: round 1 of 2')
  })
})
