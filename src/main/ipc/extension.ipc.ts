import { handleChannel, onChannel } from './channel-registrar.js'
import type { ExtensionHost } from '../extensions/extension-host.js'
import {
  listExtensionSettingsSections,
  listExtensionCommands,
  executeExtensionCommand,
  isExtensionCommandRegistered,
} from '../extensions/api.js'
import type { CommandContext } from '../extensions/api.js'
import {
  getAllExtensionSettings,
  setExtensionSetting,
} from '../storage/extension-settings-store.js'

export function registerExtensionHandlers(
  extensionHost: ExtensionHost,
  broadcast?: (channel: string, data: unknown) => void
): void {
  handleChannel('extension:list', () => {
    return { extensions: extensionHost.listExtensions() }
  })

  handleChannel('extension:install', async (_event, { directoryPath }) => {
    return extensionHost.load(directoryPath)
  })

  handleChannel('extension:toggle', async (_event, { id, enabled }) => {
    const extension = await extensionHost.toggle(id, enabled)
    if (!extension) return { error: 'NOT_FOUND' }
    return { extension }
  })

  handleChannel('extension:uninstall', async (_event, { id }) => {
    const removed = await extensionHost.uninstall(id)
    if (!removed) return { error: 'NOT_FOUND' }
    return { ok: true }
  })

  handleChannel('extension:reload', async (_event, { id }) => {
    const result = await extensionHost.reload(id)
    if (!('error' in result)) {
      broadcast?.('extension:renderer-reload', { id })
    }
    return result
  })

  handleChannel('extension:get-settings-schemas', () => {
    return { schemas: listExtensionSettingsSections() }
  })

  handleChannel('extension:get-settings-values', () => {
    return { values: getAllExtensionSettings() }
  })

  handleChannel('extension:update-setting', (_event, { key, value }) => {
    setExtensionSetting(key, value)
    return { ok: true }
  })

  handleChannel('extension:get-commands', () => {
    return { commands: listExtensionCommands() }
  })

  onChannel(
    'extension:execute-command',
    (_event, { key, ctx }: { key: string; ctx: CommandContext }) => {
      void executeExtensionCommand(key, ctx)
    }
  )

  // Not on the remote allowlist: an extension view runs another extension's command locally.
  handleChannel(
    'extension:run-command',
    (_event, { key, args, ctx }: { key: string; args?: unknown; ctx?: CommandContext }) =>
      executeExtensionCommand(
        key,
        ctx ?? { projectId: null, sessionId: null, repoRoot: null },
        args
      )
  )

  handleChannel('extension:has-command', (_event, { key }: { key: string }) =>
    isExtensionCommandRegistered(key)
  )
}
