import { describe, it, expect } from 'vitest'
import { WebglContextBudget } from '../../../../src/renderer/terminal/webgl-contexts'

describe('WebglContextBudget', () => {
  it('grants contexts up to its limit and refuses the next one', () => {
    const budget = new WebglContextBudget(2)
    expect(budget.acquire('a')).toBe(true)
    expect(budget.acquire('b')).toBe(true)
    expect(budget.acquire('c')).toBe(false)
  })

  it('grants a freed context to the next requester', () => {
    const budget = new WebglContextBudget(1)
    budget.acquire('a')
    budget.release('a')
    expect(budget.acquire('b')).toBe(true)
  })

  it('does not count an owner twice when it asks again', () => {
    const budget = new WebglContextBudget(1)
    expect(budget.acquire('a')).toBe(true)
    expect(budget.acquire('a')).toBe(true)
    budget.release('a')
    expect(budget.acquire('b')).toBe(true)
  })

  it('ignores a release from an owner that holds nothing', () => {
    const budget = new WebglContextBudget(1)
    budget.acquire('a')
    budget.release('stranger')
    expect(budget.acquire('b')).toBe(false)
  })
})
