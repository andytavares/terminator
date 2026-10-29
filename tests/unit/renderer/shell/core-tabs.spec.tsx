import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCoreTabs } from '../../../../src/renderer/shell/core-tabs'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/usage/record', () => ({ recordUse }))

let openUsage: (() => void) | undefined

beforeEach(() => {
  recordUse.mockClear()
  openUsage = undefined
  useExtensionRegistry.setState({ activeGlobalTabId: null })
  window.electronAPI = {
    extensionEvents: {
      onMenuOpenUsage: (handler: () => void) => {
        openUsage = handler
        return () => {}
      },
    },
  } as unknown as typeof window.electronAPI
})

describe('useCoreTabs — the Usage tab', () => {
  it('registers a Usage tab that is kept out of the app band', () => {
    renderHook(() => useCoreTabs(() => {}))
    const tab = useExtensionRegistry.getState().globalTabs.get('core.usage')
    expect(tab).toMatchObject({ label: 'Usage', hidden: true })
  })

  it('shows Usage and counts a menu use when the Window menu item is chosen', () => {
    renderHook(() => useCoreTabs(() => {}))
    act(() => openUsage?.())
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.usage')
    expect(recordUse).toHaveBeenCalledWith('core.open-usage', 'menu')
  })
})
