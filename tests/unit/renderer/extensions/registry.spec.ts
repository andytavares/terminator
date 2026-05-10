import { describe, it, expect, beforeEach } from 'vitest'
import {
  useExtensionRegistry,
  matchesAccelerator,
} from '../../../../src/renderer/extensions/registry'

function resetStore() {
  useExtensionRegistry.setState({
    sidebarPanels: new Map(),
    projectTabs: new Map(),
    keyboardShortcuts: [],
    openPanels: new Set(),
    activeProjectTabId: null,
  })
}

describe('useExtensionRegistry', () => {
  beforeEach(() => {
    resetStore()
  })

  describe('registerSidebarPanel', () => {
    it('adds panel to sidebarPanels map', () => {
      const panel = { id: 'git', label: 'Git', component: {} as any }
      useExtensionRegistry.getState().registerSidebarPanel(panel)
      expect(useExtensionRegistry.getState().sidebarPanels.has('git')).toBe(true)
    })

    it('opens panel when defaultOpen is true', () => {
      const panel = { id: 'git', label: 'Git', component: {} as any, defaultOpen: true }
      useExtensionRegistry.getState().registerSidebarPanel(panel)
      expect(useExtensionRegistry.getState().openPanels.has('git')).toBe(true)
    })

    it('does not open panel when defaultOpen is false', () => {
      const panel = { id: 'git', label: 'Git', component: {} as any, defaultOpen: false }
      useExtensionRegistry.getState().registerSidebarPanel(panel)
      expect(useExtensionRegistry.getState().openPanels.has('git')).toBe(false)
    })

    it('returns dispose function that removes the panel', () => {
      const panel = { id: 'git', label: 'Git', component: {} as any }
      const dispose = useExtensionRegistry.getState().registerSidebarPanel(panel)
      dispose()
      expect(useExtensionRegistry.getState().sidebarPanels.has('git')).toBe(false)
    })

    it('dispose also removes panel from openPanels', () => {
      const panel = { id: 'git', label: 'Git', component: {} as any, defaultOpen: true }
      const dispose = useExtensionRegistry.getState().registerSidebarPanel(panel)
      dispose()
      expect(useExtensionRegistry.getState().openPanels.has('git')).toBe(false)
    })
  })

  describe('registerProjectTab', () => {
    it('adds tab to projectTabs map', () => {
      const tab = { id: 'pr-review', label: 'PR Review', component: {} as any }
      useExtensionRegistry.getState().registerProjectTab(tab)
      expect(useExtensionRegistry.getState().projectTabs.has('pr-review')).toBe(true)
    })

    it('returns dispose function that removes the tab', () => {
      const tab = { id: 'pr-review', label: 'PR Review', component: {} as any }
      const dispose = useExtensionRegistry.getState().registerProjectTab(tab)
      dispose()
      expect(useExtensionRegistry.getState().projectTabs.has('pr-review')).toBe(false)
    })

    it('clears activeProjectTabId when active tab is disposed', () => {
      const tab = { id: 'pr-review', label: 'PR Review', component: {} as any }
      const dispose = useExtensionRegistry.getState().registerProjectTab(tab)
      useExtensionRegistry.setState({ activeProjectTabId: 'pr-review' })
      dispose()
      expect(useExtensionRegistry.getState().activeProjectTabId).toBeNull()
    })

    it('does not clear activeProjectTabId when a different tab is disposed', () => {
      const tab = { id: 'pr-review', label: 'PR Review', component: {} as any }
      const dispose = useExtensionRegistry.getState().registerProjectTab(tab)
      useExtensionRegistry.setState({ activeProjectTabId: 'other-tab' })
      dispose()
      expect(useExtensionRegistry.getState().activeProjectTabId).toBe('other-tab')
    })
  })

  describe('registerKeyboardShortcut', () => {
    it('adds shortcut to keyboardShortcuts array', () => {
      const shortcut = { accelerator: 'CmdOrCtrl+Shift+G', action: () => {} }
      useExtensionRegistry.getState().registerKeyboardShortcut(shortcut)
      expect(useExtensionRegistry.getState().keyboardShortcuts).toHaveLength(1)
      expect(useExtensionRegistry.getState().keyboardShortcuts[0].accelerator).toBe(
        'CmdOrCtrl+Shift+G'
      )
    })

    it('returns dispose function that removes the shortcut', () => {
      const shortcut = { accelerator: 'CmdOrCtrl+Shift+G', action: () => {} }
      const dispose = useExtensionRegistry.getState().registerKeyboardShortcut(shortcut)
      dispose()
      expect(useExtensionRegistry.getState().keyboardShortcuts).toHaveLength(0)
    })

    it('only removes the exact shortcut instance, not others', () => {
      const sc1 = { accelerator: 'CmdOrCtrl+G', action: () => {} }
      const sc2 = { accelerator: 'CmdOrCtrl+H', action: () => {} }
      const dispose1 = useExtensionRegistry.getState().registerKeyboardShortcut(sc1)
      useExtensionRegistry.getState().registerKeyboardShortcut(sc2)
      dispose1()
      const remaining = useExtensionRegistry.getState().keyboardShortcuts
      expect(remaining).toHaveLength(1)
      expect(remaining[0].accelerator).toBe('CmdOrCtrl+H')
    })
  })

  describe('togglePanel', () => {
    it('opens closed panel', () => {
      useExtensionRegistry.getState().togglePanel('git')
      expect(useExtensionRegistry.getState().openPanels.has('git')).toBe(true)
    })

    it('closes open panel', () => {
      useExtensionRegistry.setState({ openPanels: new Set(['git']) })
      useExtensionRegistry.getState().togglePanel('git')
      expect(useExtensionRegistry.getState().openPanels.has('git')).toBe(false)
    })
  })

  describe('setActiveProjectTab', () => {
    it('sets activeProjectTabId', () => {
      useExtensionRegistry.getState().setActiveProjectTab('pr-review')
      expect(useExtensionRegistry.getState().activeProjectTabId).toBe('pr-review')
    })

    it('sets activeProjectTabId to null', () => {
      useExtensionRegistry.setState({ activeProjectTabId: 'pr-review' })
      useExtensionRegistry.getState().setActiveProjectTab(null)
      expect(useExtensionRegistry.getState().activeProjectTabId).toBeNull()
    })
  })
})

