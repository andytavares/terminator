import { z } from 'zod'
import { onChannel } from './channel-registrar.js'
import { defineChannel, type ChannelSpec } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import type { ExtensionHost } from '../extensions/extension-host.js'
import {
  listExtensionSettingsSections,
  listExtensionCommands,
  executeExtensionCommand,
  isExtensionCommandRegistered,
} from '../extensions/api.js'
import type { CommandContext } from '@terminator/extension-sdk'
import { ViaSchema, type Via } from '../../shared/schemas/usage.schema.js'
import {
  getAllExtensionSettings,
  setExtensionSetting,
  setWorkspaceExtensionSetting,
} from '../storage/extension-settings-store.js'

const invalid = { error: 'VALIDATION_ERROR' }
const IdSchema = z.object({ id: z.string().min(1) })
const CommandContextSchema = z.object({
  projectId: z.string().nullable(),
  sessionId: z.string().nullable(),
  repoRoot: z.string().nullable(),
})
/** The extension that registered `key` as `workspaceScoped`, if one did. */
function workspaceScopedOwner(key: string): string | undefined {
  return listExtensionSettingsSections().find(
    (section) => section.properties[key]?.workspaceScoped === true
  )?.extensionId
}

const settingsChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'extension:get-settings-schemas',
    schema: noPayload,
    invalid,
    run: () => ({ schemas: listExtensionSettingsSections() }),
  }),
  defineChannel({
    channel: 'extension:get-settings-values',
    schema: noPayload,
    invalid,
    run: () => ({ values: getAllExtensionSettings() }),
  }),
  defineChannel({
    channel: 'extension:update-setting',
    schema: z.object({ key: z.string().min(1), value: z.unknown().optional() }),
    invalid,
    run: ({ key, value }) => {
      setExtensionSetting(key, value)
      return { ok: true }
    },
  }),
  // Workspace Settings: one workspace's own value; no value hands it back to the global one.
  defineChannel({
    channel: 'extension:update-workspace-setting',
    schema: z.object({
      workspaceId: z.string().min(1),
      key: z.string().min(1),
      value: z.unknown().optional(),
    }),
    invalid,
    run: ({ workspaceId, key, value }) => {
      const extensionId = workspaceScopedOwner(key)
      if (extensionId === undefined) return { error: 'NOT_WORKSPACE_SCOPED' }
      return { settings: setWorkspaceExtensionSetting(workspaceId, { extensionId, key, value }) }
    },
  }),
]

const commandChannels: ChannelSpec[] = [
  defineChannel({
    channel: 'extension:get-commands',
    schema: noPayload,
    invalid,
    run: () => ({ commands: listExtensionCommands() }),
  }),
  // Not on the remote allowlist: an extension view runs another extension's command locally.
  defineChannel({
    channel: 'extension:run-command',
    schema: z.object({
      key: z.string().min(1),
      args: z.unknown().optional(),
      ctx: CommandContextSchema.optional(),
      // A view runs another extension's command from one of its own controls.
      via: ViaSchema.default('click'),
    }),
    invalid,
    run: ({ key, args, ctx, via }) =>
      executeExtensionCommand(key, ctx ?? { projectId: null, sessionId: null, repoRoot: null }, {
        args,
        via,
      }),
  }),
  defineChannel({
    channel: 'extension:has-command',
    schema: z.object({ key: z.string().min(1) }),
    invalid: false,
    run: ({ key }) => isExtensionCommandRegistered(key),
  }),
]

function catalogueChannels(extensionHost: ExtensionHost): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'extension:list',
      schema: noPayload,
      invalid,
      run: () => ({ extensions: extensionHost.listAll() }),
    }),
    defineChannel({
      channel: 'extension:install',
      schema: z.object({ directoryPath: z.string().min(1) }),
      invalid,
      run: ({ directoryPath }) => extensionHost.load(directoryPath),
    }),
  ]
}

function enablementChannels(extensionHost: ExtensionHost): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'extension:toggle',
      schema: z.object({ id: z.string().min(1), enabled: z.boolean() }),
      invalid,
      run: async ({ id, enabled }) => {
        const extension = await extensionHost.setEnabled(id, enabled)
        if (!extension) return { error: 'NOT_FOUND' }
        return { extension }
      },
    }),
    defineChannel({
      channel: 'extension:uninstall',
      schema: IdSchema,
      invalid,
      run: async ({ id }) => {
        const removed = await extensionHost.uninstallExtension(id)
        if (!removed) return { error: 'NOT_FOUND' }
        return { ok: true }
      },
    }),
  ]
}

function reloadChannel(
  extensionHost: ExtensionHost,
  broadcast: (channel: string, data: unknown) => void
): ChannelSpec {
  return defineChannel({
    channel: 'extension:reload',
    schema: IdSchema,
    invalid,
    run: async ({ id }) => {
      const result = await extensionHost.reloadExtension(id)
      if (!('error' in result)) broadcast('extension:renderer-reload', { id })
      return result
    },
  })
}

export function registerExtensionHandlers(
  extensionHost: ExtensionHost,
  broadcast: (channel: string, data: unknown) => void
): void {
  registerInvokeTable([
    ...catalogueChannels(extensionHost),
    ...enablementChannels(extensionHost),
    reloadChannel(extensionHost, broadcast),
    ...settingsChannels,
    ...commandChannels,
  ])

  onChannel(
    'extension:execute-command',
    (
      _event,
      { key, ctx, args, via }: { key: string; ctx: CommandContext; args?: unknown; via?: Via }
    ) => {
      void executeExtensionCommand(key, ctx, { args, via: via ?? 'app' })
    }
  )
}
