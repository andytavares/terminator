import { act } from '@testing-library/react'
import { vi } from 'vitest'

/** Moves fake time past a pushed read's debounce and lets React apply what it read. */
export async function settlePushedReads(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
}
