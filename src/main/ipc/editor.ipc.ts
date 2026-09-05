import { z } from 'zod'
import { handleChannel } from './channel-registrar.js'
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
  handleChannel('editor:detect', async () => {
    const editor = await detectEditor(configuredEditorId())
    return editor === null ? { editor: null } : { editor: { id: editor.id, name: editor.name } }
  })

  handleChannel('editor:open', async (_event, payload) => {
    const parsed = z.object({ folderPath: z.string().min(1) }).safeParse(payload)
    if (!parsed.success) return { error: 'VALIDATION_ERROR' }
    return openInEditor(parsed.data.folderPath, configuredEditorId())
  })
}

/** The user's choice, when they have made one. Absent means "detect". */
function configuredEditorId(): string | undefined {
  try {
    return getGlobalSettings().ui?.editor || undefined
  } catch {
    return undefined
  }
}
