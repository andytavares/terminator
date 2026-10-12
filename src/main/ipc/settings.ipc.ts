import { z } from 'zod'
import { registerInvokeTable, invokeSpec, noPayload } from './invoke-table.js'
import {
  getGlobalSettings,
  updateGlobalSettings,
  getWorkspaceSettings,
  updateWorkspaceSettings,
} from '../storage/settings-store.js'

const PatchSchema = z.record(z.string(), z.unknown())
const invalid = { error: 'VALIDATION_ERROR' }

export function registerSettingsHandlers(): void {
  registerInvokeTable([
    invokeSpec({
      channel: 'settings:get-global',
      schema: noPayload,
      invalid,
      run: () => ({ settings: getGlobalSettings() }),
    }),
    invokeSpec({
      channel: 'settings:update-global',
      schema: z.object({ patch: PatchSchema }),
      invalid,
      run: ({ patch }) => ({ settings: updateGlobalSettings(patch) }),
    }),
    invokeSpec({
      channel: 'settings:get-workspace',
      schema: z.object({ workspaceId: z.string().min(1) }),
      invalid,
      run: ({ workspaceId }) => ({ settings: getWorkspaceSettings(workspaceId) }),
    }),
    invokeSpec({
      channel: 'settings:update-workspace',
      schema: z.object({ workspaceId: z.string().min(1), patch: PatchSchema }),
      invalid,
      run: ({ workspaceId, patch }) => ({ settings: updateWorkspaceSettings(workspaceId, patch) }),
    }),
  ])
}
