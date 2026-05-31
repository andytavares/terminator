import { describe, it, expect } from 'vitest'
import { RESERVED_SHORTCUTS } from '../../../../src/main/shared/reserved-shortcuts'

describe('RESERVED_SHORTCUTS', () => {
  it('contains all expected core accelerators', () => {
    const expected = [
      'CmdOrCtrl+1',
      'CmdOrCtrl+2',
      'CmdOrCtrl+3',
      'CmdOrCtrl+4',
      'CmdOrCtrl+5',
      'CmdOrCtrl+6',
      'CmdOrCtrl+7',
      'CmdOrCtrl+8',
      'CmdOrCtrl+9',
      'CmdOrCtrl+=',
      'CmdOrCtrl+-',
      'CmdOrCtrl+Left',
      'CmdOrCtrl+Right',
      'CmdOrCtrl+T',
      'CmdOrCtrl+W',
      'CmdOrCtrl+,',
    ]
    for (const acc of expected) {
      expect(RESERVED_SHORTCUTS.has(acc), `${acc} should be reserved`).toBe(true)
    }
  })

  it('does not contain non-reserved accelerators', () => {
    expect(RESERVED_SHORTCUTS.has('CmdOrCtrl+Shift+K')).toBe(false)
    expect(RESERVED_SHORTCUTS.has('CmdOrCtrl+Z')).toBe(false)
    expect(RESERVED_SHORTCUTS.has('')).toBe(false)
  })

  it('has exactly 16 members', () => {
    expect(RESERVED_SHORTCUTS.size).toBe(16)
  })
})
