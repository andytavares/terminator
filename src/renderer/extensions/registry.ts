import { create, type StoreApi } from 'zustand'
import type { ComponentType, ReactNode } from 'react'
import type { QuickActionGroup } from '../quick-actions/types'

export interface GlobalTabRegistration {
  id: string
  label: string
  icon?: ReactNode
  component: ComponentType<Record<string, never>>
  permanent?: boolean
  badge?: number
  /** What the badge counts, for a reader: the entry is named "<label>, <badgeLabel>" while badged. */
  badgeLabel?: string
  /** When true the tab is not shown as an icon in the WorkspaceRail. */
  hidden?: boolean
  /** Higher values sort later in the sidebar. Core tabs default to 0, extensions to 1. */
  sortOrder?: number
  /** Resolved manifest `view` param, used to tell this surface from the extension's others. */
  view?: string
}

export interface WorkspaceTabRegistration {
  id: string
  label: string
  icon?: ReactNode
  component: ComponentType<{ repoRoot?: string | null }>
  /** Resolved manifest `view` param, used to tell this surface from the extension's others. */
  view?: string
}

interface SidebarPanelRegistration {
  id: string
  label: string
  component: ComponentType<{ repoRoot: string | null; onClose: () => void }>
  defaultOpen?: boolean
  /** Resolved manifest `view` param, used to tell this surface from the extension's others. */
  view?: string
}

export interface ProjectTabRegistration {
  id: string
  label: string
  component: ComponentType<{ repoRoot: string | null }>
  /** Resolved manifest `view` param, used to tell this surface from the extension's others. */
  view?: string
}

interface KeyboardShortcutRegistration {
  /** Electron-style accelerator, e.g. "CmdOrCtrl+Shift+G" */
  accelerator: string
  action: () => void
  description?: string
}

interface CommandRegistration {
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
  workspaceTabs: Map<string, WorkspaceTabRegistration>
  windowViews: Map<string, ComponentType<{ repoRoot: string | null }>>
  activeGlobalTabId: string | null
  activeWorkspaceTabId: string | null
  keyboardShortcuts: KeyboardShortcutRegistration[]
  commands: CommandRegistration[]
  overlays: ComponentType[]
  openPanels: Set<string>
  activeProjectTabId: string | null
  pendingNavigations: Map<string, unknown>
  /** Quick Actions groups allocated to extensions at init, in load order (see `loader.ts`). */
  quickActionGroups: QuickActionGroup[]
  setQuickActionGroups(groups: QuickActionGroup[]): void

  registerSidebarPanel(panel: SidebarPanelRegistration): () => void
  registerProjectTab(tab: ProjectTabRegistration): () => void
  registerGlobalTab(tab: GlobalTabRegistration): () => void
  registerWorkspaceTab(tab: WorkspaceTabRegistration): () => void
  registerWindowView(id: string, component: ComponentType<{ repoRoot: string | null }>): void
  registerOverlay(component: ComponentType): () => void
  registerKeyboardShortcut(shortcut: KeyboardShortcutRegistration): () => void
  registerCommand(command: CommandRegistration): () => void
  updateCommand(id: string, patch: Partial<Omit<CommandRegistration, 'id' | 'action'>>): void
  updateGlobalTab(id: string, patch: Partial<Omit<GlobalTabRegistration, 'id' | 'component'>>): void
  togglePanel(panelId: string): void
  exitExtensionToTerminal(sidebarPanelId?: string): boolean
  dismissSurfaces(): boolean
  setActiveProjectTab(tabId: string | null): void
  setActiveGlobalTab(tabId: string | null): void
  setActiveWorkspaceTab(tabId: string | null): void
  setActiveGlobalTabWithNavigation(tabId: string, navigationData: unknown): void
  clearPendingNavigation(extensionId: string): void
}

// Core-contributed surfaces use this id prefix (see the sort weight in App.tsx).
// They are not extensions, so the Escape exit gesture leaves them alone.
const CORE_SURFACE_PREFIX = 'core.'

type SetRegistry = StoreApi<ExtensionRegistry>['setState']
type GetRegistry = StoreApi<ExtensionRegistry>['getState']
type Slice<Keys extends keyof ExtensionRegistry> = Pick<ExtensionRegistry, Keys>

