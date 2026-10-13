import { expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// Processes a closed app left behind. launchApp puts a marker unique to each
// launch in the app's environment; every process the app starts inherits it
// unless it is started with an environment of its own, so after closeApp any
// live process still carrying the marker outlived the app. On a CI runner they
// add up across specs until fork fails with EAGAIN at the per-user process
// limit (macOS run 38344908607: `spawnSync git EAGAIN`).

const LAUNCH_MARKER = 'TERMINATOR_E2E_LAUNCH'

// A helper process can still be on its way out when main has exited, and the
// claude stub notices its parent is gone within a second
// (tests/e2e/fixtures/bin/claude), so the check waits this long first.
const LEFT_BEHIND_MS = 3000

/** A fresh marker, and the environment entry that carries it. */
export function launchMarker(): { launchId: string; env: Record<string, string> } {
  const launchId = randomUUID()
  return { launchId, env: { [LAUNCH_MARKER]: launchId } }
}

function ps(args: string[]): string {
  return execFileSync('ps', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/**
 * Every live process with the launch's marker, as `pid command`. `ps` prints a
 * process's environment after its command with `e` on Linux (procps) and with
 * `-E` on macOS: https://man7.org/linux/man-pages/man1/ps.1.html,
 * https://keith.github.io/xcode-man-pages/ps.1.html. The environment is only
 * matched, never shown: it holds the runner's tokens.
 */
function processesOf(launchId: string): string[] {
  const env = process.platform === 'darwin' ? ['-E'] : ['e']
  const mark = `${LAUNCH_MARKER}=${launchId}`
  const pids = ps(['-A', ...env, '-ww', '-o', 'pid=,command='])
    .split('\n')
    .filter((line) => line.includes(mark))
    .map((line) => line.trim().split(/\s+/)[0])
  if (pids.length === 0) return []
  // `ps` exits 1 when every pid has exited since the listing.
  try {
    return ps(['-ww', '-o', 'pid=,command=', '-p', pids.join(',')])
      .split('\n')
      .filter(Boolean)
      .map((line) => line.trim().slice(0, 160))
  } catch {
    return []
  }
}

/**
 * Fails when processes the app started outlive it, after killing them so one
 * leak does not carry into the next spec.
 */
export async function expectNoProcessesLeft(launchId: string): Promise<void> {
  try {
    await expect.poll(() => processesOf(launchId), { timeout: LEFT_BEHIND_MS }).toEqual([])
  } catch {
    const left = processesOf(launchId)
    for (const line of left) killQuietly(Number.parseInt(line, 10))
    if (left.length === 0) return
    throw new Error(`The app left ${left.length} process(es) running:\n${left.join('\n')}`)
  }
}

function killQuietly(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Gone between the listing and the kill.
  }
}
