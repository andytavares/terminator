import { z } from 'zod'
import { onChannel } from './channel-registrar.js'
import { registerInvokeTable, invokeSpec, noPayload, type InvokeSpec } from './invoke-table.js'
import type { ExtensionHost } from '../extensions/extension-host.js'
import type { ExtensionViewHost } from '../extensions/extension-view-host.js'
import {
  listExtensionSettingsSections,
  listExtensionCommands,
  executeExtensionCommand,
  isExtensionCommandRegistered,
} from '../extensions/api.js'
import type { CommandContext } from '@terminator/extension-sdk'
import {
  getAllExtensionSettings,
  setExtensionSetting,
} from '../storage/extension-settings-store.js'

const invalid = { error: 'VALIDATION_ERROR' }
const IdSchema = z.object({ id: z.string().min(1) })
const CommandContextSchema = z.object({
  projectId: z.string().nullable(),
  sessionId: z.string().nullable(),
  repoRoot: z.string().nullable(),
})
const PanelBoundsSchema = z.object({
  extensionId: z.string().min(1),
  viewParam: z.string(),
  bounds: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  visible: z.boolean(),
  repoRoot: z.string().nullable().optional(),
})

export function registerExtensionHandlers(
  extensionHost: ExtensionHost,
  broadcast?: (channel: string, data: unknown) => void,
  getViewHost: () => ExtensionViewHost | null = () => null
): void {
  registerInvokeTable([
    ...lifecycleSpecs(extensionHost, broadcast),
    ...settingsAndCommandSpecs(),
    invokeSpec({
      channel: 'extension:update-panel-bounds',
      schema: PanelBoundsSchema,
      invalid,
      run: async ({ extensionId, viewParam, bounds, visible, repoRoot }) => {
        // A view talks to its extension's backend as soon as it loads.
        await extensionHost.whenActivated(extensionId)
        await getViewHost()?.updatePanelBounds(
          () => extensionHost.listExtensions().find((e) => e.id === extensionId),
          extensionId,
          viewParam,
          bounds,
          visible,
          repoRoot
        )
      },
    }),
  ])

  onChannel(
    'extension:execute-command',
    (_event, { key, ctx }: { key: string; ctx: CommandContext }) => {
      void executeExtensionCommand(key, ctx)
    }
  )
}

function lifecycleSpecs(
  extensionHost: ExtensionHost,
  broadcast?: (channel: string, data: unknown) => void
): InvokeSpec[] {
  return [
    invokeSpec({
      channel: 'extension:list',
      schema: noPayload,
      invalid,
      run: () => ({ extensions: extensionHost.listExtensions() }),
    }),
    invokeSpec({
      channel: 'extension:install',
      schema: z.object({ directoryPath: z.string().min(1) }),
      invalid,
      run: ({ directoryPath }) => extensionHost.load(directoryPath),
    }),
    invokeSpec({
      channel: 'extension:toggle',
      schema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
      invalid,
      run: async ({ id, enabled }) => {
        const extension = await extensionHost.toggle(id, enabled)
        if (!extension) return { error: 'NOT_FOUND' }
        return { extension }
      },
    }),
    invokeSpec({
      channel: 'extension:uninstall',
      schema: IdSchema,
      invalid,
      run: async ({ id }) => {
        const removed = await extensionHost.uninstall(id)
        if (!removed) return { error: 'NOT_FOUND' }
        return { ok: true }
      },
    }),
    invokeSpec({
      channel: 'extension:reload',
      schema: IdSchema,
      invalid,
      run: async ({ id }) => {
        const result = await extensionHost.reload(id)
        if (!('error' in result)) broadcast?.('extension:renderer-reload', { id })
        return result
      },
    }),
  ]
}

function settingsAndCommandSpecs(): InvokeSpec[] {
  return [
    invokeSpec({
      channel: 'extension:get-settings-schemas',
      schema: noPayload,
      invalid,
      run: () => ({ schemas: listExtensionSettingsSections() }),
    }),
    invokeSpec({
      channel: 'extension:get-settings-values',
      schema: noPayload,
      invalid,
      run: () => ({ values: getAllExtensionSettings() }),
    }),
    invokeSpec({
      channel: 'extension:update-setting',
      schema: z.object({ key: z.string().min(1), value: z.unknown() }),
      invalid,
      run: ({ key, value }) => {
        setExtensionSetting(key, value)
        return { ok: true }
      },
    }),
    invokeSpec({
      channel: 'extension:get-commands',
      schema: noPayload,
      invalid,
      run: () => ({ commands: listExtensionCommands() }),
    }),
    // Not on the remote allowlist: an extension view runs another extension's command locally.
    invokeSpec({
      channel: 'extension:run-command',
      schema: z.object({
        key: z.string().min(1),
        args: z.unknown(),
        ctx: CommandContextSchema.optional(),
      }),
      invalid,
      run: ({ key, args, ctx }) =>
        executeExtensionCommand(
          key,
          ctx ?? { projectId: null, sessionId: null, repoRoot: null },
          args
        ),
    }),
    invokeSpec({
      channel: 'extension:has-command',
      schema: z.object({ key: z.string().min(1) }),
      invalid: false,
      run: ({ key }) => isExtensionCommandRegistered(key),
    }),
  ]
}
