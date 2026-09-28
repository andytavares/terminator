import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  readRefineryState,
  writeRefineryState,
  finalCheckSendBacks,
  baseFixOrderText,
} from '../../src/line/refinery-state.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { Gate } from '../../src/gates/rules.js'
import { titleFrom } from '../../src/forge/intake-source.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-refinery-state-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('readRefineryState', () => {
  it('defaults to never-merged when nothing was ever written', async () => {
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
      waitingOn: null,
    })
  })

  it('defaults on a malformed file rather than throwing', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), 'not json')
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
      waitingOn: null,
    })
  })

  it('reads back exactly what was written', async () => {
    await writeRefineryState(root, 'WO-1', {
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: ['WO-2'],
      waitingOn: null,
    })
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: ['WO-2'],
      waitingOn: null,
    })
  })

  it('is scoped per order', async () => {
    await writeRefineryState(root, 'WO-1', {
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: [],
    })
    expect(await readRefineryState(root, 'WO-2')).toEqual({
      mergedAt: null,
      restackedFor: [],
      waitingOn: null,
    })
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
      waitingOn: null,
    })
  })

  it('defaults restackedFor when the file has none at all', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), JSON.stringify({ mergedAt: null }))
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
      waitingOn: null,
    })
  })

  it('defaults on a JSON array rather than an object', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), JSON.stringify([1, 2, 3]))
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
      waitingOn: null,
    })
  })

  it('reads back the order it is waiting on', async () => {
    await writeRefineryState(root, 'WO-1', { mergedAt: null, restackedFor: [], waitingOn: 'WO-9' })
    expect((await readRefineryState(root, 'WO-1')).waitingOn).toBe('WO-9')
  })

  it('reads waitingOn as null when it is missing, empty or not a string', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    for (const waitingOn of [undefined, '', 42]) {
      fs.writeFileSync(path.join(dir, 'refinery.json'), JSON.stringify({ waitingOn }))
      expect((await readRefineryState(root, 'WO-1')).waitingOn).toBeNull()
    }
  })
})

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}, option?: string): Gate {
  const raised = raiseGate({
    id: 'g',
    rule: 'verify.repeat-fail',
    orderId: 'WO-1',
    summary: 's',
    why: 'w',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  })
  return option === undefined
    ? raised
    : { ...raised, decision: { option, at: '2026-09-06T11:00:00.000Z', by: 'operator' } as never }
}

describe('finalCheckSendBacks', () => {
  it('counts only decided send-backs of the final check', () => {
    expect(
      finalCheckSendBacks([
        gate({}, 'send_back'),
        gate({}, 'send_back'),
        gate({}, 'hold'),
        gate({}),
        gate({ nodeId: 'build' }, 'send_back'),
        gate({ rule: 'verify.base-fail' }, 'fix_first'),
      ])
    ).toBe(2)
  })
})

describe('baseFixOrderText', () => {
  const failing = gate({
    rule: 'verify.base-fail',
    // Worded so nothing could be recovered from it: the step and command come from the evidence.
    why: 'It also fails without this change.',
    evidence: [
      { kind: 'stdout', exitCode: 1, path: '/logs/change.log', excerpt: 'change output' },
      {
        kind: 'stdout',
        exitCode: 1,
        step: 'Lint',
        command: 'npm run lint',
        path: '/logs/base.log',
        excerpt: 'no-unused-vars in a.ts',
      },
    ],
  })
  const brief = baseFixOrderText(failing, { id: 'WO-1', title: 'Add search' }, 'main')

  it('titles the order for the step and the base branch, and intake reads the same title', () => {
    expect(brief.title).toBe('Fix Lint on main')
    expect(brief.step).toBe('Lint')
    expect(titleFrom(brief.text)).toBe('Fix Lint on main.')
  })

  it('carries the command, that no order caused it, the base log, and where it was found', () => {
    expect(brief.text).toContain('`npm run lint`')
    expect(brief.text).toContain("without any order's change")
    expect(brief.text).toContain('no-unused-vars in a.ts')
    expect(brief.text).not.toContain('change output')
    expect(brief.text).toContain('/logs/base.log')
    expect(brief.text).toContain('Found while verifying Add search (WO-1)')
  })

  it('still says something when the gate carries no command or log', () => {
    const bare = baseFixOrderText(
      gate({ rule: 'verify.base-fail' }),
      { id: 'WO-1', title: 'T' },
      'main'
    )
    expect(bare.title).toBe('Fix the final check on main')
    expect(bare.text).not.toContain('Log:')
  })
})
