import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dispatchChannel, type AgentsAPI } from '@terminator/extension-sdk'
import { registerReviewAgentHandlers, type ReviewAgentDeps } from '../../src/ipc/review-agent.ipc'
import { bindWorkspaceRoots } from '../../src/ipc/repo-root'
import { partialFake } from '../../../../tests/support/fakes'
import { bindShellToAnswers } from './support/shell'

vi.mock('electron-store', () => ({ default: class {} }))

const DRAFT = {
  branch: 'add-login',
  commitMessage: 'Add login form',
  title: 'Add login',
  body: 'Adds a login form.',
}
const STAGED_DIFF = 'diff --git a/login.ts b/login.ts\n+export const login = 1\n'

/** Registers the review-agent channels over a fake `runOnce` and answers `draft-change` calls. */
function draftChange(runOnce: AgentsAPI['runOnce'], payload: unknown = { repoRoot: '/repo' }) {
  const handlers: Record<string, (p: unknown) => Promise<unknown>> = {}
  const deps: ReviewAgentDeps = {
    getSetting: () => undefined,
    broadcast: vi.fn(),
    agents: partialFake<ReviewAgentDeps['agents']>({ runOnce }),
    projectIdFor: () => undefined,
    storagePath: '/storage',
  }
  bindWorkspaceRoots(() => ['/repo'])
  registerReviewAgentHandlers((spec) => {
    handlers[spec.channel] = (p) => dispatchChannel(spec, p)
  }, deps)
  return handlers['review-agent:draft-change'](payload)
}

const replying = (text: string) =>
  vi.fn<AgentsAPI['runOnce']>(async () => ({ text, sessionId: 's1', stopReason: 'end_turn' }))

beforeEach(() => {
  bindShellToAnswers((_command, args) => {
    if (args[0] === 'diff') return STAGED_DIFF
    return 'Fix the thing\nAdd the other thing\n'
  })
})

describe('review-agent:draft-change — the draft', () => {
  it('answers the draft the agent returns and sends it the diff and the recent subjects', async () => {
    const runOnce = replying(`Here you go: ${JSON.stringify(DRAFT)}`)

    expect(await draftChange(runOnce)).toEqual({ draft: DRAFT })

    const { prompt, cwd } = runOnce.mock.calls[0][0]
    expect(cwd).toBe('/repo')
    expect(prompt).toContain(STAGED_DIFF)
    expect(prompt).toContain('Fix the thing\nAdd the other thing')
    expect(prompt).toContain('"commitMessage"')
  })
})

describe('review-agent:draft-change — the agent fails', () => {
  it('answers a plain error, not the zod text, when the reply has no usable draft', async () => {
    const result = await draftChange(replying(JSON.stringify({ branch: 'x', title: 't' })))

    expect(result).toEqual({ error: expect.stringMatching(/without a usable draft/) })
    expect(JSON.stringify(result)).not.toMatch(/invalid_type|ZodError/)
  })

  it('answers the agent failure as an error', async () => {
    const runOnce = vi.fn<AgentsAPI['runOnce']>(async () => ({
      error: 'RUN_FAILED',
      message: 'The agent is not signed in.',
    }))

    expect(await draftChange(runOnce)).toEqual({ error: 'The agent is not signed in.' })
  })
})

describe('review-agent:draft-change — git fails or has nothing', () => {
  it('answers an error without asking the agent when nothing is staged', async () => {
    bindShellToAnswers(() => '')
    const runOnce = replying(JSON.stringify(DRAFT))

    expect(await draftChange(runOnce)).toEqual({
      error: expect.stringMatching(/Nothing is staged/),
    })
    expect(runOnce).not.toHaveBeenCalled()
  })

  it('answers a plain error when git cannot read the diff', async () => {
    bindShellToAnswers(() => new Error('fatal: not a git repository'))

    const result = await draftChange(replying(JSON.stringify(DRAFT)))

    expect(result).toEqual({ error: expect.stringMatching(/Could not read the staged changes/) })
    expect(JSON.stringify(result)).not.toMatch(/fatal/)
  })

  it('rejects a repository outside the workspace', async () => {
    expect(await draftChange(replying('{}'), { repoRoot: '/elsewhere' })).toEqual({
      error: 'VALIDATION_ERROR',
    })
  })
})
