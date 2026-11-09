import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  appProcessTree,
  expectNoProcessesLeft,
  launchMarker,
  type ProcessRow,
} from '../../e2e/leftover-processes'
import { makeTempDir } from '../../../packages/test-support/src/temp-dir'
import { eventually } from '../../../packages/test-support/src/eventually'

// Each link starts the next and waits on it, a new one every 50 ms, like the gh
// stub that ran itself (macOS run 38380127678): the links that appear after the
// app's tree was taken have a live parent, and are in no listing of their own.
const CHAIN = '[ "$1" -gt 0 ] || exec sleep 30\nsleep 0.05\nsh "$0" $(($1 - 1))\n'

/** Every running link: an orphaned one is still under pid 1 (init, or launchd on macOS). */
function chainMembers(script: string): ProcessRow[] {
  return appProcessTree(1).filter((row) => row.command.includes(script))
}

describe('expectNoProcessesLeft', () => {
  const script = join(makeTempDir('leftover-chain-'), 'chain.sh')
  afterAll(() => {
    for (const row of chainMembers(script)) process.kill(row.pid, 'SIGKILL')
  })

  it('kills what a leftover went on to start, not only the leftover', async () => {
    writeFileSync(script, CHAIN)
    const root = spawn('sh', [script, '400'], { stdio: 'ignore' })
    const started = [{ pid: root.pid ?? -1, ppid: process.pid, command: `sh ${script} 400` }]
    const failure = await expectNoProcessesLeft(launchMarker().launchId, started).catch(String)
    await eventually(() => expect(chainMembers(script)).toEqual([]))
    expect(failure).toMatch(/left 1 process\(es\) running, and killed \d+ it started/)
  })
})
