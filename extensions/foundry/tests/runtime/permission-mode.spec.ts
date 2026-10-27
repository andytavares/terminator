import { describe, it, expect } from 'vitest'
import { modeFor, READ_ONLY_MODE } from '../../src/runtime/permission-mode.js'

const writer = {
  readOnly: false,
  docsOnly: false,
  restrictedWrites: false,
  autonomy: 'standard' as const,
  letModeDecide: true,
}

describe('the permission mode of an agent', () => {
  it.each(['standard', 'lights-out'] as const)('is auto for a free writer at %s', (autonomy) => {
    expect(modeFor({ ...writer, autonomy })).toBe('auto')
  })

  it('is default at escorted, where the answer is "ask me"', () => {
    expect(modeFor({ ...writer, autonomy: 'escorted' })).toBe('default')
  })

  it('is default when the operator does not let auto mode decide', () => {
    expect(modeFor({ ...writer, letModeDecide: false })).toBe('default')
  })

  it('is default for a read-only role, as READ_ONLY_MODE says for the Forge’s turns', () => {
    expect(modeFor({ ...writer, readOnly: true })).toBe(READ_ONLY_MODE)
    expect(READ_ONLY_MODE).toBe('default')
  })

  it('is default for a documentation-only role', () => {
    expect(modeFor({ ...writer, docsOnly: true })).toBe('default')
  })

  it('is default for a role limited to declared write paths', () => {
    expect(modeFor({ ...writer, restrictedWrites: true })).toBe('default')
  })
})
