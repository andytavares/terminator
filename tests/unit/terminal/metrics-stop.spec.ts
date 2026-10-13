import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { queryProcessMetrics } from '../../../src/main/ipc/metrics.ipc'
import { stopRunningCommands } from '../../../src/main/shell/command-runner'
import { makeTempDir } from '../../support/temp-dir'

// The metrics view samples its terminals with `ps` every two seconds, so one
// can be running as the app quits; it ends with the app, with anything it
// started. The stand-in ps here starts a `sleep` and writes the sleep's pid down.

const originalPath = process.env.PATH
let pidFile: string

beforeEach(() => {
  const scratch = makeTempDir('metrics-stop-')
  pidFile = join(scratch, 'grandchild.pid')
  writeFileSync(join(scratch, 'ps'), `#!/bin/sh\nsleep 30 &\necho $! > "${pidFile}"\nwait\n`)
  chmodSync(join(scratch, 'ps'), 0o755)
  process.env.PATH = `${scratch}:${originalPath}`
})

afterEach(() => {
  process.env.PATH = originalPath
})

/** Running, and not a zombie waiting for its new parent to reap it. */
function isAlive(pid: number): boolean {
  try {
    const state = execFileSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], {
      encoding: 'utf8',
    })
    return !state.startsWith('Z')
  } catch {
    return false
  }
}

describe('queryProcessMetrics while the app quits', () => {
  it('has its ps stopped with whatever it started', async () => {
    const sampling = queryProcessMetrics([process.pid])
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '').toBe(true)
    const grandchild = Number(readFileSync(pidFile, 'utf8'))

    stopRunningCommands()

    expect(await sampling).toEqual([])
    await expect.poll(() => isAlive(grandchild)).toBe(false)
  })
})
