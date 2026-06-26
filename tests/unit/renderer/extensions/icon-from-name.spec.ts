import React from 'react'
import { describe, it, expect } from 'vitest'
import {
  iconFromName,
  CURATED_ICON_NAMES,
} from '../../../../src/renderer/extensions/icon-from-name.js'

describe('iconFromName', () => {
  it('returns a React element for a known icon name', () => {
    const el = iconFromName('puzzle')
    expect(React.isValidElement(el)).toBe(true)
  })

  it('returns a React element for every curated icon name', () => {
    for (const name of CURATED_ICON_NAMES) {
      const el = iconFromName(name)
      expect(React.isValidElement(el)).toBe(true)
    }
  })

  it('falls back to Puzzle for an unknown icon name', () => {
    const known = iconFromName('puzzle')
    const unknown = iconFromName('not-a-real-icon-name')
    expect(React.isValidElement(unknown)).toBe(true)
    // both should be the same Puzzle element type
    expect((known as React.ReactElement).type).toBe((unknown as React.ReactElement).type)
  })

  it('exports a non-empty list of curated icon names', () => {
    expect(CURATED_ICON_NAMES.length).toBeGreaterThan(0)
    expect(CURATED_ICON_NAMES).toContain('puzzle')
    expect(CURATED_ICON_NAMES).toContain('wrench')
    expect(CURATED_ICON_NAMES).toContain('terminal')
  })
})
