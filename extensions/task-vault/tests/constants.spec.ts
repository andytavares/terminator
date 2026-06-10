import { describe, it, expect } from 'vitest'
import { DEFAULT_CAPTURE_HOTKEY, DEPRECATED_CAPTURE_HOTKEYS } from '../src/constants'

describe('constants', () => {
  it('DEFAULT_CAPTURE_HOTKEY is a non-empty string', () => {
    expect(typeof DEFAULT_CAPTURE_HOTKEY).toBe('string')
    expect(DEFAULT_CAPTURE_HOTKEY.length).toBeGreaterThan(0)
  })

  it('DEFAULT_CAPTURE_HOTKEY is not in the deprecated list', () => {
    expect(DEPRECATED_CAPTURE_HOTKEYS).not.toContain(DEFAULT_CAPTURE_HOTKEY)
  })

  it('DEPRECATED_CAPTURE_HOTKEYS contains the old Shift+T default', () => {
    expect(DEPRECATED_CAPTURE_HOTKEYS).toContain('CommandOrControl+Shift+T')
  })
})
