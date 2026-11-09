import { describe, it, expect } from 'vitest'
import { keepTail } from '../../../../src/agents/acp/agent-connection'

describe('keepTail', () => {
  it('keeps the whole text when it fits', () => {
    expect(keepTail('abc', 5)).toBe('abc')
  })

  it('keeps only the last characters when it does not', () => {
    expect(keepTail('abcdef', 4)).toBe('cdef')
  })
})
