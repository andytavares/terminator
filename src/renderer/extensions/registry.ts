import { create } from 'zustand'
import type { ComponentType } from 'react'

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

interface ExtensionRegistry {
  sidebarPanels: Map<string, SidebarPanelRegistration>
  projectTabs: Map<string, ProjectTabRegistration>
  openPanels: Set<string>
  activeProjectTabId: string | null

  registerSidebarPanel(panel: SidebarPanelRegistration): () => void
  registerProjectTab(tab: ProjectTabRegistration): () => void
  togglePanel(panelId: string): void
  setActiveProjectTab(tabId: string | null): void
}

export const useExtensionRegistry = create<ExtensionRegistry>((set) => ({
  sidebarPanels: new Map(),
  projectTabs: new Map(),
  openPanels: new Set(),
  activeProjectTabId: null,

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
}))
