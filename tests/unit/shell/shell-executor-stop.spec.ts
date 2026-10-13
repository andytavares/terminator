import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execShell, stopRunningCommands } from '../../../src/main/shell/shell-executor'
import { makeTempDir } from '../../support/temp-dir'

// A git or gh command still running when the app quits, and whatever it started,
// must end with the app. On macOS /usr/bin/git is an xcrun shim that can start
// xcodebuild, which outlived the app in run 38382115775. The stand-in gh here
// starts a `sleep` of its own and writes the sleep's pid down.

const originalPath = process.env.PATH
let scratch: string
let pidFile: string

beforeEach(() => {
  scratch = makeTempDir('shell-stop-')
  pidFile = join(scratch, 'grandchild.pid')
  writeFileSync(join(scratch, 'gh'), `#!/bin/sh\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`)
  chmodSync(join(scratch, 'gh'), 0o755)
  process.env.PATH = `${scratch}:${originalPath}`
})

afterEach(() => {
  process.env.PATH = originalPath
})

/** Running, and not a zombie waiting for its new parent to reap it. */
function isAlive(pid: number): boolean {
  try {
    return !execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).startsWith(
      'Z'
    )
  } catch {
    return false
  }
}

async function grandchildPid(): Promise<number> {
  await expect
    .poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '')
    .toBe(true)
  return Number(readFileSync(pidFile, 'utf8'))
}

describe('stopRunningCommands', () => {
  it('ends a running command and every process it started', async () => {
    const run = execShell({ command: 'gh', args: [], cwd: scratch, timeoutMs: 60_000 })
    const grandchild = await grandchildPid()

    stopRunningCommands()

    expect((await run).exitCode).not.toBe(0)
    await expect.poll(() => isAlive(grandchild)).toBe(false)
  })

  it('leaves nothing to stop once a command has finished', async () => {
    writeFileSync(join(scratch, 'gh'), '#!/bin/sh\necho done\n')
    expect((await execShell({ command: 'gh', args: [], cwd: scratch })).stdout).toBe('done\n')
    expect(() => stopRunningCommands()).not.toThrow()
  })
})

describe('execShell timeout', () => {
  it('ends what the command started, not only the command', async () => {
    const run = execShell({ command: 'gh', args: [], cwd: scratch, timeoutMs: 1000 })
    const grandchild = await grandchildPid()

    expect(await run).toMatchObject({ timedOut: true, exitCode: 124 })
    await expect.poll(() => isAlive(grandchild)).toBe(false)
  })
})
