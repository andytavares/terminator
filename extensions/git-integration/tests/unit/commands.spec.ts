/**
 * Quick-actions commands (Git group, mnemonic 'g'): commit, push, pull,
 * create-pr. `activate()` in src/index.ts registers these by calling
 * registerQuickActionCommands(api) verbatim, so this exercises the same code
 * path the extension runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CommandContribution, CommandContext } from '@terminator/extension-sdk'

vi.mock('../../src/git/git-service', () => ({
  pushBranch: vi.fn(),
  pullFastForward: vi.fn(),
}))

import * as gitService from '../../src/git/git-service'
import { consumePendingViewRequest, registerQuickActionCommands } from '../../src/commands'

type Handler = (ctx: CommandContext) => void | Promise<void>

function buildMockApi() {
  const registrations: { command: CommandContribution; handler: Handler; disposed: boolean }[] = []
  const showToast = vi.fn()
  const showSelf = vi.fn()
  const raise = vi.fn()
  const focusSelf = vi.fn()
  const broadcast = vi.fn()

  const api = {
    commands: {
      register: vi.fn((command: CommandContribution, handler: Handler) => {
        const entry = { command, handler, disposed: false }
        registrations.push(entry)
        return { dispose: () => (entry.disposed = true) }
      }),
      setEnabled: vi.fn(),
    },
    window: { showSelf, broadcast, raise, focusSelf },
    notifications: { showToast },
  }

  return { api, registrations, showToast, showSelf, broadcast, raise, focusSelf }
}

function ctx(repoRoot: string | null): CommandContext {
  return { projectId: null, sessionId: null, repoRoot }
}

beforeEach(() => {
  vi.clearAllMocks()
})

/** Each quick action command: its id, label and mnemonic, in registration order. */
const EXPECTED = [
  ['commit', 'Commit…', 'c'],
  ['push', 'Push', 'p'],
  ['pull', 'Pull', 'l'],
  ['create-pr', 'Create PR…', 'r'],
  ['write-commit-message', 'Write commit message', 'w'],
  ['commit-and-open-pr', 'Commit and open PR…', 'o'],
]

describe('registerQuickActionCommands', () => {
  it('registers exactly commit, push, pull, create-pr, write-commit-message and commit-and-open-pr', () => {
    const { api, registrations } = buildMockApi()
    registerQuickActionCommands(api as never)
    expect(registrations.map((r) => r.command.id)).toEqual(EXPECTED.map(([id]) => id))
  })

  it.each(EXPECTED)(
    'registers %s as "%s" with mnemonic %s in the Git category, for a repo',
    (id, label, mnemonic) => {
      const { api, registrations } = buildMockApi()
      registerQuickActionCommands(api as never)
      const command = registrations.find((r) => r.command.id === id)?.command
      expect(command).toMatchObject({ label, mnemonic, requires: 'repo', category: 'Git' })
    }
  )
})

describe('registerQuickActionCommands — disposing the returned disposables removes every command', () => {
  it('disposing the returned disposables removes every command', () => {
    const { api, registrations } = buildMockApi()
    const disposables = registerQuickActionCommands(api as never)

    expect(registrations.every((r) => !r.disposed)).toBe(true)
    disposables.forEach((d) => d.dispose())
    expect(registrations.every((r) => r.disposed)).toBe(true)
  })
})

describe('registerQuickActionCommands (continued) — push', () => {
  it('calls pushBranch with ctx.repoRoot and toasts success', async () => {
    const { api, registrations, showToast } = buildMockApi()
    registerQuickActionCommands(api as never)
    vi.mocked(gitService.pushBranch).mockResolvedValue({
      success: true,
      branch: 'main',
      remote: 'origin',
    })

    const push = registrations.find((r) => r.command.id === 'push')!
    await push.handler(ctx('/repo'))

    expect(gitService.pushBranch).toHaveBeenCalledWith('/repo')
    expect(showToast).toHaveBeenCalledWith('success', 'Pushed main to origin', 'pushSucceeded')
  })

  it('toasts an error when the push is rejected', async () => {
    const { api, registrations, showToast } = buildMockApi()
    registerQuickActionCommands(api as never)
    vi.mocked(gitService.pushBranch).mockResolvedValue({ error: 'REJECTED' })

    const push = registrations.find((r) => r.command.id === 'push')!
    await push.handler(ctx('/repo'))

    expect(showToast).toHaveBeenCalledWith('error', expect.any(String), 'pushFailed')
  })
})

describe('registerQuickActionCommands (continued) — push — does nothing when ctx.repoRoot is null', () => {
  it('does nothing when ctx.repoRoot is null', async () => {
    const { api, registrations, showToast } = buildMockApi()
    registerQuickActionCommands(api as never)

    const push = registrations.find((r) => r.command.id === 'push')!
    await push.handler(ctx(null))

    expect(gitService.pushBranch).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalled()
  })
})

describe('registerQuickActionCommands (continued) — pull', () => {
  it('runs pull --ff-only in ctx.repoRoot and toasts success', async () => {
    const { api, registrations, showToast } = buildMockApi()
    registerQuickActionCommands(api as never)
    vi.mocked(gitService.pullFastForward).mockResolvedValue({ success: true, branch: 'main' })

    const pull = registrations.find((r) => r.command.id === 'pull')!
    await pull.handler(ctx('/repo'))

    expect(gitService.pullFastForward).toHaveBeenCalledWith('/repo')
    expect(showToast).toHaveBeenCalledWith(
      'success',
      expect.stringContaining('main'),
      'pullSucceeded'
    )
  })
})

