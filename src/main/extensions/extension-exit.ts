import type { Extension } from '../../shared/types/index.js'

/** Fallback used by the renderer loader when a sidebarPanel omits `view`. */
const DEFAULT_SIDEBAR_VIEW = 'sidebar'

export interface ExtensionExitDeps {
  findViewByWebContents(
    webContents: Electron.WebContents
  ): { extensionId: string; viewParam: string } | null
  listExtensions(): Extension[]
  focusMainRenderer(): void
  send(channel: 'extension:exit-to-terminal', payload: ExtensionExitPayload): void
}

export interface ExtensionExitPayload {
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
 * main renderer to dismiss it. Returns false when the sender is not a known
 * extension view, in which case nothing happens — an exit request can only come
 * from the core-owned webview preload, but the sender is still untrusted input.
 */
export function routeExtensionExitRequest(
  sender: Electron.WebContents,
  deps: ExtensionExitDeps
): boolean {
  const view = deps.findViewByWebContents(sender)
  if (!view) return false

  const ext = deps.listExtensions().find((e) => e.id === view.extensionId)
  const sidebarPanel = ext?.contributes?.sidebarPanel
  const isSidebar = !!sidebarPanel && (sidebarPanel.view ?? DEFAULT_SIDEBAR_VIEW) === view.viewParam

  deps.focusMainRenderer()
  deps.send('extension:exit-to-terminal', {
    extensionId: view.extensionId,
    sidebarPanelId: isSidebar ? view.extensionId : null,
  })
  return true
}