function withEntry<Value>(map: Map<string, Value>, id: string, value: Value): Map<string, Value> {
  return new Map(map).set(id, value)
}

function withoutEntry<Value>(map: Map<string, Value>, id: string): Map<string, Value> {
  const next = new Map(map)
  next.delete(id)
  return next
}

/** The active id, or null when it is the one going away. */
const unlessGone = (active: string | null, id: string): string | null =>
  active === id ? null : active

function toggledIn(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function registerSidebarPanel(set: SetRegistry, panel: SidebarPanelRegistration): () => void {
  set((s) => {
    const open = new Set(s.openPanels)
    if (panel.defaultOpen) open.add(panel.id)
    return { sidebarPanels: withEntry(s.sidebarPanels, panel.id, panel), openPanels: open }
  })
  return () =>
    set((s) => {
      const open = new Set(s.openPanels)
      open.delete(panel.id)
      return { sidebarPanels: withoutEntry(s.sidebarPanels, panel.id), openPanels: open }
    })
}

/** The project, global and workspace tabs; removing one that is showing shows the terminal. */
function tabSlice(
  set: SetRegistry
): Slice<'registerProjectTab' | 'registerGlobalTab' | 'registerWorkspaceTab'> {
  return {
    registerProjectTab(tab) {
      set((s) => ({ projectTabs: withEntry(s.projectTabs, tab.id, tab) }))
      return () =>
        set((s) => ({
          projectTabs: withoutEntry(s.projectTabs, tab.id),
          activeProjectTabId: unlessGone(s.activeProjectTabId, tab.id),
        }))
    },
    registerGlobalTab(tab) {
      set((s) => ({ globalTabs: withEntry(s.globalTabs, tab.id, tab) }))
      return () =>
        set((s) => ({
          globalTabs: withoutEntry(s.globalTabs, tab.id),
          activeGlobalTabId: unlessGone(s.activeGlobalTabId, tab.id),
        }))
    },
    registerWorkspaceTab(tab) {
      set((s) => ({ workspaceTabs: withEntry(s.workspaceTabs, tab.id, tab) }))
      return () =>
        set((s) => ({
          workspaceTabs: withoutEntry(s.workspaceTabs, tab.id),
          activeWorkspaceTabId: unlessGone(s.activeWorkspaceTabId, tab.id),
        }))
    },
  }
}

/** Everything else an extension adds: panels, window views, overlays, shortcuts, commands. */
function contributionSlice(
  set: SetRegistry
): Slice<
  | 'registerSidebarPanel'
  | 'registerWindowView'
  | 'registerKeyboardShortcut'
  | 'registerOverlay'
  | 'registerCommand'
> {
  return {
    registerSidebarPanel: (panel) => registerSidebarPanel(set, panel),
    registerWindowView: (id, component) =>
      set((s) => ({ windowViews: withEntry(s.windowViews, id, component) })),
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
  }
}

function updateSlice(
  set: SetRegistry
): Slice<'setQuickActionGroups' | 'updateCommand' | 'updateGlobalTab' | 'togglePanel'> {
  return {
    setQuickActionGroups: (groups) => set({ quickActionGroups: groups }),
    updateCommand: (id, patch) =>
      set((s) => ({ commands: s.commands.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
    updateGlobalTab: (id, patch) =>
      set((s) => {
        const existing = s.globalTabs.get(id)
        if (!existing) return { globalTabs: new Map(s.globalTabs) }
        return { globalTabs: withEntry(s.globalTabs, id, { ...existing, ...patch }) }
      }),
    togglePanel: (panelId) => set((s) => ({ openPanels: toggledIn(s.openPanels, panelId) })),
  }
}

const isExitable = (id: string | null): boolean =>
  id !== null && !id.startsWith(CORE_SURFACE_PREFIX)

/**
 * Dismisses the extension surface the user is in so the terminal shows again.
 * `sidebarPanelId` is passed only when the exit came from a sidebar panel —
 * those sit beside the terminal rather than replacing it, so closing the panel
 * is the whole exit. Everything else is a full-screen surface: clearing all
 * three tab slots at once lands on TerminalPane, which still holds the
 * project's activeSessionId, i.e. the session the user left.
 *
 * Returns false when there was nothing to exit, so the caller can skip
 * re-focusing the terminal.
 */
function exitExtensionToTerminal(
  set: SetRegistry,
  get: GetRegistry,
  sidebarPanelId: string | undefined
): boolean {
  const s = get()
  if (sidebarPanelId) {
    if (!s.openPanels.has(sidebarPanelId)) return false
    s.togglePanel(sidebarPanelId)
    return true
  }
  const tabs = [s.activeGlobalTabId, s.activeWorkspaceTabId, s.activeProjectTabId]
  if (!tabs.some(isExitable)) return false
  const keep = (id: string | null): string | null => (isExitable(id) ? null : id)
  set((prev) => ({
    activeGlobalTabId: keep(prev.activeGlobalTabId),
    activeWorkspaceTabId: keep(prev.activeWorkspaceTabId),
    activeProjectTabId: keep(prev.activeProjectTabId),
  }))
  return true
}

/**
 * Dismisses whatever is showing in place of the terminal, core screens such
 * as Home and Overview included — the user has moved on to something else.
 * Sidebar panels sit beside the terminal rather than over it, so they stay.
 */
function dismissSurfaces(set: SetRegistry, get: GetRegistry): boolean {
  const s = get()
  if (!s.activeGlobalTabId && !s.activeWorkspaceTabId && !s.activeProjectTabId) return false
  set({ activeGlobalTabId: null, activeWorkspaceTabId: null, activeProjectTabId: null })
  return true
}

/** Which surface shows in place of the terminal, and leaving it. */
function navigationSlice(
  set: SetRegistry,
  get: GetRegistry
): Slice<
  | 'exitExtensionToTerminal'
  | 'dismissSurfaces'
  | 'setActiveProjectTab'
  | 'setActiveGlobalTab'
  | 'setActiveWorkspaceTab'
> {
  return {
    exitExtensionToTerminal: (sidebarPanelId) => exitExtensionToTerminal(set, get, sidebarPanelId),
    dismissSurfaces: () => dismissSurfaces(set, get),
    setActiveProjectTab: (tabId) => set({ activeProjectTabId: tabId }),
    setActiveGlobalTab: (tabId) =>
      set({
        activeGlobalTabId: tabId,
        activeWorkspaceTabId: null,
        ...(tabId !== null ? { activeProjectTabId: null } : {}),
      }),
    setActiveWorkspaceTab: (tabId) =>
      set({
        activeWorkspaceTabId: tabId,
        activeGlobalTabId: null,
        ...(tabId !== null ? { activeProjectTabId: null } : {}),
      }),
  }
}

/** Data an extension's global tab reads once it shows, keyed by extension. */
function pendingNavigationSlice(
  set: SetRegistry
): Slice<'setActiveGlobalTabWithNavigation' | 'clearPendingNavigation'> {
  return {
    setActiveGlobalTabWithNavigation: (tabId, navigationData) =>
      set((s) => ({
        activeGlobalTabId: tabId,
        activeProjectTabId: null,
        activeWorkspaceTabId: null,
        pendingNavigations: withEntry(s.pendingNavigations, tabId, navigationData),
      })),
    clearPendingNavigation: (extensionId) =>
      set((s) => ({ pendingNavigations: withoutEntry(s.pendingNavigations, extensionId) })),
  }
}

// One store built from slices: https://zustand.docs.pmnd.rs/guides/slices-pattern
export const useExtensionRegistry = create<ExtensionRegistry>((set, get) => ({
  sidebarPanels: new Map(),
  projectTabs: new Map(),
  globalTabs: new Map(),
  workspaceTabs: new Map(),
  windowViews: new Map(),
  activeGlobalTabId: null,
  activeWorkspaceTabId: null,
  keyboardShortcuts: [],
  commands: [],
  overlays: [],
  openPanels: new Set(),
  activeProjectTabId: null,
  pendingNavigations: new Map(),
  quickActionGroups: [],
  ...tabSlice(set),
  ...contributionSlice(set),
  ...updateSlice(set),
  ...navigationSlice(set, get),
  ...pendingNavigationSlice(set),
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
