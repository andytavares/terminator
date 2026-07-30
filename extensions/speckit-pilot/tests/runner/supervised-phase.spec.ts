import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createAgentRunner,
  setPermissionSink,
  setSupervisedRunner,
} from '../../src/runner/agent-runner.js'
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
    notifications: { showToast: vi.fn(), createNotification: vi.fn() },
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

afterEach(() => {
  setSupervisedRunner(null)
  setPermissionSink(null)
})

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

describe('what a raised request reaches', () => {
  // The sink is what a surface reads. Without it the request is held at the
  // hook with nothing rendering it, which is how a phase ends up stuck.
  it('reaches the sink, stamped with the card it belongs to', async () => {
    const held: Array<{ featureDir: string; requestId: string }> = []
    setPermissionSink({
      onPending: (ask) => held.push(ask),
      onResolved: () => {},
    })
    const runner = fakeRunner()
    let raise: ((p: unknown) => void) | null = null
    runner.start = async (options) => {
      raise = (options as { onPending: (p: unknown) => void }).onPending
      return startResult
    }
    setSupervisedRunner(runner)

    createAgentRunner(api()).startPhaseRunner(phaseOpts)
    await settle()
    raise?.({ sessionId: 'session-1', requestId: 'req-1', toolName: 'Bash', summary: 'ls', at: 1 })
    expect(held).toEqual([expect.objectContaining({ featureDir: phaseOpts.featureDir })])
  })

  it('clears from the sink when answered', async () => {
    const cleared: string[] = []
    setPermissionSink({ onPending: () => {}, onResolved: (id) => cleared.push(id) })
    const runner = fakeRunner()
    let settleIt: ((id: string, d: 'allow' | 'deny') => void) | null = null
    runner.start = async (options) => {
      settleIt = (options as { onResolved: (id: string, d: 'allow' | 'deny') => void }).onResolved
      return startResult
    }
    setSupervisedRunner(runner)

    createAgentRunner(api()).startPhaseRunner(phaseOpts)
    await settle()
    settleIt?.('req-1', 'allow')
    expect(cleared).toEqual(['req-1'])
  })

  it('runs without a sink at all, rather than throwing into the agent', async () => {
    setPermissionSink(null)
    const runner = fakeRunner()
    let raise: ((p: unknown) => void) | null = null
    runner.start = async (options) => {
      raise = (options as { onPending: (p: unknown) => void }).onPending
      return startResult
    }
    setSupervisedRunner(runner)

    createAgentRunner(api()).startPhaseRunner(phaseOpts)
    await settle()
    expect(() =>
      raise?.({ sessionId: 's', requestId: 'r', toolName: 'Bash', summary: 'ls', at: 1 })
    ).not.toThrow()
  })

  it('reports the end of a run as a completion, so the card does not sit mid-phase', async () => {
    const codes: number[] = []
    const runner = fakeRunner()
    let finish: ((exitCode: number) => void) | null = null
    runner.start = async (options) => {
      finish = (options as { onEnd?: (exitCode: number) => void }).onEnd ?? null
      return startResult
    }
    setSupervisedRunner(runner)

    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, onComplete: (c) => codes.push(c) })
    await settle()
    // The terminal's own code: a session that died is not a phase that
    // succeeded.
    finish?.(0)
    finish?.(0)
    // Once, however many times the runtime says it ended.
    expect(codes).toEqual([0])
  })
})

describe('when a supervised phase is finished', () => {
  // In a terminal the agent does not exit when it is done — it sits at its
  // prompt, and `session_end` may never come. Waiting for it left the phase
  // `running` forever: the gate never appeared and approval never unlocked
  // while the agent sat idle.

  it('completes the phase when the turn ends, not only when the session does', async () => {
    const codes: number[] = []
    const runner = fakeRunner()
    let endTurn: ((turns: number) => void) | null = null
    runner.start = async (options) => {
      endTurn = (options as { onTurnEnd?: (turns: number) => void }).onTurnEnd ?? null
      return startResult
    }
    setSupervisedRunner(runner)

    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, onComplete: (c) => codes.push(c) })
    await settle()
    endTurn?.(3)
    expect(codes).toEqual([0])
  })

  it('reports the terminal’s code, so a crashed run is not awaiting review', async () => {
    const codes: number[] = []
    const runner = fakeRunner()
    let finish: ((exitCode: number) => void) | null = null
    runner.start = async (options) => {
      finish = (options as { onEnd?: (exitCode: number) => void }).onEnd ?? null
      return startResult
    }
    setSupervisedRunner(runner)

    createAgentRunner(api()).startPhaseRunner({ ...phaseOpts, onComplete: (c) => codes.push(c) })
    await settle()
    finish?.(137)
    expect(codes).toEqual([137])
  })

  it('stops a run that was cancelled before it had started', async () => {
    // The handle is returned while `start` is still in flight; a stop that
    // arrived first used to find no session and do nothing, leaving the
    // terminal to open and the agent to run anyway.
    const runner = fakeRunner()
    const stopped: string[] = []
    runner.stop = (sessionId: string) => {
      stopped.push(sessionId)
      return true
    }
    setSupervisedRunner(runner)

    const handle = createAgentRunner(api()).startPhaseRunner(phaseOpts)
    handle.stop()
    await settle()
    expect(stopped).toContain(startResult.sessionId)
  })
})

describe('when a phase cannot be supervised', () => {
  // It falls through to `claude --print --permission-mode bypassPermissions`:
  // an agent nobody can see, approving its own tool calls in a worktree. That
  // is the thing this whole path replaced, so it must never be silent.

  it('says so when the repository belongs to no workspace', async () => {
    // There is nowhere to put the terminal, so the run has no home — and the
    // fall-through is the headless spawn.
    setSupervisedRunner(fakeRunner())
    const a = api()
    ;(a.workspace as unknown as { list: () => unknown[] }).list = () => []

    createAgentRunner(a).startPhaseRunner(phaseOpts)
    await settle()

    const toasts = vi.mocked(a.notifications.showToast).mock.calls
    expect(toasts.length).toBeGreaterThan(0)
    expect(String(toasts[0][1])).toMatch(/unsupervised/i)
  })

  it('does not fall back when the terminal itself could not be opened', async () => {
    // That path ends the phase rather than running it unwatched, which is the
    // right answer: it reports a failure instead of quietly bypassing.
    const runner = fakeRunner()
    runner.start = async () => null
    setSupervisedRunner(runner)

    const codes: number[] = []
    const a = api()
    createAgentRunner(a).startPhaseRunner({ ...phaseOpts, onComplete: (c) => codes.push(c) })
    await settle()

    expect(codes).toEqual([1])
    expect(vi.mocked(a.notifications.showToast)).not.toHaveBeenCalled()
  })

  it('says so when there is no supervised runner at all', async () => {
    setSupervisedRunner(null)
    const a = api()
    createAgentRunner(a).startPhaseRunner(phaseOpts)
    await settle()
    expect(vi.mocked(a.notifications.showToast)).toHaveBeenCalled()
  })

  it('stays quiet for self-review, which is a shell chain rather than an agent', async () => {
    setSupervisedRunner(null)
    const a = api()
    createAgentRunner(a).startPhaseRunner({ ...phaseOpts, phase: 'self-review' })
    await settle()
    expect(vi.mocked(a.notifications.showToast)).not.toHaveBeenCalled()
  })
})
