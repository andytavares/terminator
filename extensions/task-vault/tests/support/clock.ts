import { vi } from 'vitest'

/** Puts the machine in `timeZone` at `instant`. Only Date is faked, so timers and the database run. */
export function setLocalClock(timeZone: string, instant: string): void {
  vi.stubEnv('TZ', timeZone)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(instant))
}

/** Undoes setLocalClock. */
export function restoreLocalClock(): void {
  vi.useRealTimers()
  vi.unstubAllEnvs()
}
