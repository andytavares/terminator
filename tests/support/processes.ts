import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { expect } from 'vitest'

/** Running, and not a zombie waiting for its new parent to reap it. `/bin/ps`, because a spec
 *  may put a stand-in `ps` on PATH. */
export function isProcessAlive(pid: number): boolean {
  try {
    const state = execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
    return !state.startsWith('Z')
  } catch {
    return false
  }
}

/** How long a spec waits for a stand-in process to start or a stopped one to go. A stand-in writes
 * its pid in 10-15 ms (342 ms at worst, busy); vitest's 1 s default has been exceeded under load. */
export const PROCESS_WAIT_MS = 10_000

/** The pid a stand-in process wrote to `pidFile`, once it has. */
export async function recordedPid(pidFile: string): Promise<number> {
  await expect
    .poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', {
      timeout: PROCESS_WAIT_MS,
    })
    .toBe(true)
  return Number(readFileSync(pidFile, 'utf8'))
}

/** Resolves once `pid` is no longer running, or fails after PROCESS_WAIT_MS. */
export async function expectProcessGone(pid: number): Promise<void> {
  await expect.poll(() => isProcessAlive(pid), { timeout: PROCESS_WAIT_MS }).toBe(false)
}
