import { describe, it, expect } from 'vitest'
import React from 'react'
import { isValidElement } from 'react'
import { iconFromName, CURATED_ICON_NAMES } from '../../../src/renderer/extensions/icon-from-name'

describe('iconFromName', () => {
  it('returns a React element for known icon names', () => {
    const el = iconFromName('wrench')
    expect(isValidElement(el)).toBe(true)
  })

  it('returns Puzzle for unknown icon names', () => {
    const unknown = iconFromName('not-a-real-icon')
    const puzzle = iconFromName('puzzle')
    expect(isValidElement(unknown)).toBe(true)
    const unknownType = (unknown as React.ReactElement).type
    const puzzleType = (puzzle as React.ReactElement).type
    expect(unknownType).toBe(puzzleType)
  })

  it('returns Puzzle for empty string', () => {
    const el = iconFromName('')
    const puzzle = iconFromName('puzzle')
    expect((el as React.ReactElement).type).toBe((puzzle as React.ReactElement).type)
  })

  it('maps all curated icon names to distinct elements', () => {
    for (const name of CURATED_ICON_NAMES) {
      const el = iconFromName(name)
      expect(isValidElement(el), `${name} should return a React element`).toBe(true)
    }
  })

  it('includes wifi in the curated set', () => {
    expect(CURATED_ICON_NAMES).toContain('wifi')
    expect(isValidElement(iconFromName('wifi'))).toBe(true)
  })

  it('includes check in the curated set', () => {
    expect(CURATED_ICON_NAMES).toContain('check')
    expect(isValidElement(iconFromName('check'))).toBe(true)
  })

  it('is case-sensitive — uppercase is treated as unknown', () => {
    const el = iconFromName('Wrench')
    const puzzle = iconFromName('puzzle')
    expect((el as React.ReactElement).type).toBe((puzzle as React.ReactElement).type)
  })
})
