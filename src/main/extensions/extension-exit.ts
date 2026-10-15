import type { Extension } from '../../shared/types/index.js'

/** Fallback used by the renderer loader when a sidebarPanel omits `view`. */
const DEFAULT_SIDEBAR_VIEW = 'sidebar'

/** The surface an exit request came from. */
export interface ExtensionSurface {
  extensionId: string
  viewParam: string
}

export interface ExtensionExitDeps {
  listExtensions(): Extension[]
  focusMainRenderer(): void
  send(channel: 'extension:exit-to-terminal', payload: ExtensionExitPayload): void
}

interface ExtensionExitPayload {
  extensionId: string
  /**
   * Set when the exit came from a sidebar panel. Those sit beside the terminal
   * instead of replacing it, so the renderer closes just that panel; a
   * full-screen surface clears the tab slots instead.
   */
  sidebarPanelId: string | null
}

/**
 * Attributes an exit request to the extension surface that sent it and asks the
 * main renderer to dismiss it.
 */
export function routeExtensionExitRequest(
  surface: ExtensionSurface,
  deps: ExtensionExitDeps
): boolean {
  const ext = deps.listExtensions().find((e) => e.id === surface.extensionId)
  const sidebarPanel = ext?.contributes?.sidebarPanel
  const isSidebar =
    !!sidebarPanel && (sidebarPanel.view ?? DEFAULT_SIDEBAR_VIEW) === surface.viewParam

  deps.focusMainRenderer()
  deps.send('extension:exit-to-terminal', {
    extensionId: surface.extensionId,
    sidebarPanelId: isSidebar ? surface.extensionId : null,
  })
  return true
}
