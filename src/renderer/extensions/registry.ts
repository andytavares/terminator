import { create } from 'zustand'
import type { ComponentType, ReactNode } from 'react'

export interface GlobalTabRegistration {
  id: string
  label: string
  icon?: ReactNode
  component: ComponentType<Record<string, never>>
  permanent?: boolean
  badge?: number
  /** When true the tab is not shown as an icon in the WorkspaceRail. */
  hidden?: boolean
}

export interface WorkspaceTabRegistration {
  id: string
  label: string
  icon?: ReactNode
  /** Component reads active workspace from useWorkspaceStore internally. */
  component: ComponentType<Record<string, never>>
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

export interface SidebarButtonRegistration {
  id: string
  label: string
  icon?: ReactNode
  /** Called when the user clicks the button in the ProjectsPanel */
  action(): void
}

interface ExtensionRegistry {
  sidebarPanels: Map<string, SidebarPanelRegistration>
  projectTabs: Map<string, ProjectTabRegistration>
  globalTabs: Map<string, GlobalTabRegistration>
  workspaceTabs: Map<string, WorkspaceTabRegistration>
  windowViews: Map<string, ComponentType<{ repoRoot: string | null }>>
  sidebarButtons: SidebarButtonRegistration[]
  activeGlobalTabId: string | null
  activeWorkspaceTabId: string | null
  keyboardShortcuts: KeyboardShortcutRegistration[]
  commands: CommandRegistration[]
  overlays: ComponentType[]
  openPanels: Set<string>
  activeProjectTabId: string | null
  pendingNavigations: Map<string, unknown>

  registerSidebarPanel(panel: SidebarPanelRegistration): () => void
  registerProjectTab(tab: ProjectTabRegistration): () => void
  registerGlobalTab(tab: GlobalTabRegistration): () => void
  registerWorkspaceTab(tab: WorkspaceTabRegistration): () => void
  registerWindowView(id: string, component: ComponentType<{ repoRoot: string | null }>): void
  registerOverlay(component: ComponentType): () => void
  registerKeyboardShortcut(shortcut: KeyboardShortcutRegistration): () => void
  registerCommand(command: CommandRegistration): () => void
  registerSidebarButton(button: SidebarButtonRegistration): () => void
  updateCommand(id: string, patch: Partial<Omit<CommandRegistration, 'id' | 'action'>>): void
  updateGlobalTab(id: string, patch: Partial<Omit<GlobalTabRegistration, 'id' | 'component'>>): void
  togglePanel(panelId: string): void
  setActiveProjectTab(tabId: string | null): void
  setActiveGlobalTab(tabId: string | null): void
  setActiveWorkspaceTab(tabId: string | null): void
  setActiveGlobalTabWithNavigation(tabId: string, navigationData: unknown): void
  clearPendingNavigation(extensionId: string): void
}

export type ExtensionRendererAPI = Pick<
  ExtensionRegistry,
  | 'registerGlobalTab'
  | 'registerWorkspaceTab'
  | 'registerSidebarPanel'
  | 'registerProjectTab'
  | 'registerWindowView'
  | 'registerOverlay'
  | 'registerKeyboardShortcut'
  | 'registerCommand'
  | 'updateGlobalTab'
  | 'updateCommand'
>

export const useExtensionRegistry = create<ExtensionRegistry>((set) => ({
  sidebarPanels: new Map(),
  projectTabs: new Map(),
  globalTabs: new Map(),
  workspaceTabs: new Map(),
  windowViews: new Map(),
  sidebarButtons: [],
  activeGlobalTabId: null,
  activeWorkspaceTabId: null,
  keyboardShortcuts: [],
  commands: [],
  overlays: [],
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

  registerWorkspaceTab(tab) {
    set((s) => {
      const tabs = new Map(s.workspaceTabs)
      tabs.set(tab.id, tab)
      return { workspaceTabs: tabs }
    })
    return () =>
      set((s) => {
        const tabs = new Map(s.workspaceTabs)
        tabs.delete(tab.id)
        const next: Partial<ExtensionRegistry> = { workspaceTabs: tabs }
        if (s.activeWorkspaceTabId === tab.id) next.activeWorkspaceTabId = null
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

  registerOverlay(component) {
    set((s) => ({ overlays: [...s.overlays, component] }))
    return () => set((s) => ({ overlays: s.overlays.filter((c) => c !== component) }))
  },

  registerCommand(command) {
    set((s) => ({ commands: [...s.commands, command] }))
    return () => set((s) => ({ commands: s.commands.filter((c) => c !== command) }))
  },

  registerSidebarButton(button) {
    set((s) => ({ sidebarButtons: [...s.sidebarButtons, button] }))
    return () =>
      set((s) => ({ sidebarButtons: s.sidebarButtons.filter((b) => b.id !== button.id) }))
  },

  updateCommand(id, patch) {
    set((s) => ({
      commands: s.commands.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  },

  updateGlobalTab(id, patch) {
    set((s) => {
      const tabs = new Map(s.globalTabs)
      const existing = tabs.get(id)
      if (existing) tabs.set(id, { ...existing, ...patch })
      return { globalTabs: tabs }
    })
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
    set({
      activeGlobalTabId: tabId,
      activeWorkspaceTabId: null,
      ...(tabId !== null ? { activeProjectTabId: null } : {}),
    })
  },

  setActiveWorkspaceTab(tabId) {
    set({
      activeWorkspaceTabId: tabId,
      activeGlobalTabId: null,
      ...(tabId !== null ? { activeProjectTabId: null } : {}),
    })
  },

  setActiveGlobalTabWithNavigation(tabId, navigationData) {
    set((s) => {
      const pendingNavigations = new Map(s.pendingNavigations)
      pendingNavigations.set(tabId, navigationData)
      return {
        activeGlobalTabId: tabId,
        activeProjectTabId: null,
        activeWorkspaceTabId: null,
        pendingNavigations,
      }
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
    metaOrCtrl: parts.some(
      (p) => p === 'CmdOrCtrl' || p === 'CommandOrControl' || p === 'Cmd' || p === 'Ctrl'
    ),
    shift: parts.some((p) => p === 'Shift'),
    alt: parts.some((p) => p === 'Alt' || p === 'Option'),
    key,
  }
}

export function matchesAccelerator(e: KeyboardEvent, accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator)
  const metaOrCtrl = e.metaKey || e.ctrlKey
  // On macOS, Option (Alt) changes e.key to a dead/special character (e.g. Opt+Shift+T → 'ˇ').
  // Fall back to e.code ('KeyT' → 't') so Alt-combos match correctly on all platforms.
  const keyCode = e.code?.toLowerCase().replace(/^key/, '') ?? ''
  const keyMatch = e.key.toLowerCase() === parsed.key || (e.altKey && keyCode === parsed.key)
  return (
    metaOrCtrl === parsed.metaOrCtrl &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt &&
    keyMatch
  )
}
