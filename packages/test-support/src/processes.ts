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

/** The pid a stand-in process wrote to `pidFile`, once it has. */
export async function recordedPid(pidFile: string): Promise<number> {
  await expect
    .poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')
    .toBe(true)
  return Number(readFileSync(pidFile, 'utf8'))
}

/** Resolves once `pid` is no longer running. */
export async function expectProcessGone(pid: number): Promise<void> {
  await expect.poll(() => isProcessAlive(pid)).toBe(false)
}
