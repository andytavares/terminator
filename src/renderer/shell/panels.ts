import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useExtensionRegistry } from '../extensions/registry'
import type { SurfaceRegistration } from '../quick-actions/surface-actions'

// The extension panels beside the terminal and every surface an extension
// registered: which are open, kept across launches, and opened on request.

const OPEN_PANELS_KEY = 'openPanels'

/** Opens `id` unless it is open already. */
function ensureOpen(id: string): void {
  const registry = useExtensionRegistry.getState()
  if (!registry.openPanels.has(id)) registry.togglePanel(id)
}

/** Restores the panels open at the last quit (once extensions have registered them), saves them
 * whenever they change, and tells main which are open. */
export function usePanelPersistence(openPanels: Set<string>): void {
  const panelsRestored = useRef(false)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(OPEN_PANELS_KEY)
      if (saved) (JSON.parse(saved) as string[]).forEach(ensureOpen)
    } catch {
      // ignore malformed data
    }
    panelsRestored.current = true
  }, [])

  // Skip localStorage until the restore has run, but always tell main.
  useEffect(() => {
    if (panelsRestored.current) {
      localStorage.setItem(OPEN_PANELS_KEY, JSON.stringify(Array.from(openPanels)))
    }
    for (const panelId of useExtensionRegistry.getState().sidebarPanels.keys()) {
      window.electronAPI.extensionEvents?.notifyPanelState?.(panelId, openPanels.has(panelId))
    }
  }, [openPanels])
}

/** Closes the open panels while an extension's project tab is showing, and reopens them when the
 * operator comes back to the terminal. */
export function usePanelsAroundProjectTabs(
  openPanels: Set<string>,
  activeProjectTabId: string | null
): void {
  // The latest open panels, read without re-running on every change.
  const openPanelsRef = useRef(openPanels)
  useEffect(() => {
    openPanelsRef.current = openPanels
  }, [openPanels])
  const savedPanelsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    const { togglePanel } = useExtensionRegistry.getState()
    if (activeProjectTabId !== null) {
      savedPanelsRef.current = new Set(openPanelsRef.current)
      openPanelsRef.current.forEach((panelId) => togglePanel(panelId))
    } else if (savedPanelsRef.current.size > 0) {
      savedPanelsRef.current.forEach((panelId) => {
        if (!openPanelsRef.current.has(panelId)) togglePanel(panelId)
      })
      savedPanelsRef.current = new Set()
    }
  }, [activeProjectTabId])
}

/** Every non-core surface an extension registered, generic over the four registration kinds —
 * core never names an extension (Constitution II). */
export function useSurfaces(): SurfaceRegistration[] {
  const { globalTabs, workspaceTabs, projectTabs, sidebarPanels } = useExtensionRegistry(
    useShallow((s) => ({
      globalTabs: s.globalTabs,
      workspaceTabs: s.workspaceTabs,
      projectTabs: s.projectTabs,
      sidebarPanels: s.sidebarPanels,
    }))
  )
  return useMemo(() => {
    const toSurface =
      (kind: SurfaceRegistration['kind'], fallbackView: string) =>
      (r: { id: string; view?: string; label: string }): SurfaceRegistration => ({
        extensionId: r.id,
        view: r.view ?? fallbackView,
        label: r.label,
        kind,
      })
    return [
      ...[...globalTabs.values()]
        .filter((t) => !t.id.startsWith('core.'))
        .map(toSurface('global', 'main')),
      ...[...workspaceTabs.values()].map(toSurface('workspace', 'workspace')),
      ...[...projectTabs.values()].map(toSurface('project', 'project')),
      ...[...sidebarPanels.values()].map(toSurface('sidebar', 'sidebar')),
    ]
  }, [globalTabs, workspaceTabs, projectTabs, sidebarPanels])
}

/** Brings a surface up: a tab becomes the active one, a panel opens. */
export function useShowSurface(): (toSurface: SurfaceRegistration) => void {
  return useCallback((toSurface: SurfaceRegistration) => {
    const registry = useExtensionRegistry.getState()
    if (toSurface.kind === 'global') registry.setActiveGlobalTab(toSurface.extensionId)
    else if (toSurface.kind === 'workspace') registry.setActiveWorkspaceTab(toSurface.extensionId)
    else if (toSurface.kind === 'project') registry.setActiveProjectTab(toSurface.extensionId)
    else ensureOpen(toSurface.extensionId)
  }, [])
}
