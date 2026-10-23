import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execShell } from '../../../src/main/shell/shell-executor'
import { stopRunningCommands } from '../../../src/main/shell/command-runner'
import { makeTempDir } from '../../support/temp-dir'
import { expectProcessGone, isProcessAlive, recordedPid } from '../../support/processes'

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

/** The command's own timeout starts when it is spawned and has to elapse in real time, so it is
 * short but well past a start: the stand-in writes its pid in 10-15 ms, 342 ms at worst in 40
 * starts on a busy machine. A timeout under that kills a slow start before it writes the pid. */
const COMMAND_TIMEOUT_MS = 4000

describe('stopRunningCommands', () => {
  it('ends a running command and every process it started', async () => {
    const run = execShell({ command: 'gh', args: [], cwd: scratch, timeoutMs: 60_000 })
    const grandchild = await recordedPid(pidFile)

    await stopRunningCommands()

    expect(isProcessAlive(grandchild)).toBe(false)
    expect((await run).exitCode).not.toBe(0)
  })

  it('kills a command that ignores the request to stop, so quitting never hangs on it', async () => {
    writeFileSync(
      join(scratch, 'gh'),
      `#!/bin/sh\ntrap '' TERM\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`
    )
    const run = execShell({ command: 'gh', args: [], cwd: scratch, timeoutMs: 60_000 })
    const grandchild = await recordedPid(pidFile)

    await stopRunningCommands()

    expect(isProcessAlive(grandchild)).toBe(false)
    expect((await run).exitCode).not.toBe(0)
  })

  it('leaves nothing to stop once a command has finished', async () => {
    writeFileSync(join(scratch, 'gh'), '#!/bin/sh\necho done\n')
    expect((await execShell({ command: 'gh', args: [], cwd: scratch })).stdout).toBe('done\n')
    await expect(stopRunningCommands()).resolves.toBeUndefined()
  })
})

describe('stopRunningCommands and a helper a command detached', () => {
  it('settles once the command has exited, even while a helper it detached holds its output open', async () => {
    const helperPid = join(scratch, 'helper.pid')
    const detach = `perl -e 'use POSIX; setsid(); open(F, ">", "${helperPid}"); print F $$; close F; exec "sleep", "30"'`
    writeFileSync(
      join(scratch, 'gh'),
      `#!/bin/sh\n${detach} &\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`
    )
    const run = execShell({ command: 'gh', args: [], cwd: scratch, timeoutMs: 60_000 })
    const grandchild = await recordedPid(pidFile)
    const helper = await recordedPid(helperPid)
    try {
      await stopRunningCommands()
      expect(isProcessAlive(grandchild)).toBe(false)
    } finally {
      // Out of the group's reach by design; it holds the output open until it goes.
      process.kill(helper, 'SIGKILL')
      await run
    }
  })
})

describe('execShell timeout', () => {
  it('ends what the command started, not only the command', async () => {
    const run = execShell({
      command: 'gh',
      args: [],
      cwd: scratch,
      timeoutMs: COMMAND_TIMEOUT_MS,
    })
    const grandchild = await recordedPid(pidFile)

    expect(await run).toMatchObject({ timedOut: true, exitCode: 124 })
    await expectProcessGone(grandchild)
  })
})
