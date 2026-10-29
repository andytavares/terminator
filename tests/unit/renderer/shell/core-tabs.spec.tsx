import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCoreTabs } from '../../../../src/renderer/shell/core-tabs'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

let openUsage: (() => void) | undefined

beforeEach(() => {
  recordUse.mockClear()
  openUsage = undefined
  useExtensionRegistry.setState({ activeGlobalTabId: null })
  useSettingsStore.setState({ globalSettings: null })
  window.electronAPI = {
    extensionEvents: {
      onMenuOpenUsage: (handler: () => void) => {
        openUsage = handler
        return () => {}
      },
    },
  } as unknown as typeof window.electronAPI
})

const usageTab = () => useExtensionRegistry.getState().globalTabs.get('core.usage')
const setShowUsageTab = (showUsageTab: boolean) =>
  useSettingsStore.setState({
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      ui: { ...DEFAULT_GLOBAL_SETTINGS.ui, showUsageTab },
    },
  })

describe('useCoreTabs — the Usage tab in the app band', () => {
  it('shows a Usage tab in the app band before settings load', () => {
    renderHook(() => useCoreTabs(() => {}))
    expect(usageTab()).toMatchObject({ label: 'Usage', hidden: false })
  })

  it('hides the Usage tab when ui.showUsageTab is off, and shows it again when it is on', () => {
    setShowUsageTab(false)
    renderHook(() => useCoreTabs(() => {}))
    expect(usageTab()?.hidden).toBe(true)
    act(() => setShowUsageTab(true))
    expect(usageTab()?.hidden).toBe(false)
  })

  it('keeps Usage open when its tab is hidden from the band', () => {
    renderHook(() => useCoreTabs(() => {}))
    act(() => useExtensionRegistry.getState().setActiveGlobalTab('core.usage'))
    act(() => setShowUsageTab(false))
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.usage')
  })
})

describe('useCoreTabs — the Usage menu item', () => {
  it('shows Usage and counts a menu use when the Window menu item is chosen', () => {
    renderHook(() => useCoreTabs(() => {}))
    act(() => openUsage?.())
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.usage')
    expect(recordUse).toHaveBeenCalledWith('core.open-usage', 'menu')
  })
})
