import { describe, it, expect } from 'vitest'
import {
  checkRows,
  interfaceTouched,
  sourceInWords,
  waitingOnYou,
} from '../../src/forge/checks-view.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { bareProfile, glyphProfile } from '../helpers/profile.js'

// The Checks step says, for each command, where it came from in words and what
// running it on the base branch did. A command nobody has run is "Not yet run",
// never a pass.

const rowsOf = (profile = glyphProfile(), touched = false) => checkRows(profile, 'main', touched)

describe('sourceInWords', () => {
  it('names where a command came from, never the raw source', () => {
    expect(sourceInWords({ source: 'operator' })).toBe('You set this')
    expect(sourceInWords({ source: 'scout', evidence: 'README.md' })).toBe(
      'Read by the scout from README.md'
    )
    expect(sourceInWords({ source: 'hint', evidence: 'Makefile' })).toBe('Suggested by Makefile')
    expect(sourceInWords({ source: 'repository' })).toBe("Set in the repository's own profile")
  })
})

describe('checkRows', () => {
  it('lists prepare, the six checks, additional checks and pictures in that order', () => {
    expect(rowsOf().map((row) => row.label)).toEqual([
      'Prepare the checkout',
      'Format',
      'Lint',
      'Tests',
      'Coverage',
      'End-to-end',
      'Build',
      'Type check',
      'Pictures',
    ])
  })

  it('words the proof of each command from its exit code on the base branch', () => {
    const byLabel = Object.fromEntries(rowsOf().map((row) => [row.label, row]))
    expect(byLabel.Format.proofWord).toBe('Exit 1 on main')
    expect(byLabel.Format.state).toBe('failing')
    expect(byLabel.Tests.proofWord).toBe('Exit 0 on main')
    expect(byLabel.Lint.proofWord).toBe('None')
    expect(byLabel.Lint.state).toBe('missing')
  })
})

describe('checkRows proof', () => {
  it('reads a command with no recorded exit code as not yet run', () => {
    const profile = glyphProfile({ proof: null })
    expect(rowsOf(profile).find((row) => row.label === 'Tests')?.proofWord).toBe('Not yet run')
  })

  it('says pictures are not needed unless the order changes the interface', () => {
    const pictures = (touched: boolean) =>
      rowsOf(glyphProfile(), touched).find((row) => row.label === 'Pictures')
    expect(pictures(false)?.proofWord).toBe('Not needed')
    expect(pictures(true)?.proofWord).toBe('None')
  })
})

describe('waitingOnYou', () => {
  it('counts a command that failed on main', () => {
    expect(waitingOnYou(rowsOf())).toBe(1)
  })

  it('does not count a failing command the operator owns', () => {
    const profile = glyphProfile()
    profile.checks.format = { command: './glyph fmt --check', source: 'operator' }
    expect(waitingOnYou(rowsOf(profile))).toBe(0)
  })

  it('counts one when no check has a command', () => {
    expect(waitingOnYou(rowsOf(bareProfile()))).toBe(1)
  })
})

const withUnit = (unit: Record<string, unknown>): WorkOrder => {
  const base = draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  const units = [
    {
      id: 'U-1',
      title: 'a',
      role: 'builder',
      lane: 1,
      dependsOn: [],
      satisfies: [],
      touches: [],
      verify: [],
      ...unit,
    },
  ] as WorkOrder['plan']['units']
  return { ...base, plan: { ...base.plan, units } }
}

describe('interfaceTouched', () => {
  it('is true when a unit says it touches the interface', () => {
    expect(interfaceTouched(withUnit({ touchesInterface: true }), [])).toBe(true)
  })

  it('is true when a unit touches a path the profile names as interface', () => {
    expect(interfaceTouched(withUnit({ touches: ['src/ui/panel.tsx'] }), ['src/ui/**'])).toBe(true)
  })

  it('is false when neither holds', () => {
    expect(interfaceTouched(withUnit({ touches: ['src/parser.ts'] }), ['src/ui/**'])).toBe(false)
  })
})
