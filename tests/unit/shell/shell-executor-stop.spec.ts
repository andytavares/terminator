import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execShell } from '../../../src/main/shell/shell-executor'
import { stopRunningCommands } from '../../../src/main/shell/command-runner'
import { makeTempDir } from '../../support/temp-dir'
import { isProcessAlive } from '../../support/processes'

// A git or gh command running at quit ends with the app, with what it started (macOS's git
// shim started an xcodebuild that outlived it, run 38382115775). The stand-in gh records a sleep's pid.

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

/** How long the stand-in gh may take to start its sleep: it writes its pid in 10-15 ms, 342 ms at
 * worst in 40 starts on a loaded machine. The command's own timeout starts when it is spawned, so
 * it must outlast this: otherwise a slow start is killed before it writes the pid. */
const STAND_IN_STARTS_WITHIN_MS = 4000

/** The command's timeout, the wait for its child to start, and time to stop what it started. */
const TIMEOUT_TEST_LIMIT_MS = STAND_IN_STARTS_WITHIN_MS + 1000 + 5000

async function grandchildPid(): Promise<number> {
  await expect
    .poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', {
      timeout: STAND_IN_STARTS_WITHIN_MS,
    })
    .toBe(true)
  return Number(readFileSync(pidFile, 'utf8'))
}

describe('stopRunningCommands', () => {
  it('ends a running command and every process it started', async () => {
    const run = execShell({ command: 'gh', args: [], cwd: scratch, timeoutMs: 60_000 })
    const grandchild = await grandchildPid()

    stopRunningCommands()

    expect((await run).exitCode).not.toBe(0)
    await expect.poll(() => isProcessAlive(grandchild)).toBe(false)
  })

  it('leaves nothing to stop once a command has finished', async () => {
    writeFileSync(join(scratch, 'gh'), '#!/bin/sh\necho done\n')
    expect((await execShell({ command: 'gh', args: [], cwd: scratch })).stdout).toBe('done\n')
    expect(() => stopRunningCommands()).not.toThrow()
  })
})

describe('execShell timeout', () => {
  it(
    'ends what the command started, not only the command',
    async () => {
      const run = execShell({
        command: 'gh',
        args: [],
        cwd: scratch,
        timeoutMs: STAND_IN_STARTS_WITHIN_MS + 1000,
      })
      const grandchild = await grandchildPid()

      expect(await run).toMatchObject({ timedOut: true, exitCode: 124 })
      await expect.poll(() => isProcessAlive(grandchild)).toBe(false)
    },
    TIMEOUT_TEST_LIMIT_MS
  )
})
