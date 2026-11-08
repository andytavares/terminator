import { describe, it, expect } from 'vitest'
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
  it.each([
    ['an unknown name', 'not-a-real-icon'],
    ['an empty name', ''],
    ['an uppercase name, since names are case-sensitive', 'Wrench'],
  ])('falls back to Puzzle for %s', (_case, name) => {
    expect(iconFromName(name).type).toBe(iconFromName('puzzle').type)
  })

  it('maps all curated icon names to distinct elements', () => {
    const types = CURATED_ICON_NAMES.map((name) => iconFromName(name).type)
    expect(new Set(types).size).toBe(CURATED_ICON_NAMES.length)
  })
})
