import { describe, it, expect, vi } from 'vitest'
import { withRetry } from '../../src/utils/retry.js'

class HttpError extends Error {
  constructor(
    public status: number,
    message?: string
  ) {
    super(message ?? `HTTP ${status}`)
  }
}

describe('withRetry()', () => {
  it('returns result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await withRetry(fn)
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retries on HTTP 429 and succeeds on second attempt', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new HttpError(429)).mockResolvedValueOnce('success')

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retries up to maxAttempts on repeated 429s then throws', async () => {
    const err = new HttpError(429)
    const fn = vi.fn().mockRejectedValue(err)

    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('fast-fails immediately on non-429 errors without retrying', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(401, 'Unauthorized'))
    await expect(withRetry(fn)).rejects.toThrow('Unauthorized')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fast-fails on generic errors (not HttpError)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('network failure'))
    await expect(withRetry(fn)).rejects.toThrow('network failure')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses exponential delay: makes correct number of attempts', async () => {
    const err = new HttpError(429)
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('handles fetch-style responses with status 429', async () => {
    const mockResponse = { status: 200, ok: true, data: 'result' }
    const fn = vi.fn().mockRejectedValueOnce(new HttpError(429)).mockResolvedValueOnce(mockResponse)

    const result = await withRetry(fn, { maxAttempts: 3, baseDelayMs: 1 })
    expect(result).toBe(mockResponse)
  })

  it('respects custom maxAttempts of 1 (no retry)', async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError(429))
    await expect(withRetry(fn, { maxAttempts: 1, baseDelayMs: 1 })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
