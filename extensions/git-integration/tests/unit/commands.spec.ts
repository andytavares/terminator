/**
 * Quick-actions commands (Git group, mnemonic 'g'): commit, push, pull,
 * create-pr. `activate()` in src/index.ts registers these by calling
 * registerQuickActionCommands(api) verbatim, so this exercises the same code
 * path the extension runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CommandContribution, CommandContext } from '../../../../src/main/extensions/api'

vi.mock('../../src/git/git-service', () => ({
  pushBranch: vi.fn(),
  pullFastForward: vi.fn(),
}))

import * as gitService from '../../src/git/git-service'
import { registerQuickActionCommands } from '../../src/commands'

type Handler = (ctx: CommandContext) => void | Promise<void>

function buildMockApi() {
  const registrations: { command: CommandContribution; handler: Handler; disposed: boolean }[] = []
  const showToast = vi.fn()
  const showSelf = vi.fn()
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
    window: { showSelf, broadcast },
    notifications: { showToast },
  }

  return { api, registrations, showToast, showSelf, broadcast }
}

function ctx(repoRoot: string | null): CommandContext {
  return { projectId: null, sessionId: null, repoRoot }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerQuickActionCommands', () => {
  it('registers exactly commit, push, pull and create-pr with mnemonics, labels, requires and category', () => {
    const { api, registrations } = buildMockApi()
    registerQuickActionCommands(api as never)

    expect(registrations).toHaveLength(4)
    const byId = Object.fromEntries(registrations.map((r) => [r.command.id, r.command]))

    expect(byId.commit).toMatchObject({
      label: 'Commit…',
      mnemonic: 'c',
      requires: 'repo',
      category: 'Git',
    })
    expect(byId.push).toMatchObject({
      label: 'Push',
      mnemonic: 'p',
      requires: 'repo',
      category: 'Git',
    })
    expect(byId.pull).toMatchObject({
      label: 'Pull',
      mnemonic: 'l',
      requires: 'repo',
      category: 'Git',
    })
    expect(byId['create-pr']).toMatchObject({
      label: 'Create PR…',
      mnemonic: 'r',
      requires: 'repo',
      category: 'Git',
    })
  })

  it('disposing the returned disposables removes every command', () => {
    const { api, registrations } = buildMockApi()
    const disposables = registerQuickActionCommands(api as never)

    expect(registrations.every((r) => !r.disposed)).toBe(true)
    disposables.forEach((d) => d.dispose())
    expect(registrations.every((r) => r.disposed)).toBe(true)
  })

  describe('push', () => {
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

    it('does nothing when ctx.repoRoot is null', async () => {
      const { api, registrations, showToast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const push = registrations.find((r) => r.command.id === 'push')!
      await push.handler(ctx(null))

      expect(gitService.pushBranch).not.toHaveBeenCalled()
      expect(showToast).not.toHaveBeenCalled()
    })
  })

  describe('pull', () => {
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

  describe('commit', () => {
    it('brings the project tab forward and asks the view to focus the commit message', () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const commit = registrations.find((r) => r.command.id === 'commit')!
      commit.handler(ctx('/repo'))

      expect(showSelf).toHaveBeenCalledWith('project')
      expect(broadcast).toHaveBeenCalledWith('git:focus-commit-message', { repoRoot: '/repo' })
    })

    it('does nothing when ctx.repoRoot is null', () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const commit = registrations.find((r) => r.command.id === 'commit')!
      commit.handler(ctx(null))

      expect(showSelf).not.toHaveBeenCalled()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })

  describe('create-pr', () => {
    it('brings the project tab forward and asks the view to open the PR dialog', () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const createPr = registrations.find((r) => r.command.id === 'create-pr')!
      createPr.handler(ctx('/repo'))

      expect(showSelf).toHaveBeenCalledWith('project')
      expect(broadcast).toHaveBeenCalledWith('git:open-pr-dialog', { repoRoot: '/repo' })
    })

    it('does nothing when ctx.repoRoot is null', () => {
      const { api, registrations, showSelf, broadcast } = buildMockApi()
      registerQuickActionCommands(api as never)

      const createPr = registrations.find((r) => r.command.id === 'create-pr')!
      createPr.handler(ctx(null))

      expect(showSelf).not.toHaveBeenCalled()
      expect(broadcast).not.toHaveBeenCalled()
    })
  })
})
