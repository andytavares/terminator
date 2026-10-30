import { describe, it, expect } from 'vitest'
import { GlobalSettingsSchema } from '../../../../src/shared/schemas/settings.schema'
import { defaultGlobalSettings } from '../../../../src/shared/settings-defaults'

const base = defaultGlobalSettings('/bin/zsh')

describe('GlobalSettingsSchema — ui.hideSidebarOnHome', () => {
  it('is on when the settings have never set it', () => {
    expect(
      GlobalSettingsSchema.parse({ ...base, ui: { hasSeenWelcome: true } }).ui.hideSidebarOnHome
    ).toBe(true)
  })

  it('is on in the shipped defaults', () => {
    expect(defaultGlobalSettings('/bin/zsh').ui.hideSidebarOnHome).toBe(true)
  })

  it('keeps an explicit off', () => {
    const parsed = GlobalSettingsSchema.parse({
      ...base,
      ui: { hasSeenWelcome: true, hideSidebarOnHome: false },
    })
    expect(parsed.ui.hideSidebarOnHome).toBe(false)
  })
})

describe('GlobalSettingsSchema — ui.homeLayout', () => {
  it('is Tasks when the settings have never set it', () => {
    expect(
      GlobalSettingsSchema.parse({ ...base, ui: { hasSeenWelcome: true } }).ui.homeLayout
    ).toBe('tasks')
  })

  it('is Tasks in the shipped defaults', () => {
    expect(defaultGlobalSettings('/bin/zsh').ui.homeLayout).toBe('tasks')
  })

  it('keeps Classic and rejects a layout that does not exist', () => {
    const ui = { hasSeenWelcome: true }
    expect(
      GlobalSettingsSchema.parse({ ...base, ui: { ...ui, homeLayout: 'classic' } }).ui.homeLayout
    ).toBe('classic')
    expect(
      GlobalSettingsSchema.safeParse({ ...base, ui: { ...ui, homeLayout: 'board' } }).success
    ).toBe(false)
  })
})

describe('GlobalSettingsSchema — ui.showUsageTab', () => {
  it('is on when the settings have never set it', () => {
    expect(
      GlobalSettingsSchema.parse({ ...base, ui: { hasSeenWelcome: true } }).ui.showUsageTab
    ).toBe(true)
  })

  it('keeps an explicit off', () => {
    const parsed = GlobalSettingsSchema.parse({
      ...base,
      ui: { hasSeenWelcome: true, showUsageTab: false },
    })
    expect(parsed.ui.showUsageTab).toBe(false)
  })
})
