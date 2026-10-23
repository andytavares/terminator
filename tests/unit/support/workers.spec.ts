import { describe, it, expect } from 'vitest'
import { unitWorkers } from '../../support/workers'

const GiB = 2 ** 30

// Run 39803422908: three workers with coverage starved the 7 GB macOS runner, which lost
// contact; the same rule on a laptop gives it all its cores.
describe('how many unit workers a machine runs', () => {
  it('is bounded by memory on the 3-core, 7 GB CI runner', () => {
    expect(unitWorkers({ cores: 3, memory: 7 * GiB })).toBe(2)
  })

  it('is bounded by cores on a machine with memory to spare', () => {
    expect(unitWorkers({ cores: 16, memory: 128 * GiB })).toBe(16)
  })

  it('is at least one', () => {
    expect(unitWorkers({ cores: 1, memory: 1 * GiB })).toBe(1)
  })
})
