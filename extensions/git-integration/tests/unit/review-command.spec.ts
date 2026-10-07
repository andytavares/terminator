import { describe, it, expect, vi } from 'vitest'
import type { CommandContribution, CommandContext } from '../../../../src/main/extensions/api'
import {
  registerReviewPullRequestCommand,
  registerReviewSubmittedRelay,
  registerReviewSettings,
  openPrReviewWindow,
} from '../../src/review-command'

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

describe('window:review-submitted relay', () => {
  it('tells every open review list to reload', () => {
    const handlers: Record<string, () => unknown> = {}
    const broadcast = vi.fn()
    const api = {
      ipc: {
        registerHandler: vi.fn((channel: string, handler: () => unknown) => {
          handlers[channel] = handler
          return { dispose: vi.fn() }
        }),
      },
      window: { broadcast },
    }
    registerReviewSubmittedRelay(api as never)
    expect(handlers['window:review-submitted']()).toEqual({ ok: true })
    expect(broadcast).toHaveBeenCalledWith('reviews:changed', {})
  })
})

describe('review settings', () => {
  function setup(stored: Record<string, unknown>) {
    const handlers: Record<string, (payload?: unknown) => unknown> = {}
    const set = vi.fn()
    const api = {
      ipc: {
        registerHandler: vi.fn((channel: string, handler: (payload?: unknown) => unknown) => {
          handlers[channel] = handler
          return { dispose: vi.fn() }
        }),
      },
      settings: { get: (key: string) => stored[key], set },
    }
    const disposables = registerReviewSettings(api as never)
    return { handlers, set, disposables }
  }
  const REPOS = 'terminator.git-integration.review.repos'

  it('returns the clone folder and the selected repositories', () => {
    const { handlers, disposables } = setup({
      'terminator.git-integration.review.cloneFolder': '/src',
      [REPOS]: ['acme/widgets'],
    })
    expect(handlers['github:review-settings']()).toEqual({
      cloneFolder: '/src',
      repos: ['acme/widgets'],
    })
    expect(disposables).toHaveLength(2)
  })

  it('treats a missing or non-array selection as all repositories', () => {
    expect(setup({}).handlers['github:review-settings']()).toEqual({ cloneFolder: '', repos: [] })
    expect(setup({ [REPOS]: 'acme/widgets' }).handlers['github:review-settings']()).toEqual({
      cloneFolder: '',
      repos: [],
    })
  })

  it('stores a deduplicated selection', () => {
    const { handlers, set } = setup({})
    expect(
      handlers['github:review-repos-set']({
        repos: ['acme/widgets', 'acme/gadgets', 'acme/widgets'],
      })
    ).toEqual({ ok: true })
    expect(set).toHaveBeenCalledWith(REPOS, ['acme/widgets', 'acme/gadgets'])
  })

  it('stores an empty selection', () => {
    const { handlers, set } = setup({})
    handlers['github:review-repos-set']({ repos: [] })
    expect(set).toHaveBeenCalledWith(REPOS, [])
  })

  it('refuses a malformed selection without writing', () => {
    const { handlers, set } = setup({})
    expect(handlers['github:review-repos-set']({ repos: ['widgets'] })).toEqual({
      error: 'VALIDATION_ERROR',
    })
    expect(handlers['github:review-repos-set']({})).toEqual({ error: 'VALIDATION_ERROR' })
    expect(set).not.toHaveBeenCalled()
  })
})
