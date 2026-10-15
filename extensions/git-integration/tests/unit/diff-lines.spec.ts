import { describe, it, expect } from 'vitest'
import { numColWidthFor } from '../../src/components/pr-review/diff-pane/lines'

describe('numColWidthFor', () => {
  it('is 30px for two-digit numbers and grows 7px per digit', () => {
    expect(numColWidthFor(99)).toBe(30)
    expect(numColWidthFor(100)).toBe(37)
  })
})