describe('registerQuickActionCommands (continued) — pull — toasts an error when the pull fails', () => {
  it('toasts an error when the pull fails', async () => {
    const { api, registrations, showToast } = buildMockApi()
    registerQuickActionCommands(api as never)
    vi.mocked(gitService.pullFastForward).mockResolvedValue({
      error: 'Not possible to fast-forward',
    })

    const pull = registrations.find((r) => r.command.id === 'pull')!
    await pull.handler(ctx('/repo'))

    expect(showToast).toHaveBeenCalledWith(
      'error',
      expect.stringContaining('Not possible to fast-forward'),
      'pullFailed'
    )
  })

  it('does nothing when ctx.repoRoot is null', async () => {
    const { api, registrations } = buildMockApi()
    registerQuickActionCommands(api as never)

    const pull = registrations.find((r) => r.command.id === 'pull')!
    await pull.handler(ctx(null))

    expect(gitService.pullFastForward).not.toHaveBeenCalled()
  })
})

describe('registerQuickActionCommands (continued)', () => {
  describe('commit', () => {
    it('brings the project tab forward and asks the view to focus the commit message', async () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const commit = registrations.find((r) => r.command.id === 'commit')!
      await commit.handler(ctx('/repo'))

      expect(showSelf).toHaveBeenCalledWith('project')
      expect(broadcast).toHaveBeenCalledWith('git:focus-commit-message', { repoRoot: '/repo' })
    })

    it('raises the window and puts the keyboard in its own view, as Task Vault does', async () => {
      const { api, registrations, raise, focusSelf } = buildMockApi()
      registerQuickActionCommands(api as never)

      const commit = registrations.find((r) => r.command.id === 'commit')!
      await commit.handler(ctx('/repo'))

      expect(raise).toHaveBeenCalledTimes(1)
      expect(focusSelf).toHaveBeenCalledWith('project')
    })

    it('does nothing when ctx.repoRoot is null', async () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const commit = registrations.find((r) => r.command.id === 'commit')!
      await commit.handler(ctx(null))

      expect(showSelf).not.toHaveBeenCalled()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })
})

describe('registerQuickActionCommands (continued)', () => {
  describe('create-pr', () => {
    it('brings the project tab forward and asks the view to open the PR dialog', async () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const createPr = registrations.find((r) => r.command.id === 'create-pr')!
      await createPr.handler(ctx('/repo'))

      expect(showSelf).toHaveBeenCalledWith('project')
      expect(broadcast).toHaveBeenCalledWith('git:open-pr-dialog', { repoRoot: '/repo' })
    })

    it('does nothing when ctx.repoRoot is null', async () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const createPr = registrations.find((r) => r.command.id === 'create-pr')!
      await createPr.handler(ctx(null))

      expect(showSelf).not.toHaveBeenCalled()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })
})

// The Git view may not exist yet when the command runs: the broadcast then
// reaches nobody, so the request waits for the view to ask for it.
describe('registerQuickActionCommands (continued)', () => {
  describe('a request made before the Git view exists', () => {
    it.each([
      ['commit', 'commit'],
      ['create-pr', 'pull-request'],
    ] as const)('%s leaves a %s request the view collects once', async (id, kind) => {
      const { api, registrations } = buildMockApi()
      registerQuickActionCommands(api as never)
      await registrations.find((r) => r.command.id === id)!.handler(ctx('/repo'))
      expect(consumePendingViewRequest()).toEqual({ kind, repoRoot: '/repo' })
      expect(consumePendingViewRequest()).toBeNull()
    })

    it('lapses after five seconds, so a view opened later is not surprised', async () => {
      vi.useFakeTimers()
      const { api, registrations } = buildMockApi()
      registerQuickActionCommands(api as never)
      await registrations.find((r) => r.command.id === 'commit')!.handler(ctx('/repo'))
      vi.advanceTimersByTime(5000)
      expect(consumePendingViewRequest()).toBeNull()
      vi.useRealTimers()
    })
  })
})

describe('registerQuickActionCommands — the draft commands', () => {
  it('write-commit-message asks the open Git view to write the message', async () => {
    const { api, registrations, showSelf, broadcast } = buildMockApi()
    registerQuickActionCommands(api as never)

    await registrations.find((r) => r.command.id === 'write-commit-message')!.handler(ctx('/repo'))

    expect(showSelf).toHaveBeenCalledWith('project')
    expect(broadcast).toHaveBeenCalledWith('git:write-commit-message', { repoRoot: '/repo' })
    expect(consumePendingViewRequest()).toEqual({ kind: 'write-message', repoRoot: '/repo' })
  })

  it('commit-and-open-pr opens the pull request dialog', async () => {
    const { api, registrations, broadcast } = buildMockApi()
    registerQuickActionCommands(api as never)

    await registrations.find((r) => r.command.id === 'commit-and-open-pr')!.handler(ctx('/repo'))

    expect(broadcast).toHaveBeenCalledWith('git:open-pr-dialog', { repoRoot: '/repo' })
  })
})
