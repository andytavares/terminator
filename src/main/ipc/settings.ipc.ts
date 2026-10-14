import { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import {
  getGlobalSettings,
  updateGlobalSettings,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from '../storage/settings-store.js'

const PatchSchema = z.record(z.string(), z.unknown())
const invalid = { error: 'VALIDATION_ERROR' }

// The payload schema only says "a patch"; whether the merged result is valid
// settings is known after the merge, so the store's ZodError means the same.
function invalidSettings(e: unknown): unknown {
  if (e instanceof z.ZodError) return invalid
  throw e
}

export function registerSettingsHandlers(): void {
  registerInvokeTable([
    defineChannel({
      channel: 'settings:get-global',
      schema: noPayload,
      invalid,
      run: () => ({ settings: getGlobalSettings() }),
    }),
    defineChannel({
      channel: 'settings:update-global',
      schema: z.object({ patch: PatchSchema }),
      invalid,
      run: ({ patch }) => ({ settings: updateGlobalSettings(patch) }),
      onError: invalidSettings,
    }),
    defineChannel({
      channel: 'settings:get-workspace',
      schema: z.object({ workspaceId: z.string().min(1) }),
      invalid,
      run: ({ workspaceId }) => ({ settings: getWorkspaceSettings(workspaceId) }),
    }),
    defineChannel({
      channel: 'settings:update-workspace',
      schema: z.object({ workspaceId: z.string().min(1), patch: PatchSchema }),
      invalid,
      run: ({ workspaceId, patch }) => ({ settings: updateWorkspaceSettings(workspaceId, patch) }),
      onError: invalidSettings,
    }),
  ])
}
