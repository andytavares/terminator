import { describe, it, expect } from 'vitest'
import { budgetFromSetting } from '../../src/order/budget-setting.js'

// The settings surface has a number field and nothing else, so no limit is
// written as 0 there and read as null here.

describe('budgetFromSetting', () => {
  it('takes a configured limit', () => {
    expect(budgetFromSetting(12, 25)).toBe(12)
  })

  it('reads 0 as no limit', () => {
    expect(budgetFromSetting(0, 25)).toBeNull()
  })

  it('falls back when nothing usable is configured', () => {
    for (const value of [undefined, null, 'ten', -1, Number.NaN, Infinity]) {
      expect(budgetFromSetting(value, 25), String(value)).toBe(25)
    }
  })

  it('rounds a fractional limit down, since the order only holds whole numbers', () => {
    expect(budgetFromSetting(12.7, 25)).toBe(12)
  })

  it('reads a fraction below one as no limit, rather than a limit of zero', () => {
    expect(budgetFromSetting(0.4, 25)).toBeNull()
  })
})
