import { describe, it, expect } from 'vitest'
import { usageState } from '../../../../src/shared/usage/usage-state'
import type { UsageFeatureRow } from '../../../../src/shared/usage/usage-types'

const row = (patch: Partial<UsageFeatureRow>): UsageFeatureRow => ({
  id: 'ext.notes',
  label: 'Notes',
  source: 'ext',
  kind: 'surface',
  firstDeclared: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  declared: true,
  usesInPeriod: 0,
  usesAllTime: 0,
  activeMs: 0,
  failures: 0,
  byVia: {},
  daily: [],
  ...patch,
})

const context = (enabled: boolean | undefined, periodStart: string | null = '2026-10-01') => ({
  periodStart,
  extensionEnabled: () => enabled,
})

describe('usageState', () => {
  it('is gone for an undeclared core feature', () => {
    expect(usageState(row({ declared: false, source: 'core' }), context(undefined))).toBe('gone')
  })

  it('is gone for an undeclared feature of an enabled extension', () => {
    expect(usageState(row({ declared: false }), context(true))).toBe('gone')
  })

  it('is extension-off, not gone, for an undeclared feature of a disabled extension', () => {
    expect(usageState(row({ declared: false }), context(false))).toBe('extension-off')
  })

  it('is extension-off for a declared feature of a disabled extension', () => {
    expect(usageState(row({ usesInPeriod: 3, usesAllTime: 3 }), context(false))).toBe(
      'extension-off'
    )
  })
})

describe('usageState — a live feature', () => {
  it('is new when declared in the period and not used in it', () => {
    const fresh = row({ firstDeclared: '2026-10-05T00:00:00.000Z' })
    expect(usageState(fresh, context(true))).toBe('new')
  })

  it('is used, not new, when declared in the period and already used', () => {
    const fresh = row({
      firstDeclared: '2026-10-05T00:00:00.000Z',
      usesInPeriod: 1,
      usesAllTime: 1,
    })
    expect(usageState(fresh, context(true))).toBe('used')
  })

  it('is never new over all time', () => {
    expect(usageState(row({}), context(true, null))).toBe('never-used')
  })

  it('is never-used when nothing was ever counted', () => {
    expect(usageState(row({}), context(true))).toBe('never-used')
  })

  it('is not-used-in-period when used before the period only', () => {
    expect(usageState(row({ usesAllTime: 4 }), context(true))).toBe('not-used-in-period')
  })

  it('is used when used in the period', () => {
    expect(usageState(row({ usesAllTime: 4, usesInPeriod: 2 }), context(true))).toBe('used')
  })
})
