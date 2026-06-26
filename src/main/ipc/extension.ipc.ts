import { ipcMain } from 'electron'
import type { ExtensionHost } from '../extensions/extension-host.js'
import { globalRegistry } from '../extensions/api.js'
import {
  getAllExtensionSettings,
  setExtensionSetting,
} from '../storage/extension-settings-store.js'

export function registerExtensionHandlers(
  extensionHost: ExtensionHost,
  broadcast?: (channel: string, data: unknown) => void
): void {
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

  ipcMain.handle('extension:uninstall', async (_event, { id }) => {
    const removed = await extensionHost.uninstall(id)
    if (!removed) return { error: 'NOT_FOUND' }
    return { ok: true }
  })

  ipcMain.handle('extension:reload', async (_event, { id }) => {
    const result = await extensionHost.reload(id)
    if (!('error' in result)) {
      broadcast?.('extension:renderer-reload', { id })
    }
    return result
  })

  ipcMain.handle('extension:get-settings-schemas', () => {
    const schemas = [...globalRegistry.settingsSections.entries()].map(([key, schema]) => ({
      extensionId: key.replace(/\.settings$/, ''),
      label: schema.label,
      properties: schema.properties,
    }))
    return { schemas }
  })

  ipcMain.handle('extension:get-settings-values', () => {
    return { values: getAllExtensionSettings() }
  })

  ipcMain.handle('extension:update-setting', (_event, { key, value }) => {
    setExtensionSetting(key, value)
    return { ok: true }
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

  ipcMain.handle('extension:get-commands', () => {
    const commands = [...globalRegistry.commandContributions.entries()].map(([key, cmd]) => ({
      key,
      id: cmd.id,
      label: cmd.label,
      description: cmd.description,
      shortcut: cmd.shortcut,
      category: cmd.category,
    }))
    return { commands }
  })

  ipcMain.on('extension:execute-command', (_event, { key }: { key: string }) => {
    const handler = globalRegistry.commandHandlers.get(key)
    if (handler) handler()
  })
}
