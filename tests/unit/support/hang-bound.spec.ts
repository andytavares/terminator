import { describe, it, expect, vi, afterEach } from 'vitest'
import { orOnHang } from '../../support/hang-bound'

afterEach(() => {
  vi.useRealTimers()
})

describe('a bound that catches a hang', () => {
  it('settles as the work does when it answers first, and leaves no timer behind', async () => {
    vi.useFakeTimers()
    await expect(orOnHang(Promise.resolve('answered'), 1000, () => 'hung')).resolves.toBe(
      'answered'
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles as onHang does once the bound has passed with no answer', async () => {
    vi.useFakeTimers()
    const bounded = orOnHang(new Promise<string>(() => undefined), 1000, () => 'hung')
    await vi.advanceTimersByTimeAsync(1000)
    await expect(bounded).resolves.toBe('hung')
  })

  it('fails as onHang does when it rejects', async () => {
    vi.useFakeTimers()
    const bounded = orOnHang(new Promise<string>(() => undefined), 1000, () =>
      Promise.reject(new Error('no answer within 1s'))
    )
    const outcome = bounded.then(
      () => 'answered',
      (error: Error) => error.message
    )
    await vi.advanceTimersByTimeAsync(1000)
    expect(await outcome).toBe('no answer within 1s')
  })
})
