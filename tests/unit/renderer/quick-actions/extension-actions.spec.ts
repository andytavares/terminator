import { describe, it, expect, vi } from 'vitest'
import {
  buildExtensionActions,
  type RegisteredCommand,
  type DeclaredCommand,
} from '../../../../src/renderer/quick-actions/extension-actions'
import type { ActionContext, QuickActionGroup } from '../../../../src/renderer/quick-actions/types'

const gitGroup: QuickActionGroup = { id: 'ext:git', mnemonic: 'g', label: 'Git', owner: 'git' }

function ctx(overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    projectId: 'p1',
    sessionId: 's1',
    repoRoot: '/repo',
    agentState: null,
    isAgentSession: false,
    surfaceOwner: null,
    ...overrides,
  }
}

function registered(overrides: Partial<RegisteredCommand> = {}): RegisteredCommand {
  return { key: 'git.push', extensionId: 'git', id: 'push', label: 'Push', ...overrides }
}

describe('buildExtensionActions', () => {
  it('groups a registered command under its extension group', () => {
    const actions = buildExtensionActions(
      { registered: [registered()], declared: [] },
      [gitGroup],
      { ctx: ctx(), execute: vi.fn() }
    )
    expect(actions[0]).toMatchObject({
      id: 'ext:git.command.push',
      group: 'ext:git',
      label: 'Push',
    })
  })

  it('falls back to "top" when the extension has no allocated group', () => {
    const actions = buildExtensionActions(
      { registered: [registered({ extensionId: 'other' })], declared: [] },
      [gitGroup],
      { ctx: ctx(), execute: vi.fn() }
    )
    expect(actions[0].group).toBe('top')
  })
})

describe('buildExtensionActions — disables a repo-required command with "No repository focused" when repoRoot is null', () => {
  it('disables a repo-required command with "No repository focused" when repoRoot is null', () => {
    const actions = buildExtensionActions(
      { registered: [registered({ requires: 'repo' })], declared: [] },
      [gitGroup],
      { ctx: ctx({ repoRoot: null }), execute: vi.fn() }
    )
    expect(actions[0].disabledReason).toBe('No repository focused')
  })

  it('disables a session-required command with "No terminal focused" when sessionId is null', () => {
    const actions = buildExtensionActions(
      { registered: [registered({ requires: 'session' })], declared: [] },
      [gitGroup],
      { ctx: ctx({ sessionId: null }), execute: vi.fn() }
    )
    expect(actions[0].disabledReason).toBe('No terminal focused')
  })

  it('calls execute with the command key and the given context', async () => {
    const execute = vi.fn()
    const c = ctx()
    const actions = buildExtensionActions(
      { registered: [registered()], declared: [] },
      [gitGroup],
      { ctx: c, execute }
    )
    await actions[0].run()
    expect(execute).toHaveBeenCalledWith('git.push', c)
  })
})

describe('buildExtensionActions — shows a dimmed action for a declared command the extension never registered', () => {
  it('shows a dimmed action for a declared command the extension never registered', () => {
    const declared: DeclaredCommand[] = [{ extensionId: 'git', id: 'pull', label: 'Pull' }]
    const actions = buildExtensionActions({ registered: [], declared }, [gitGroup], {
      ctx: ctx(),
      execute: vi.fn(),
    })
    expect(actions[0]).toMatchObject({
      label: 'Pull',
      disabledReason: 'Extension did not register this command',
    })
  })

  it('does not duplicate a declared command that is also registered', () => {
    const declared: DeclaredCommand[] = [{ extensionId: 'git', id: 'push', label: 'Push' }]
    const actions = buildExtensionActions({ registered: [registered()], declared }, [gitGroup], {
      ctx: ctx(),
      execute: vi.fn(),
    })
    expect(actions).toHaveLength(1)
    expect(actions[0].disabledReason).toBeUndefined()
  })
})

describe('buildExtensionActions — shows a dimmed action for a declared command the extension never registered — converts renderer-registered commands into top-level actions without mnemonics', () => {
  it('converts renderer-registered commands into top-level actions without mnemonics', async () => {
    const action = vi.fn()
    const actions = buildExtensionActions(
      { registered: [], declared: [], renderer: [{ id: 'core.foo', label: 'Foo', action }] },
      [gitGroup],
      { ctx: ctx(), execute: vi.fn() }
    )
    expect(actions[0]).toMatchObject({ id: 'renderer:core.foo', group: 'top', label: 'Foo' })
    expect(actions[0].mnemonic).toBeUndefined()
    await actions[0].run()
    expect(action).toHaveBeenCalled()
  })
})
