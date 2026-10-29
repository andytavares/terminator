import { z } from 'zod'
import { defineChannel } from '@terminator/extension-sdk'
import { registerInvokeTable, noPayload } from './invoke-table.js'
import { detectEditor, openInEditor } from '../editor/open-in-editor.js'
import { getGlobalSettings } from '../storage/settings-store.js'
import { recordUsage } from '../extensions/extension-usage.js'

/**
 * Opening a folder in the user's editor.
 *
 * The renderer never names a command — it sends a folder and the main process
 * decides what to launch from a fixed list. That is deliberate: a channel that
 * took a command from the renderer would be a way to run anything.
 */
export function registerEditorHandlers(): void {
  registerInvokeTable([
    defineChannel({
      channel: 'editor:detect',
      schema: noPayload,
      invalid: { editor: null },
      run: async () => {
        const editor = await detectEditor(configuredEditorId())
        return editor === null ? { editor: null } : { editor: { id: editor.id, name: editor.name } }
      },
    }),
    defineChannel({
      channel: 'editor:open',
      schema: z.object({ folderPath: z.string().min(1) }),
      invalid: { error: 'VALIDATION_ERROR' },
      run: async ({ folderPath }) => {
        const result = await openInEditor(folderPath, configuredEditorId())
        if ('ok' in result) recordUsage({ feature: 'core.editor.open', via: 'click' })
        return result
      },
    }),
  ])
}

/** The user's choice, when they have made one. Absent means "detect". */
function configuredEditorId(): string | undefined {
  try {
    return getGlobalSettings().ui?.editor || undefined
  } catch {
    return undefined
  }
}
