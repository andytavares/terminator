import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

// The core's own git commands end with the app: one in flight at quit, with the xcodebuild
// its xcrun shim started, outlived it (macOS run 38382115775). The stand-in git records a sleep's pid.

const scratch = makeTempDir('git-service-stop-')
const pidFile = join(scratch, 'grandchild.pid')
writeFileSync(join(scratch, 'git'), `#!/bin/sh\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`)
chmodSync(join(scratch, 'git'), 0o755)

const originalPath = process.env.PATH
afterAll(() => {
  process.env.PATH = originalPath
})

/** Running, and not a zombie waiting for its new parent to reap it. */
function isAlive(pid: number): boolean {
  try {
    const state = execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' })
    return !state.startsWith('Z')
  } catch {
    return false
  }
}

describe('git-service on quit', () => {
  it('has its running git commands, and what they started, stopped with the rest', async () => {
    // git-service takes its environment, PATH included, when it is loaded.
    process.env.PATH = `${scratch}:${originalPath}`
    const { fetchRemotes } = await import('../../../src/main/git/git-service')
    const { stopRunningCommands } = await import('../../../src/main/shell/command-runner')

    const fetch = fetchRemotes(scratch).then(
      () => 'resolved',
      () => 'rejected'
    )
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '').toBe(true)
    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    stopRunningCommands()

    expect(await fetch).toBe('rejected')
    await expect.poll(() => isAlive(grandchild)).toBe(false)
  })
})
