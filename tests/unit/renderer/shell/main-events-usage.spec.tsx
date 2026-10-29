import { describe, it, expect, vi, beforeEach } from 'vitest'

// This spec checks the IPC payload, so it runs the real recorder (tests/setup.ts mocks it).
vi.unmock('../../../../src/renderer/usage/record')
import { renderHook, act } from '@testing-library/react'
import { recordDirectShortcut, useMenuEvents } from '../../../../src/renderer/shell/main-events'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import type { ElectronAPI } from '../../../../src/shared/electron-api/api-type'
import { resetStore } from '../../../support/renderer-stores'
import { installElectronApi, pushedEvent } from '../../../support/electron-api'

vi.mock('../../../../src/renderer/terminal/breakout', () => ({
  dockBack: vi.fn(),
  toggleBreakout: vi.fn(),
}))

const recordUse = vi.fn<ElectronAPI['usage']['recordUse']>(async () => ({ data: true as const }))
const recorded = () => recordUse.mock.calls.map(([record]) => record)

beforeEach(() => {
  vi.clearAllMocks()
  resetStore(useSettingsStore, { updateQuickActions: vi.fn(async () => {}) })
})

describe('recordDirectShortcut', () => {
  it('counts a press of the shortcut every time', () => {
    installElectronApi({ usage: { recordUse } })
    recordDirectShortcut('core.clear')
    recordDirectShortcut('core.clear')
    expect(recorded()).toEqual([
      { feature: 'core.clear', via: 'shortcut' },
      { feature: 'core.clear', via: 'shortcut' },
    ])
  })
})

describe('useMenuEvents', () => {
  it('counts a menu item as a use via the menu', () => {
    const openHome = pushedEvent<[]>()
    const openSettings = pushedEvent<[]>()
    installElectronApi({
      usage: { recordUse },
      extensionEvents: {
        onMenuOpenHome: openHome.addListener,
        onMenuOpenSettings: openSettings.addListener,
      },
    })
    renderHook(() =>
      useMenuEvents({ openSettings: vi.fn(), openAbout: vi.fn(), toggleSidebar: vi.fn() })
    )
    act(() => openHome.deliver())
    act(() => openSettings.deliver())
    expect(recorded()).toEqual([
      { feature: 'core.open-home', via: 'menu' },
      { feature: 'core.open-settings', via: 'menu' },
    ])
  })
})