// ─── matchesAccelerator ────────────────────────────────────────────────────────

describe('matchesAccelerator', () => {
  function makeEvent(overrides: Partial<KeyboardEvent>): KeyboardEvent {
    return {
      key: '',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...overrides,
    } as KeyboardEvent
  }

  it('matches CmdOrCtrl+Shift+G with Ctrl held on non-Mac', () => {
    const event = makeEvent({ key: 'g', ctrlKey: true, shiftKey: true })
    expect(matchesAccelerator(event, 'CmdOrCtrl+Shift+G')).toBe(true)
  })

  it('matches CmdOrCtrl+Shift+G with Meta held on Mac', () => {
    const event = makeEvent({ key: 'g', metaKey: true, shiftKey: true })
    expect(matchesAccelerator(event, 'CmdOrCtrl+Shift+G')).toBe(true)
  })

  it('does not match when key differs', () => {
    const event = makeEvent({ key: 'h', ctrlKey: true, shiftKey: true })
    expect(matchesAccelerator(event, 'CmdOrCtrl+Shift+G')).toBe(false)
  })

  it('does not match when shift is required but not held', () => {
    const event = makeEvent({ key: 'g', ctrlKey: true })
    expect(matchesAccelerator(event, 'CmdOrCtrl+Shift+G')).toBe(false)
  })

  it('does not match when no modifier is held but accelerator requires one', () => {
    const event = makeEvent({ key: 'g' })
    expect(matchesAccelerator(event, 'CmdOrCtrl+G')).toBe(false)
  })

  it('matches accelerator without shift modifier', () => {
    const event = makeEvent({ key: 'k', ctrlKey: true })
    expect(matchesAccelerator(event, 'CmdOrCtrl+K')).toBe(true)
  })

  it('matches Alt+F4 style shortcut', () => {
    const event = makeEvent({ key: 'f4', altKey: true })
    expect(matchesAccelerator(event, 'Alt+F4')).toBe(true)
  })

  it('is case-insensitive for key comparison', () => {
    const event = makeEvent({ key: 'G', ctrlKey: true, shiftKey: true })
    expect(matchesAccelerator(event, 'CmdOrCtrl+Shift+G')).toBe(true)
  })
})
