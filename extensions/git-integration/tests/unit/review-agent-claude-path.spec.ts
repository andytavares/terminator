import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Without an injected resolver the review agent asks the person's interactive
// login shell where claude is. SHELL is a stand-in here that records each call
// and its arguments, and prints what a test gives it.

const input = {
  repoRoot: '/repo',
  worktreePath: '/wt',
  prNumber: 42,
  headSHA: 'abc1234',
  baseRefName: 'main',
  title: 't',
  body: '',
  scope: {
    kind: 'file',
    path: 'a.ts',
    startLine: null,
    endLine: null,
    side: null,
    chapter: null,
  } as const,
  request: 'review' as const,
  sessionId: 'sess-1',
  model: 'sonnet',
}

let scratch: string
let callsFile: string

function exitingProcess() {
  const proc = new EventEmitter()
  return {
    stdin: { write: () => {}, end: () => {} },
    stdout: { on: () => {} },
    stderr: { on: () => {} },
    on: (ev: string, cb: (...a: unknown[]) => void) => {
      proc.on(ev, cb)
      if (ev === 'exit') setTimeout(() => proc.emit('exit', 1), 0)
    },
    kill: vi.fn(),
  }
}

/** A login shell that records its arguments, prints `stdout` and exits with `status`. */
function shellPrints(stdout: string, status = 0): void {
  const shell = join(scratch, 'shell')
  const printed = join(scratch, 'printed')
  writeFileSync(printed, stdout)
  writeFileSync(shell, `#!/bin/sh\necho "$*" >> "${callsFile}"\ncat "${printed}"\nexit ${status}\n`)
  chmodSync(shell, 0o755)
  vi.stubEnv('SHELL', shell)
}

function shellCalls(): string[] {
  return existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n') : []
}

async function spawnedCommands(runs: number) {
  const { runAgentReview } = await import('../../src/review/review-agent.js')
  const exec = vi.fn(async () => ({ stdout: 'diff' }))
  const spawn = vi.fn(() => exitingProcess())
  for (let i = 0; i < runs; i++) await runAgentReview(input, { exec, spawn }).done
  return spawn.mock.calls.map((c) => c[0])
}

beforeEach(() => {
  vi.resetModules()
  scratch = mkdtempSync(join(tmpdir(), 'claude-path-'))
  callsFile = join(scratch, 'calls')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(scratch, { recursive: true, force: true })
})

describe('runAgentReview without an injected claude resolver', () => {
  it("asks the person's interactive login shell and spawns the path it prints", async () => {
    shellPrints('rc noise\n/Users/me/.local/bin/claude\n')

    expect(await spawnedCommands(1)).toEqual(['/Users/me/.local/bin/claude'])
    expect(shellCalls()).toEqual(['-ilc command -v claude'])
  })

  it('asks the shell once and reuses the path it found', async () => {
    shellPrints('/Users/me/.local/bin/claude\n')

    expect(await spawnedCommands(2)).toEqual([
      '/Users/me/.local/bin/claude',
      '/Users/me/.local/bin/claude',
    ])
    expect(shellCalls()).toHaveLength(1)
  })

  it('falls back to a bare claude, and asks again next run, when the shell finds none', async () => {
    shellPrints('')

    expect(await spawnedCommands(2)).toEqual(['claude', 'claude'])
    expect(shellCalls()).toHaveLength(2)
  })
})

describe('runAgentReview without an injected claude resolver — falls back to a bare claude when the shell itself fails', () => {
  it('falls back to a bare claude when the shell itself fails', async () => {
    shellPrints('/Users/me/.local/bin/claude\n', 1)

    expect(await spawnedCommands(1)).toEqual(['claude'])
  })
})

describe('runAgentReview cancelled while claude is being resolved', () => {
  it('never spawns', async () => {
    const { runAgentReview } = await import('../../src/review/review-agent.js')
    let found: (p: string) => void = () => {}
    const spawn = vi.fn()
    const { done, cancel } = runAgentReview(input, {
      exec: async () => ({ stdout: 'diff' }),
      spawn,
      resolveClaude: () => new Promise<string>((r) => (found = r)),
    })
    await new Promise((r) => setTimeout(r, 0))
    cancel()
    found('/Users/me/.local/bin/claude')

    expect((await done).status).toBe('cancelled')
    expect(spawn).not.toHaveBeenCalled()
  })
})
