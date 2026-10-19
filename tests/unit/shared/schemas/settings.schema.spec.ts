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
