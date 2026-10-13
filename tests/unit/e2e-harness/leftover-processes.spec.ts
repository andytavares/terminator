import { describe, expect, it } from 'vitest'
import {
  descendantsOf,
  parseProcessTable,
  stillRunning,
  type ProcessRow,
} from '../../e2e/leftover-processes'

const row = (pid: number, ppid: number, command: string): ProcessRow => ({ pid, ppid, command })

describe('parseProcessTable', () => {
  it('reads pid, parent and the whole command from ps output', () => {
    const output = '    1     0 /sbin/launchd\n  412     1 git fetch --quiet origin\n\n'
    expect(parseProcessTable(output)).toEqual([
      row(1, 0, '/sbin/launchd'),
      row(412, 1, 'git fetch --quiet origin'),
    ])
  })
})

describe('descendantsOf', () => {
  const table = [
    row(1, 0, 'init'),
    row(100, 1, 'electron .'),
    row(101, 100, 'electron --type=renderer'),
    row(102, 100, 'git status'),
    row(103, 102, 'git-upload-pack'),
    row(200, 1, 'unrelated'),
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
    const started = [row(102, 100, 'git status'), row(101, 100, 'electron --type=renderer')]
    expect(stillRunning(started, [row(102, 1, 'git status')])).toEqual([started[0]])
  })

  it('does not count a pid reused by another command', () => {
    expect(stillRunning([row(102, 100, 'git status')], [row(102, 1, 'sshd')])).toEqual([])
  })
})
