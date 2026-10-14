import { describe, it, expect } from 'vitest'
import React from 'react'
import { isValidElement } from 'react'
import { iconFromName } from '../../../src/renderer/extensions/icon-from-name'

/** The names an extension manifest may give its icon (docs/EXTENSION-DEVELOPMENT.md). */
const CURATED_ICON_NAMES = [
  'puzzle',
  'wrench',
  'terminal',
  'git-branch',
  'git-pull-request',
  'database',
  'code',
  'layers',
  'settings',
  'file',
  'search',
  'box',
  'star',
  'zap',
  'globe',
  'cpu',
  'flask',
  'chart-bar',
  'list',
  'calendar',
  'wifi',
  'check',
  'brain',
]

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
    const types = CURATED_ICON_NAMES.map((name) => iconFromName(name).type)
    expect(new Set(types).size).toBe(CURATED_ICON_NAMES.length)
  })

  it('is case-sensitive — uppercase is treated as unknown', () => {
    const el = iconFromName('Wrench')
    const puzzle = iconFromName('puzzle')
    expect((el as React.ReactElement).type).toBe((puzzle as React.ReactElement).type)
  })
})
