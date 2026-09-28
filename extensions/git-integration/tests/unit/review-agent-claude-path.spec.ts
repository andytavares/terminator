import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

const execFile = vi.fn()
vi.mock('child_process', () => ({ execFile, spawn: vi.fn() }))

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

type ExecCb = (err: Error | null, out?: { stdout: string }) => void
function shellPrints(stdout: string | Error) {
  execFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: ExecCb) =>
    stdout instanceof Error ? cb(stdout) : cb(null, { stdout })
  )
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
  execFile.mockReset()
})

describe('runAgentReview without an injected claude resolver', () => {
  it("asks the person's interactive login shell and spawns the path it prints", async () => {
    shellPrints('rc noise\n/Users/me/.local/bin/claude\n')

    expect(await spawnedCommands(1)).toEqual(['/Users/me/.local/bin/claude'])
    expect(execFile.mock.calls[0][1]).toEqual(['-ilc', 'command -v claude'])
  })

  it('asks the shell once and reuses the path it found', async () => {
    shellPrints('/Users/me/.local/bin/claude\n')

    expect(await spawnedCommands(2)).toEqual([
      '/Users/me/.local/bin/claude',
      '/Users/me/.local/bin/claude',
    ])
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('falls back to a bare claude, and asks again next run, when the shell finds none', async () => {
    shellPrints('')

    expect(await spawnedCommands(2)).toEqual(['claude', 'claude'])
    expect(execFile).toHaveBeenCalledTimes(2)
  })

  it('falls back to a bare claude when the shell itself fails', async () => {
    shellPrints(new Error('zsh: timeout'))

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
