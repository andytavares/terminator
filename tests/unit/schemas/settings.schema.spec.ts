import { describe, it, expect } from 'vitest'
import {
  GlobalSettingsSchema,
  WorkspaceSettingsSchema,
  ThemeSchema,
} from '../../../src/shared/schemas/settings.schema'

const validGlobal = {
  appearance: { theme: 'dark' as const },
  terminal: { scrollbackLimit: 10000, defaultShell: '/bin/zsh' },
  git: { worktreeBaseDir: '' },
  extensions: {},
  ui: { hasSeenWelcome: false },
}

describe('ThemeSchema', () => {
  it('accepts dark', () => {
    expect(ThemeSchema.safeParse('dark').success).toBe(true)
  })

  it('accepts light', () => {
    expect(ThemeSchema.safeParse('light').success).toBe(true)
  })

  it('rejects unknown theme value', () => {
    expect(ThemeSchema.safeParse('solarized').success).toBe(false)
  })

  it('rejects empty string', () => {
    expect(ThemeSchema.safeParse('').success).toBe(false)
  })
})

describe('GlobalSettingsSchema', () => {
  it('accepts a valid settings object', () => {
    const result = GlobalSettingsSchema.safeParse(validGlobal)
    expect(result.success).toBe(true)
  })

  it('accepts light theme', () => {
    const result = GlobalSettingsSchema.safeParse({ ...validGlobal, appearance: { theme: 'light' } })
    expect(result.success).toBe(true)
  })

  it('rejects unknown theme in appearance', () => {
    const result = GlobalSettingsSchema.safeParse({ ...validGlobal, appearance: { theme: 'monokai' } })
    expect(result.success).toBe(false)
  })

  it('rejects scrollbackLimit below minimum (1000)', () => {
    const result = GlobalSettingsSchema.safeParse({
      ...validGlobal,
      terminal: { scrollbackLimit: 999, defaultShell: '/bin/zsh' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects scrollbackLimit above maximum (100000)', () => {
    const result = GlobalSettingsSchema.safeParse({
      ...validGlobal,
      terminal: { scrollbackLimit: 100001, defaultShell: '/bin/zsh' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts scrollbackLimit at boundary minimum (1000)', () => {
    const result = GlobalSettingsSchema.safeParse({
      ...validGlobal,
      terminal: { scrollbackLimit: 1000, defaultShell: '/bin/zsh' },
    })
    expect(result.success).toBe(true)
  })

  it('accepts scrollbackLimit at boundary maximum (100000)', () => {
    const result = GlobalSettingsSchema.safeParse({
      ...validGlobal,
      terminal: { scrollbackLimit: 100000, defaultShell: '/bin/zsh' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects non-integer scrollbackLimit', () => {
    const result = GlobalSettingsSchema.safeParse({
      ...validGlobal,
      terminal: { scrollbackLimit: 10000.5, defaultShell: '/bin/zsh' },
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty defaultShell', () => {
    const result = GlobalSettingsSchema.safeParse({
      ...validGlobal,
      terminal: { scrollbackLimit: 10000, defaultShell: '' },
    })
    expect(result.success).toBe(false)
  })

  it('applies default value for ui field when omitted', () => {
    const { ui: _ui, ...withoutUi } = validGlobal
    const result = GlobalSettingsSchema.safeParse(withoutUi)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.ui).toEqual({ hasSeenWelcome: false })
    }
  })

  it('accepts extensions as empty record', () => {
    const result = GlobalSettingsSchema.safeParse({ ...validGlobal, extensions: {} })
    expect(result.success).toBe(true)
  })

  it('accepts extensions with nested unknown values', () => {
    const result = GlobalSettingsSchema.safeParse({
      ...validGlobal,
      extensions: { 'my-ext': { setting1: true, setting2: 42 } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing appearance field', () => {
    const { appearance: _a, ...without } = validGlobal
    const result = GlobalSettingsSchema.safeParse(without)
    expect(result.success).toBe(false)
  })

  it('rejects missing terminal field', () => {
    const { terminal: _t, ...without } = validGlobal
    const result = GlobalSettingsSchema.safeParse(without)
    expect(result.success).toBe(false)
  })

  it('rejects null as input', () => {
    expect(GlobalSettingsSchema.safeParse(null).success).toBe(false)
  })

  it('accepts hasSeenWelcome true', () => {
    const result = GlobalSettingsSchema.safeParse({ ...validGlobal, ui: { hasSeenWelcome: true } })
    expect(result.success).toBe(true)
  })

  it('rejects non-boolean hasSeenWelcome', () => {
    const result = GlobalSettingsSchema.safeParse({ ...validGlobal, ui: { hasSeenWelcome: 'yes' } })
    expect(result.success).toBe(false)
  })
})

describe('WorkspaceSettingsSchema', () => {
  const validWorkspace = {
    workspaceId: '550e8400-e29b-41d4-a716-446655440000',
    overrides: {},
    extensions: {},
  }

  it('accepts a valid workspace settings object', () => {
    expect(WorkspaceSettingsSchema.safeParse(validWorkspace).success).toBe(true)
  })

  it('rejects a non-UUID workspaceId', () => {
    const result = WorkspaceSettingsSchema.safeParse({ ...validWorkspace, workspaceId: 'not-a-uuid' })
    expect(result.success).toBe(false)
  })

  it('applies default empty object for overrides when omitted', () => {
    const { overrides: _o, ...without } = validWorkspace
    const result = WorkspaceSettingsSchema.safeParse(without)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.overrides).toEqual({})
    }
  })

  it('applies default empty record for extensions when omitted', () => {
    const { extensions: _e, ...without } = validWorkspace
    const result = WorkspaceSettingsSchema.safeParse(without)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.extensions).toEqual({})
    }
  })

  it('accepts overrides with appearance theme override', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      ...validWorkspace,
      overrides: { appearance: { theme: 'light' } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid theme in overrides.appearance', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      ...validWorkspace,
      overrides: { appearance: { theme: 'gruvbox' } },
    })
    expect(result.success).toBe(false)
  })

  it('accepts overrides.terminal with partial fields', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      ...validWorkspace,
      overrides: { terminal: { scrollbackLimit: 5000 } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects overrides.terminal.scrollbackLimit below minimum', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      ...validWorkspace,
      overrides: { terminal: { scrollbackLimit: 500 } },
    })
    expect(result.success).toBe(false)
  })

  it('accepts overrides.terminal.defaultShell override', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      ...validWorkspace,
      overrides: { terminal: { defaultShell: '/bin/fish' } },
    })
    expect(result.success).toBe(true)
  })

  it('rejects empty string for overrides.terminal.defaultShell', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      ...validWorkspace,
      overrides: { terminal: { defaultShell: '' } },
    })
    expect(result.success).toBe(false)
  })

  it('accepts overrides.git with worktreeBaseDir', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      ...validWorkspace,
      overrides: { git: { worktreeBaseDir: '/tmp/worktrees' } },
    })
    expect(result.success).toBe(true)
  })

  it('accepts null as workspaceId rejection check', () => {
    expect(WorkspaceSettingsSchema.safeParse(null).success).toBe(false)
  })

  it('accepts overrides as undefined (optional field)', () => {
    const result = WorkspaceSettingsSchema.safeParse({
      workspaceId: '550e8400-e29b-41d4-a716-446655440000',
      extensions: {},
    })
    expect(result.success).toBe(true)
  })
})
