import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ipcMain } from 'electron'

const { mockOpenPath, mockOpenExternal } = vi.hoisted(() => ({
  mockOpenPath: vi.fn(),
  mockOpenExternal: vi.fn(),
}))

// Opening a path or a URL hands it to the operating system; that is the boundary.
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  shell: {
    openPath: mockOpenPath,
    openExternal: mockOpenExternal,
  },
}))

import { registerShellHandlers } from '../../../src/main/ipc/shell.ipc'

// Real processes: a stand-in `git` on PATH that prints its arguments and where it ran.
describe('shell:exec IPC handler', () => {
  const originalPath = process.env.PATH
  let scratch: string
  let repo: string
  let handler: (event: unknown, payload: unknown) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    scratch = mkdtempSync(join(tmpdir(), 'shell-ipc-'))
    const git = join(scratch, 'git')
    writeFileSync(git, '#!/bin/sh\necho "$@"\npwd\n')
    chmodSync(git, 0o755)
    process.env.PATH = `${scratch}:${originalPath}`
    repo = join(scratch, 'repo')
    mkdirSync(repo)

    registerShellHandlers()
    const calls = vi.mocked(ipcMain.handle).mock.calls
    handler = calls.find(([channel]) => channel === 'shell:exec')![1] as typeof handler
  })

  afterEach(() => {
    process.env.PATH = originalPath
    rmSync(scratch, { recursive: true, force: true })
  })

  it('runs the command in the directory it is given and returns what it printed', async () => {
    const result = await handler({}, { command: 'git', args: ['status', '-s'], cwd: repo })
    expect(result).toMatchObject({
      exitCode: 0,
      stdout: `status -s\n${repo}\n`,
      stderr: '',
      timedOut: false,
    })
  })

  it('runs inside the workspace root it is given', async () => {
    const result = await handler(
      {},
      { command: 'git', args: ['status'], cwd: repo, workspaceRoot: scratch }
    )
    expect(result).toMatchObject({ exitCode: 0 })
  })

  it('returns CWD_OUT_OF_SCOPE when cwd escapes the workspace, and runs nothing', async () => {
    const result = await handler(
      {},
      { command: 'git', args: ['status'], cwd: scratch, workspaceRoot: repo }
    )
    expect(result).toEqual({ error: 'CWD_OUT_OF_SCOPE' })
  })

  it('reports a command that could not start, with the reason', async () => {
    const result = (await handler(
      {},
      { command: 'git', args: ['log'], cwd: join(scratch, 'missing') }
    )) as { exitCode: number; stderr: string }
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('ENOENT')
  })
})

describe('shell:open-external IPC handler', () => {
  let handler: (event: unknown, payload: unknown) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenExternal.mockResolvedValue(undefined)

    registerShellHandlers()

    const calls = vi.mocked(ipcMain.handle).mock.calls
    const call = calls.find(([channel]) => channel === 'shell:open-external')
    expect(call).toBeDefined()
    handler = call![1] as typeof handler
  })

  it('returns ok:true when openExternal succeeds', async () => {
    const result = await handler({}, { url: 'https://example.com' })
    expect(result).toEqual({ ok: true })
  })

  it('returns error string when openExternal throws', async () => {
    mockOpenExternal.mockRejectedValue(new Error('launch failed'))
    const result = (await handler({}, { url: 'https://example.com' })) as { error: string }
    expect(result.error).toContain('launch failed')
  })
})

describe('shell:open-path IPC handler', () => {
  let handler: (event: unknown, payload: unknown) => Promise<unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenPath.mockResolvedValue('')

    registerShellHandlers()

    const calls = vi.mocked(ipcMain.handle).mock.calls
    const call = calls.find(([channel]) => channel === 'shell:open-path')
    expect(call).toBeDefined()
    handler = call![1] as typeof handler
  })

  it('returns ok:true when openPath succeeds', async () => {
    const result = await handler({}, { filePath: '/some/file.txt' })
    expect(result).toEqual({ ok: true })
  })

  it('returns error when openPath returns a non-empty error message', async () => {
    mockOpenPath.mockResolvedValue('No application found')
    const result = (await handler({}, { filePath: '/some/file.txt' })) as { error: string }
    expect(result.error).toBe('No application found')
  })

  it('expands leading ~ to the home directory before calling openPath', async () => {
    await handler({}, { filePath: '~/projects/foo' })
    const { homedir } = await import('os')
    expect(mockOpenPath).toHaveBeenCalledWith(`${homedir()}/projects/foo`)
  })

  it('expands bare ~ to the home directory', async () => {
    await handler({}, { filePath: '~' })
    const { homedir } = await import('os')
    expect(mockOpenPath).toHaveBeenCalledWith(homedir())
  })

  it('does not expand ~ that is not at the start of the path', async () => {
    await handler({}, { filePath: '/some/~user/file' })
    expect(mockOpenPath).toHaveBeenCalledWith('/some/~user/file')
  })
})
