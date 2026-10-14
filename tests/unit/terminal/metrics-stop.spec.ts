import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { queryProcessMetrics } from '../../../src/main/ipc/metrics.ipc'
import { stopRunningCommands } from '../../../src/main/shell/command-runner'
import { makeTempDir } from '../../support/temp-dir'
import { isProcessAlive } from '../../support/processes'

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

describe('queryProcessMetrics while the app quits', () => {
  it('has its ps stopped with whatever it started', async () => {
    const sampling = queryProcessMetrics([process.pid])
    await expect.poll(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8') !== '').toBe(true)
    const grandchild = Number(readFileSync(pidFile, 'utf8'))

    stopRunningCommands()

    expect(await sampling).toEqual([])
    await expect.poll(() => isProcessAlive(grandchild)).toBe(false)
  })
})
