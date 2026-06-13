import { describe, it, expect } from 'vitest'
import { DEFAULT_CAPTURE_HOTKEY } from '../src/constants'

describe('constants', () => {
  it('DEFAULT_CAPTURE_HOTKEY is a non-empty string', () => {
    expect(typeof DEFAULT_CAPTURE_HOTKEY).toBe('string')
    expect(DEFAULT_CAPTURE_HOTKEY.length).toBeGreaterThan(0)
  })

  it('DEFAULT_CAPTURE_HOTKEY is CommandOrControl+Shift+O', () => {
    expect(DEFAULT_CAPTURE_HOTKEY).toBe('CommandOrControl+Shift+O')
  })
})
