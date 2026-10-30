import { describe, it, expect, vi } from 'vitest'
import {
  GlobalSettingsSchema,
  WorkspaceSettingsSchema,
  DEFAULT_GLOBAL_SETTINGS,
} from '../../../src/shared/schemas/settings.schema'

// The defaults a settings file written before a field existed is read with. Only these are
// pinned: a stored file depends on each one.

const validGlobal = {
  appearance: { theme: 'dark' as const },
  terminal: { scrollbackLimit: 10000, defaultShell: '/bin/zsh' },
  git: { worktreeBaseDir: '' },
  ui: { hasSeenWelcome: false },
}

const validWorkspace = {
  workspaceId: '550e8400-e29b-41d4-a716-446655440000',
  overrides: {},
  extensions: {},
}

describe('GlobalSettingsSchema defaults for fields an older file lacks', () => {
  it('fills the ui section', () => {
    const { ui: _ui, ...withoutUi } = validGlobal
    expect(GlobalSettingsSchema.parse(withoutUi).ui).toEqual({
      hasSeenWelcome: false,
      editor: '',
      hideSidebarOnHome: true,
      showUsageTab: true,
      homeLayout: 'tasks',
    })
  })

  it('fills the editor with empty, which means detect', () => {
    const parsed = GlobalSettingsSchema.parse({ ...validGlobal, ui: { hasSeenWelcome: true } })
    expect(parsed.ui.editor).toBe('')
  })

  it('fills the notification targets', () => {
    expect(GlobalSettingsSchema.parse(validGlobal).notifications).toEqual({
      defaultTargets: ['system', 'center', 'toast'],
      overrides: {},
    })
  })
})

describe('GlobalSettingsSchema defaults for the sidebar and quick actions', () => {
  it('fills the sidebar stale threshold with two hours, in the parsed and the shipped settings', () => {
    const parsed = GlobalSettingsSchema.parse({ ...DEFAULT_GLOBAL_SETTINGS, sidebar: undefined })
    expect(parsed.sidebar.staleAfterMs).toBe(7_200_000)
    expect(DEFAULT_GLOBAL_SETTINGS.sidebar.staleAfterMs).toBe(7_200_000)
  })

  it('fills the quick actions with empty lists, in the parsed and the shipped settings', () => {
    const empty = { pins: [], usage: [], directUse: [], custom: [] }
    expect(GlobalSettingsSchema.parse(validGlobal).quickActions).toEqual(empty)
    expect(DEFAULT_GLOBAL_SETTINGS.quickActions).toEqual(empty)
  })
})

/** The shell the settings ship with when `SHELL` is `shell`, or unset when `undefined`. */
async function shippedShell(shell: string | undefined): Promise<string> {
  const original = process.env.SHELL
  if (shell === undefined) delete process.env.SHELL
  else process.env.SHELL = shell
  vi.resetModules()
  try {
    const module = await import('../../../src/shared/schemas/settings.schema')
    return module.DEFAULT_GLOBAL_SETTINGS.terminal.defaultShell
  } finally {
    process.env.SHELL = original
  }
}

describe('DEFAULT_GLOBAL_SETTINGS shell', () => {
  it('uses process.env.SHELL when set', async () => {
    expect(await shippedShell('/bin/fish')).toBe('/bin/fish')
  })

  it('falls back to /bin/zsh when SHELL is not set', async () => {
    expect(await shippedShell(undefined)).toBe('/bin/zsh')
  })
})

describe('WorkspaceSettingsSchema defaults', () => {
  it('fills overrides and extensions with empty objects', () => {
    const parsed = WorkspaceSettingsSchema.parse({ workspaceId: validWorkspace.workspaceId })
    expect(parsed.overrides).toEqual({})
    expect(parsed.extensions).toEqual({})
  })
})
