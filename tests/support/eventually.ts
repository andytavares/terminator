import { vi } from 'vitest'
import { WAIT_BOUND_MS } from './bounds'

/** Waits for an assertion to hold. The bound only catches a hang (ADR 123); vi.waitFor's own
 * default of one second fails a loaded machine. */
export function eventually<T>(assertion: () => T | Promise<T>): Promise<T> {
  return vi.waitFor(assertion, { timeout: WAIT_BOUND_MS, interval: 20 })
}
