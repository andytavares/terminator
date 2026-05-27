import { create } from 'zustand'
import type { ComponentType } from 'react'

export interface GlobalTabRegistration {
  id: string
  label: string
  icon?: string
  component: ComponentType<Record<string, never>>
  permanent?: boolean
}

export interface SidebarPanelRegistration {
  id: string
  label: string
  component: ComponentType<{ repoRoot: string | null; onClose: () => void }>
  defaultOpen?: boolean
}

export interface ProjectTabRegistration {
  id: string
  label: string
  component: ComponentType<{ repoRoot: string | null }>
}

export interface KeyboardShortcutRegistration {
  /** Electron-style accelerator, e.g. "CmdOrCtrl+Shift+G" */
  accelerator: string
  action: () => void
  description?: string
}

export interface CommandRegistration {
  id: string
  label: string
  description?: string
  /** Display hint shown on the right, e.g. "⌘T" */
  shortcut?: string
  category?: string
  action(): void
}

interface ExtensionRegistry {
  sidebarPanels: Map<string, SidebarPanelRegistration>
  projectTabs: Map<string, ProjectTabRegistration>
  globalTabs: Map<string, GlobalTabRegistration>
  windowViews: Map<string, ComponentType<{ repoRoot: string | null }>>
  activeGlobalTabId: string | null
  keyboardShortcuts: KeyboardShortcutRegistration[]
  commands: CommandRegistration[]
  openPanels: Set<string>
  activeProjectTabId: string | null
  pendingNavigations: Map<string, unknown>

  registerSidebarPanel(panel: SidebarPanelRegistration): () => void
  registerProjectTab(tab: ProjectTabRegistration): () => void
  registerGlobalTab(tab: GlobalTabRegistration): () => void
  registerWindowView(id: string, component: ComponentType<{ repoRoot: string | null }>): void
  registerKeyboardShortcut(shortcut: KeyboardShortcutRegistration): () => void
  registerCommand(command: CommandRegistration): () => void
  togglePanel(panelId: string): void
  setActiveProjectTab(tabId: string | null): void
  setActiveGlobalTab(tabId: string | null): void
  setActiveGlobalTabWithNavigation(tabId: string, navigationData: unknown): void
  clearPendingNavigation(extensionId: string): void
}

export type ExtensionRendererAPI = Pick<
  ExtensionRegistry,
  | 'registerGlobalTab'
  | 'registerSidebarPanel'
  | 'registerProjectTab'
  | 'registerWindowView'
  | 'registerKeyboardShortcut'
  | 'registerCommand'
>

export const useExtensionRegistry = create<ExtensionRegistry>((set) => ({
  sidebarPanels: new Map(),
  projectTabs: new Map(),
  globalTabs: new Map(),
  windowViews: new Map(),
  activeGlobalTabId: null,
  keyboardShortcuts: [],
  commands: [],
  openPanels: new Set(),
  activeProjectTabId: null,
  pendingNavigations: new Map(),

  registerSidebarPanel(panel) {
    set((s) => {
      const panels = new Map(s.sidebarPanels)
      panels.set(panel.id, panel)
      const open = new Set(s.openPanels)
      if (panel.defaultOpen) open.add(panel.id)
      return { sidebarPanels: panels, openPanels: open }
    })
    return () =>
      set((s) => {
        const panels = new Map(s.sidebarPanels)
        panels.delete(panel.id)
        const open = new Set(s.openPanels)
        open.delete(panel.id)
        return { sidebarPanels: panels, openPanels: open }
      })
  },

  registerProjectTab(tab) {
    set((s) => {
      const tabs = new Map(s.projectTabs)
      tabs.set(tab.id, tab)
      return { projectTabs: tabs }
    })
    return () =>
      set((s) => {
        const tabs = new Map(s.projectTabs)
        tabs.delete(tab.id)
        const next: Partial<ExtensionRegistry> = { projectTabs: tabs }
        if (s.activeProjectTabId === tab.id) next.activeProjectTabId = null
        return next
      })
  },

  registerGlobalTab(tab) {
    set((s) => {
      const tabs = new Map(s.globalTabs)
      tabs.set(tab.id, tab)
      return { globalTabs: tabs }
    })
    return () =>
      set((s) => {
        const tabs = new Map(s.globalTabs)
        tabs.delete(tab.id)
        const next: Partial<ExtensionRegistry> = { globalTabs: tabs }
        if (s.activeGlobalTabId === tab.id) next.activeGlobalTabId = null
        return next
      })
  },

  registerWindowView(id, component) {
    set((s) => {
      const views = new Map(s.windowViews)
      views.set(id, component)
      return { windowViews: views }
    })
  },

  registerKeyboardShortcut(shortcut) {
    set((s) => ({ keyboardShortcuts: [...s.keyboardShortcuts, shortcut] }))
    return () =>
      set((s) => ({ keyboardShortcuts: s.keyboardShortcuts.filter((sc) => sc !== shortcut) }))
  },

  registerCommand(command) {
    set((s) => ({ commands: [...s.commands, command] }))
    return () => set((s) => ({ commands: s.commands.filter((c) => c !== command) }))
  },

  togglePanel(panelId) {
    set((s) => {
      const open = new Set(s.openPanels)
      if (open.has(panelId)) open.delete(panelId)
      else open.add(panelId)
      return { openPanels: open }
    })
  },

  setActiveProjectTab(tabId) {
    set({ activeProjectTabId: tabId })
  },

  setActiveGlobalTab(tabId) {
    set({ activeGlobalTabId: tabId, ...(tabId !== null ? { activeProjectTabId: null } : {}) })
  },

  setActiveGlobalTabWithNavigation(tabId, navigationData) {
    set((s) => {
      const pendingNavigations = new Map(s.pendingNavigations)
      pendingNavigations.set(tabId, navigationData)
      return { activeGlobalTabId: tabId, activeProjectTabId: null, pendingNavigations }
    })
  },

  clearPendingNavigation(extensionId) {
    set((s) => {
      const pendingNavigations = new Map(s.pendingNavigations)
      pendingNavigations.delete(extensionId)
      return { pendingNavigations }
    })
  },
}))

// ── Accelerator parser ────────────────────────────────────────────────────────
// Converts "CmdOrCtrl+Shift+G" → a predicate that matches a KeyboardEvent.

interface ParsedAccelerator {
  metaOrCtrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+')
  const key = parts[parts.length - 1].toLowerCase()
  return {
    metaOrCtrl: parts.some((p) => p === 'CmdOrCtrl' || p === 'Cmd' || p === 'Ctrl'),
    shift: parts.some((p) => p === 'Shift'),
    alt: parts.some((p) => p === 'Alt' || p === 'Option'),
    key,
  }
}

export function matchesAccelerator(e: KeyboardEvent, accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator)
  const metaOrCtrl = e.metaKey || e.ctrlKey
  return (
    metaOrCtrl === parsed.metaOrCtrl &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt &&
    e.key.toLowerCase() === parsed.key
  )
}
