import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runScript, scriptEnv } from '../../../../../src/main/supervision/worktree/setup-runner.js'

let cwd: string
beforeEach(() => (cwd = mkdtempSync(join(tmpdir(), 'setup-runner-'))))
afterEach(() => rmSync(cwd, { recursive: true, force: true }))

const run = (command: string, extra: Record<string, string> = {}) =>
  runScript({ command, cwd, env: { TERMINATOR_WORKITEM: 'FLU-220', ...extra } })

describe('exit codes', () => {
  it('reports zero for a command that succeeds', async () => {
    await expect(run('exit 0')).resolves.toMatchObject({ exitCode: 0 })
  })

  it('reports the exact non-zero code, which is what marks the session failed (FR-034)', async () => {
    await expect(run('exit 3')).resolves.toMatchObject({ exitCode: 3 })
  })

  it('reports a non-zero code for a command that does not exist', async () => {
    const result = await run('definitely-not-a-real-command-xyz')
    expect(result.exitCode).not.toBe(0)
  })
})

describe('output capture', () => {
  it('retains stdout, so a failure can be shown without opening the session', async () => {
    const result = await run('echo hello-from-setup')
    expect(result.output).toContain('hello-from-setup')
  })

  it('retains stderr as well as stdout', async () => {
    const result = await run('echo oops >&2')
    expect(result.output).toContain('oops')
  })

  it('retains output from a command that then fails', async () => {
    const result = await run('echo progress; exit 2')
    expect(result).toMatchObject({ exitCode: 2 })
    expect(result.output).toContain('progress')
  })
})

describe('environment (FR-033)', () => {
  it('exposes the declared variables to the script', async () => {
    const result = await run('echo "item=$TERMINATOR_WORKITEM"')
    expect(result.output).toContain('item=FLU-220')
  })

  it('exposes the port base and worktree path', async () => {
    const env = scriptEnv({ portBase: 4000, worktreePath: '/wt/s1', workItemId: 'FLU-220' })
    const result = await runScript({
      command: 'echo "$TERMINATOR_PORT_BASE|$TERMINATOR_WORKTREE"',
      cwd,
      env,
    })
    expect(result.output).toContain('4000|/wt/s1')
  })

  it('still inherits the ambient environment, so PATH resolves', async () => {
    const result = await run('echo "path=${PATH:+set}"')
    expect(result.output).toContain('path=set')
  })
})

describe('working directory', () => {
  it('runs inside the worktree, not the primary checkout', async () => {
    const result = await run('pwd')
    // macOS reports /private/var for /var, so compare the trailing segment.
    expect(result.output.trim().endsWith(cwd.split('/').pop()!)).toBe(true)
  })
})

describe('timeout', () => {
  it('kills a command that never finishes rather than hanging the session', async () => {
    const result = await runScript({
      command: 'sleep 30',
      cwd,
      env: {},
      timeoutMs: 150,
    })
    expect(result.exitCode).not.toBe(0)
    expect(result.output).toContain('timed out')
  })
})

describe('scriptEnv', () => {
  it('names all three variables the contract documents', () => {
    expect(scriptEnv({ portBase: 4000, worktreePath: '/wt/s1', workItemId: 'X' })).toEqual({
      TERMINATOR_PORT_BASE: '4000',
      TERMINATOR_WORKTREE: '/wt/s1',
      TERMINATOR_WORKITEM: 'X',
    })
  })
})
