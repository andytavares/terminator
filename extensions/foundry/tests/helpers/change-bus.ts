import { vi } from 'vitest'
import type { FoundryChange } from '../../src/state/foundry-index.js'

/**
 * A stand-in for the bridge's `on`, so a test can say "Foundry just told the
 * window this changed" and see what a view reads in answer.
 */
export function createChangeBus(): {
  on: ReturnType<typeof vi.fn>
  emit: (change: FoundryChange) => void
  /** Any other bridge event, such as `workspace:changed`. */
  emitOn: (channel: string, data?: unknown) => void
} {
  const handlers = new Map<string, Set<(data: unknown) => void>>()
  const emitOn = (channel: string, data?: unknown): void =>
    handlers.get(channel)?.forEach((handler) => handler(data))
  return {
    on: vi.fn((channel: string, handler: (data: unknown) => void) => {
      const forChannel = handlers.get(channel) ?? new Set()
      handlers.set(channel, forChannel.add(handler))
      return () => forChannel.delete(handler)
    }),
    emit: (change) => emitOn('foundry:changed', change),
    emitOn,
  }
}
