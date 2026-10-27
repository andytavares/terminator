import { describe, it, expect } from 'vitest'
import { processesAtOnce } from '../../../scripts/each-limited.mjs'

const GB = 2 ** 30

describe('how many processes run at once', () => {
  it('runs a core each, bytesEach each, and no more than most', () => {
    const lint = { bytesEach: 4 * GB, most: 3 }
    expect(processesAtOnce({ cores: 4, memory: 16 * GB, ...lint })).toBe(3)
    expect(processesAtOnce({ cores: 2, memory: 16 * GB, ...lint })).toBe(2)
    expect(processesAtOnce({ cores: 8, memory: 7 * GB, ...lint })).toBe(1)
    expect(processesAtOnce({ cores: 8, memory: 8 * GB, ...lint })).toBe(2)
  })

  it('runs one process when the machine is smaller than one process needs', () => {
    expect(processesAtOnce({ cores: 1, memory: 1 * GB, bytesEach: 4 * GB, most: 3 })).toBe(1)
    expect(processesAtOnce({ cores: 4, memory: 4 * GB, bytesEach: 4 * GB, most: 3 })).toBe(1)
  })
})
