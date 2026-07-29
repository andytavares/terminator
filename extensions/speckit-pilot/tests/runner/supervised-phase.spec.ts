import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createAgentRunner, setSupervisedRunner } from '../../src/runner/agent-runner.js'
import type { SupervisedRunner } from '../../src/runtime/supervised-runner.js'

// A phase used to be a hidden `claude --print --permission-mode
// bypassPermissions` child process. What matters here is which path a phase
// takes now, and that it never silently runs unsupervised when it could have
// been supervised.

interface Started {
  workspaceId: string
  branch: string
  prompt: string
  worktreePath: string
  resumeSessionId?: string
}

let started: Started[]
let stopped: Array<{ sessionId: string; reason?: string }>
let startResult: { sessionId: string; terminalSessionId: string; transcriptPath: string } | null
let branchExitCode: number

function fakeRunner(): SupervisedRunner {
  return {
    start: async (options) => {
      started.push(options as unknown as Started)
      return startResult
    },
    stop: (sessionId, reason) => {
      stopped.push({ sessionId, reason })
      return true
    },
    resolve: () => {},
    interrupt: () => {},
    send: () => true,
    terminalFor: () => null,
    dispose: () => {},
  } as SupervisedRunner
}

function api() {
  return {
    workspace: { list: () => [{ id: 'ws-1', name: 'repo', folderPath: '/repo' }] },
    shell: {
      exec: async () => ({
        exitCode: branchExitCode,
        stdout: branchExitCode === 0 ? 'feat/thing\n' : '',
        stderr: '',
        timedOut: false,
      }),
    },
    window: { broadcast: vi.fn() },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never
}

const phaseOpts = {
  featureDir: '/repo/specs/021-thing',
  worktreePath: '/wt/feat-thing',
  phaseCommand: '/speckit-implement',
  phase: 'implement' as never,
}

const settle = (): Promise<unknown> => new Promise((r) => setTimeout(r, 20))

beforeEach(() => {
  started = []
  stopped = []
  startResult = {
    sessionId: 'session-1',
    terminalSessionId: 'terminal-1',
    transcriptPath: '/t.jsonl',
  }
  branchExitCode = 0
  setSupervisedRunner(fakeRunner())
})

afterEach(() => setSupervisedRunner(null))

describe('a phase run, once the extension has a supervised runtime', () => {
  it('goes to the terminal rather than a hidden child process', async () => {
    createAgentRunner(api()).startPhaseRunner(phaseOpts)
    await settle()
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      workspaceId: 'ws-1',
      branch: 'feat/thing',
      worktreePath: '/wt/feat-thing',
      prompt: '/speckit-implement',
    })
  })

  it('carries reviewer feedback into the prompt', async () => {
    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, feedbackNote: 'use the other API' })
    await settle()
    expect(started[0].prompt).toContain('use the other API')
  })

  it('resumes the conversation when answering the model rather than starting a second one', async () => {
    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, resumeSessionId: 'earlier' })
    await settle()
    expect(started[0].resumeSessionId).toBe('earlier')
  })

  it('reports the session id, so the card can resume it later', async () => {
    const seen: string[] = []
    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, onSession: (id) => seen.push(id) })
    await settle()
    expect(seen).toEqual(['session-1'])
  })

  it('falls back to the worktree name when git cannot say what branch it is on', async () => {
    branchExitCode = 1
    createAgentRunner(api()).startPhaseRunner(phaseOpts)
    await settle()
    expect(started[0].branch).toBe('feat-thing')
  })

  it('stops the run through the runner that owns its terminal', async () => {
    const handle = createAgentRunner(api()).startPhaseRunner(phaseOpts)
    await settle()
    handle.stop()
    expect(stopped).toEqual([{ sessionId: 'session-1', reason: 'stopped from the pilot' }])
  })

  it('completes the caller even when no run could be started', async () => {
    // The caller is waiting on a completion it would otherwise never get, and
    // the card would sit mid-phase forever.
    startResult = null
    const codes: number[] = []
    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, onComplete: (c) => codes.push(c) })
    await settle()
    expect(codes).toEqual([1])
  })

  it('leaves self-review alone, which is a shell chain rather than an agent', async () => {
    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, phase: 'self-review' as never })
    await settle()
    expect(started).toEqual([])
  })

  it('does not supervise a card whose repository is in no workspace', async () => {
    // There would be nowhere to put the terminal. Falling back is deliberate:
    // a phase that does not run at all is worse than one that runs headless.
    const outside = { ...phaseOpts, featureDir: '/elsewhere/specs/021-thing' }
    createAgentRunner(api()).startPhaseRunner(outside)
    await settle()
    expect(started).toEqual([])
  })
})

describe('with no supervised runtime', () => {
  it('starts nothing through the runner', async () => {
    setSupervisedRunner(null)
    createAgentRunner(api()).startPhaseRunner(phaseOpts)
    await settle()
    expect(started).toEqual([])
  })
})
