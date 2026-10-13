import { execFileSync } from 'node:child_process'

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
