import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ipcMain } from 'electron'
import { makeTempDir } from '../../../../test-support/src/temp-dir'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
}))

import { registerShellHandlers } from '../../../src/ipc/shell.ipc'

// Real processes: a stand-in `git` on PATH that prints its arguments and where it ran.
const originalPath = process.env.PATH
let scratch: string
let repo: string
let execHandler: (event: unknown, payload: unknown) => Promise<unknown>

function registeredHandler(
  channel: string
): (event: unknown, payload: unknown) => Promise<unknown> {
  const call = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === channel)
  if (!call) throw new Error(`no handler registered for ${channel}`)
  return call[1] as (event: unknown, payload: unknown) => Promise<unknown>
}

function useFakeGitOnPath(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    scratch = makeTempDir('shell-ipc-')
    const git = join(scratch, 'git')
    writeFileSync(git, '#!/bin/sh\necho "$@"\npwd\n')
    chmodSync(git, 0o755)
    process.env.PATH = `${scratch}:${originalPath}`
    repo = join(scratch, 'repo')
    mkdirSync(repo)

    registerShellHandlers()
    execHandler = registeredHandler('shell:exec')
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(scratch, { recursive: true, force: true })
  })
}

describe('shell:exec IPC execHandler', () => {
  useFakeGitOnPath()

  it('runs the command in the directory it is given and returns what it printed', async () => {
    const result = await execHandler({}, { command: 'git', args: ['status', '-s'], cwd: repo })
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: `status -s\n${repo}\n`,
      stderr: '',
      timedOut: false,
    })
  })

  it('runs inside the workspace root it is given', async () => {
    const result = await execHandler(
      {},
      { command: 'git', args: ['status'], cwd: repo, workspaceRoot: scratch }
    )
    expect(result).toMatchObject({ exitCode: 0, stdout: `status\n${repo}\n` })
  })
})

describe('shell:exec IPC execHandler — refusals', () => {
  useFakeGitOnPath()

  it('returns CWD_OUT_OF_SCOPE when cwd escapes the workspace, and runs nothing', async () => {
    const result = await execHandler(
      {},
      { command: 'git', args: ['status'], cwd: scratch, workspaceRoot: repo }
    )
    expect(result).toEqual({ error: 'CWD_OUT_OF_SCOPE' })
  })

  it('reports a command that could not start, with the reason', async () => {
    const result = (await execHandler(
      {},
      { command: 'git', args: ['log'], cwd: join(scratch, 'missing') }
    )) as { exitCode: number; stderr: string }
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('ENOENT')
  })
})
