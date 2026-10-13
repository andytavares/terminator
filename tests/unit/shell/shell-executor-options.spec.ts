import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { execShell } from '../../../src/main/shell/shell-executor'
import { makeTempDir } from '../../support/temp-dir'

// Real processes: a stand-in `gh` on PATH whose script each test writes.

const originalPath = process.env.PATH
let scratch: string

function fakeGh(body: string): void {
  const path = join(scratch, 'gh')
  writeFileSync(path, `#!/bin/sh\n${body}\n`)
  chmodSync(path, 0o755)
}

beforeEach(() => {
  scratch = makeTempDir('shell-options-')
  process.env.PATH = `${scratch}:${originalPath}`
})

afterEach(() => {
  process.env.PATH = originalPath
  rmSync(scratch, { recursive: true, force: true })
})

describe('execShell per-call options', () => {
  it('adds the per-call environment to the one every command gets', async () => {
    fakeGh('printf "%s|%s" "$GH_REPO" "$GIT_TERMINAL_PROMPT"')

    const result = await execShell({
      command: 'gh',
      args: [],
      cwd: scratch,
      env: { GH_REPO: 'octo/repo' },
    })

    expect(result.stdout).toBe('octo/repo|0')
  })

  it('returns output exactly as written, leading and trailing whitespace included', async () => {
    fakeGh(`printf '  indented\\n\\n'`)

    const result = await execShell({ command: 'gh', args: [], cwd: scratch })

    expect(result.stdout).toBe('  indented\n\n')
  })
})

describe('execShell per-call options — input and streamed output', () => {
  it('writes the input to the command and closes its stdin', async () => {
    fakeGh('cat')

    const result = await execShell({ command: 'gh', args: [], cwd: scratch, input: '{"a":1}' })

    expect(result.stdout).toBe('{"a":1}')
  })

  it('hands each chunk of output to onOutput as it arrives', async () => {
    fakeGh(`printf 'one\\n'; printf 'two\\n' >&2`)
    const chunks: string[] = []

    await execShell({
      command: 'gh',
      args: [],
      cwd: scratch,
      onOutput: (chunk) => chunks.push(chunk),
    })

    expect(chunks.join('').split('\n').sort()).toEqual(['', 'one', 'two'])
  })
})

describe('execShell per-call options — output encoding and limits', () => {
  it('returns bytes when asked for a buffer', async () => {
    fakeGh(`printf '\\377\\000A'`)

    const result = await execShell({ command: 'gh', args: [], cwd: scratch, encoding: 'buffer' })

    expect([...result.stdout]).toEqual([0xff, 0x00, 0x41])
  })

  it('says why a command could not start, as bytes when asked for a buffer', async () => {
    const command = 'terminator-no-such-command'
    const result = await execShell({ command, args: [], cwd: scratch, encoding: 'buffer' })

    expect(Buffer.isBuffer(result.stderr)).toBe(true)
    expect(result.stderr.toString()).toContain('ENOENT')
  })

  it('stops a command whose output passes maxBuffer and reports it as a failure', async () => {
    fakeGh(`printf '%0100d' 0`)

    const result = await execShell({ command: 'gh', args: [], cwd: scratch, maxBuffer: 50 })

    expect(result.exceededMaxBuffer).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })
})

describe('execShell per-call options — limits and timeouts', () => {
  it('keeps output that fits in maxBuffer', async () => {
    fakeGh(`printf '%0100d' 0`)

    const result = await execShell({ command: 'gh', args: [], cwd: scratch, maxBuffer: 101 })

    expect(result).toMatchObject({ exitCode: 0, exceededMaxBuffer: false })
    expect(result.stdout).toHaveLength(100)
  })

  it('reports a timeout as a failure with exit code 124', async () => {
    fakeGh('sleep 5')

    const result = await execShell({ command: 'gh', args: [], cwd: scratch, timeoutMs: 100 })

    expect(result).toMatchObject({ timedOut: true, exitCode: 124 })
  })
})
