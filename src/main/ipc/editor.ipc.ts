import { z } from 'zod'
import { registerInvokeTable, invokeSpec, noPayload } from './invoke-table.js'
import { detectEditor, openInEditor } from '../editor/open-in-editor.js'
import { getGlobalSettings } from '../storage/settings-store.js'

/**
 * Opening a folder in the user's editor.
 *
 * The renderer never names a command — it sends a folder and the main process
 * decides what to launch from a fixed list. That is deliberate: a channel that
 * took a command from the renderer would be a way to run anything.
 */
export function registerEditorHandlers(): void {
  registerInvokeTable([
    invokeSpec({
      channel: 'editor:detect',
      schema: noPayload,
      invalid: { editor: null },
      run: async () => {
        const editor = await detectEditor(configuredEditorId())
        return editor === null ? { editor: null } : { editor: { id: editor.id, name: editor.name } }
      },
    }),
    invokeSpec({
      channel: 'editor:open',
      schema: z.object({ folderPath: z.string().min(1) }),
      invalid: { error: 'VALIDATION_ERROR' },
      run: ({ folderPath }) => openInEditor(folderPath, configuredEditorId()),
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
