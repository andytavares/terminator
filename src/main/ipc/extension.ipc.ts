import { ipcMain } from 'electron'
import type { ExtensionHost } from '../extensions/extension-host.js'
import { globalRegistry } from '../extensions/api.js'

export function registerExtensionHandlers(extensionHost: ExtensionHost): void {
  ipcMain.handle('extension:list', () => {
    return { extensions: extensionHost.listExtensions() }
  })

  ipcMain.handle('extension:install', async (_event, { directoryPath }) => {
    return extensionHost.load(directoryPath)
  })

  ipcMain.handle('extension:toggle', async (_event, { id, enabled }) => {
    const extension = await extensionHost.toggle(id, enabled)
    if (!extension) return { error: 'NOT_FOUND' }
    return { extension }
  })

  ipcMain.handle('extension:get-sidebar-items', () => {
    const items = [...globalRegistry.sidebarItems.values()]
    return {
      items: items.map((item) => ({
        id: item.id,
        label: item.label,
        tooltip: item.tooltip,
      })),
    }
  })

  ipcMain.handle('extension:get-context-menu-items', (_event, { target }: { target: string }) => {
    const items = [...globalRegistry.contextMenuItems.values()]
      .filter((entry) => entry.target === target)
      .map((entry) => ({
        id: entry.item.id,
        label: entry.item.label,
      }))
    return { items }
  })

  ipcMain.on(
    'extension:context-menu-click',
    (
      _event,
      { target, itemId, targetId }: { target: string; itemId: string; targetId: string }
    ) => {
      for (const [key, entry] of globalRegistry.contextMenuItems) {
        if (entry.target === target && entry.item.id === itemId && key.includes(itemId)) {
          entry.item.onClick(targetId)
          break
        }
      }
    }
  )
}
