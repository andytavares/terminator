import { describe, it, expect, vi, beforeEach } from 'vitest'

// This spec checks the IPC payload, so it runs the real recorder (packages/test-support/setup.ts mocks it).
vi.unmock('../../../../src/usage/record')
import { renderHook, act } from '@testing-library/react'
import { recordDirectShortcut, useMenuEvents } from '../../../../src/shell/main-events'
import { useSettingsStore } from '../../../../src/stores/settings.store'
import { useBugReportStore } from '../../../../src/stores/bug-report.store'
import type { ElectronAPI } from '../../../../../core-shared/src/electron-api/api-type'
import { resetStore } from '../../../../../test-support/src/renderer-stores'
import { installElectronApi, pushedEvent } from '../../../../../test-support/src/electron-api'

vi.mock('../../../../src/terminal/breakout', () => ({
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

describe('useMenuEvents — Report a Bug', () => {
  it('opens a bug report, counted as a use via the menu', () => {
    const reportBug = pushedEvent<[]>()
    useBugReportStore.setState(useBugReportStore.getInitialState())
    installElectronApi({
      usage: { recordUse },
      extensionEvents: {},
      bugReport: { onMenuReportBug: reportBug.addListener },
    })
    renderHook(() =>
      useMenuEvents({ openSettings: vi.fn(), openAbout: vi.fn(), toggleSidebar: vi.fn() })
    )

    act(() => reportBug.deliver())

    expect(useBugReportStore.getState().isOpen).toBe(true)
    expect(recorded()).toEqual([{ feature: 'core.report-bug', via: 'menu' }])
  })
})

describe('useMenuEvents — the browser remote', () => {
  it('subscribes to the rest when bug reports have no menu event there', () => {
    const openSettings = pushedEvent<[]>()
    // The browser remote has the bug report status and details, but no menu.
    installElectronApi({
      usage: { recordUse },
      extensionEvents: { onMenuOpenSettings: openSettings.addListener },
      bugReport: { status: vi.fn() },
    })

    renderHook(() =>
      useMenuEvents({ openSettings: vi.fn(), openAbout: vi.fn(), toggleSidebar: vi.fn() })
    )

    expect(openSettings.listening).toBe(true)
  })
})
