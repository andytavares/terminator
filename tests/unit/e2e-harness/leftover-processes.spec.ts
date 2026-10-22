import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  appProcessTree,
  descendantsOf,
  expectNoProcessesLeft,
  launchMarker,
  parseProcessTable,
  stillRunning,
  type ProcessRow,
} from '../../e2e/leftover-processes'
import { makeTempDir } from '../../support/temp-dir'

const processRow = (pid: number, ppid: number, command: string): ProcessRow => ({
  pid,
  ppid,
  command,
})

describe('parseProcessTable', () => {
  it('reads pid, parent and the whole command from ps output', () => {
    const output = '    1     0 /sbin/launchd\n  412     1 git fetch --quiet origin\n\n'
    expect(parseProcessTable(output)).toEqual([
      processRow(1, 0, '/sbin/launchd'),
      processRow(412, 1, 'git fetch --quiet origin'),
    ])
  })
})

describe('descendantsOf', () => {
  const table = [
    processRow(1, 0, 'init'),
    processRow(100, 1, 'electron .'),
    processRow(101, 100, 'electron --type=renderer'),
    processRow(102, 100, 'git status'),
    processRow(103, 102, 'git-upload-pack'),
    processRow(200, 1, 'unrelated'),
  ]

  it('finds children at every depth, and nothing outside the tree', () => {
    expect(descendantsOf(table, 100).map((r) => r.pid)).toEqual([101, 102, 103])
  })

  it('finds nothing under a process that has gone', () => {
    expect(descendantsOf(table, 999)).toEqual([])
  })
})

describe('stillRunning', () => {
  it('keeps a process with the same pid and command, reparented or not', () => {
    const started = [
      processRow(102, 100, 'git status'),
      processRow(101, 100, 'electron --type=renderer'),
    ]
    expect(stillRunning(started, [processRow(102, 1, 'git status')])).toEqual([started[0]])
  })

  it('does not count a pid reused by another command', () => {
    expect(
      stillRunning([processRow(102, 100, 'git status')], [processRow(102, 1, 'sshd')])
    ).toEqual([])
  })
})

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
    await vi.waitFor(() => expect(chainMembers(script)).toEqual([]))
    expect(failure).toMatch(/left 1 process\(es\) running, and killed \d+ it started/)
  }, 10_000)
})
