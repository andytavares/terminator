import { describe, expect, it } from 'vitest'
import {
  descendantsOf,
  parseProcessTable,
  stillRunning,
  type ProcessRow,
} from '../../e2e/leftover-processes'

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
