import { describe, it, expect, vi } from 'vitest'
import type { CommandContribution, CommandContext } from '../../../../src/main/extensions/api'
import { registerReviewPullRequestCommand, openPrReviewWindow } from '../../src/review-command'

type Handler = (ctx: CommandContext, args?: unknown) => void

function build() {
  const registered: { command: CommandContribution; handler: Handler }[] = []
  const openAuxiliary = vi.fn()
  const api = {
    commands: {
      register: vi.fn((command: CommandContribution, handler: Handler) => {
        registered.push({ command, handler })
        return { dispose: vi.fn() }
      }),
    },
    window: { openAuxiliary },
  }
  return { api, registered, openAuxiliary }
}

const ctx: CommandContext = { projectId: null, sessionId: null, repoRoot: null }

describe('review-pull-request command', () => {
  it('registers with an args schema that accepts repoRoot and number only', () => {
    const { api, registered } = build()
    registerReviewPullRequestCommand(api as never)

    const { command } = registered[0]
    expect(command.id).toBe('review-pull-request')
    expect(command.args!.safeParse({ repoRoot: '/repo', number: 42 }).success).toBe(true)
    expect(command.args!.safeParse({ repoRoot: '/repo', number: '42' }).success).toBe(false)
    expect(command.args!.safeParse({ number: 42 }).success).toBe(false)
    expect(command.args!.safeParse({ repoRoot: '/repo', number: 0 }).success).toBe(false)
  })

  it('opens the pr-review window for the repo and pull request number', () => {
    const { api, registered, openAuxiliary } = build()
    registerReviewPullRequestCommand(api as never)

    registered[0].handler(ctx, { repoRoot: '/repo', number: 42 })

    expect(openAuxiliary).toHaveBeenCalledWith('pr-review', {
      repoRoot: '/repo',
      accentColor: '',
      prNumber: '42',
      showOverview: 'false',
    })
  })

  it('opens nothing without args', () => {
    const { api, registered, openAuxiliary } = build()
    registerReviewPullRequestCommand(api as never)

    registered[0].handler(ctx)

    expect(openAuxiliary).not.toHaveBeenCalled()
  })
})

describe('openPrReviewWindow', () => {
  it('omits prNumber and showOverview when no number is given', () => {
    const { api, openAuxiliary } = build()
    openPrReviewWindow(api as never, { repoRoot: '/repo', accentColor: '#fff' })
    expect(openAuxiliary).toHaveBeenCalledWith('pr-review', {
      repoRoot: '/repo',
      accentColor: '#fff',
    })
  })
})
