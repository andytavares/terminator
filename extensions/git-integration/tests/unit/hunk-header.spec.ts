import { describe, it, expect } from 'vitest'
import { hunkContextText, symbolFromHunkHeader } from '../../src/review/hunk-header'

describe('symbolFromHunkHeader()', () => {
  it('pulls the trailing symbol name out of a hunk header', () => {
    expect(symbolFromHunkHeader('@@ -56,10 +56,12 @@ export function HealthChips')).toBe(
      'HealthChips'
    )
  })

  it('skips export/class/const keywords to find the name', () => {
    expect(symbolFromHunkHeader('@@ -1,2 +1,2 @@ export class RiskEngine')).toBe('RiskEngine')
    expect(symbolFromHunkHeader('@@ -1,2 +1,2 @@ export const computeRiskScore = (')).toBe(
      'computeRiskScore'
    )
  })

  it('returns null when the header has no trailing context', () => {
    expect(symbolFromHunkHeader('@@ -1,2 +1,2 @@')).toBeNull()
  })
})

describe('hunkContextText()', () => {
  it('returns what follows the ranges', () => {
    expect(hunkContextText('@@ -1,2 +1,2 @@ def __init__(self):')).toBe('def __init__(self):')
  })

  it('returns null when nothing follows the ranges', () => {
    expect(hunkContextText('@@ -1,2 +1,2 @@')).toBeNull()
  })
})
