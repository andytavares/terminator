import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { KNOWN_EDITORS, launchArgvFor, pickEditor, type KnownEditor } from './known-editors.js'

/**
 * Finding and launching an editor. The boundary half: everything here touches
 * the file system or spawns a process, which is why the choosing lives next
 * door in `known-editors.ts` where it can be tested without either.
 */

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Is this command on PATH and executable? Cheaper and safer than shelling to `which`. */
async function onPath(command: string): Promise<boolean> {
  const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean)
  for (const dir of dirs) {
    try {
      await access(join(dir, command), constants.X_OK)
      return true
    } catch {
      /* keep looking */
    }
  }
  return false
}

async function isInstalled(editor: KnownEditor): Promise<boolean> {
  if (editor.cli && (await onPath(editor.cli))) return true
  if (editor.macApp && process.platform === 'darwin') {
    return exists(`/Applications/${editor.macApp}.app`)
  }
  return false
}

/**
 * Which editor this machine will use, or null if it has none we recognise.
 *
 * Probed on every call rather than cached: an editor installed while the app is
 * running should not need a restart to show up, and the probe is a handful of
 * `access` calls.
 */
export async function detectEditor(configuredId?: string): Promise<KnownEditor | null> {
  const installed = new Set<string>()
  await Promise.all(
    KNOWN_EDITORS.map(async (editor) => {
      if (await isInstalled(editor)) installed.add(editor.id)
    })
  )
  return pickEditor((id) => installed.has(id), configuredId)
}

export type OpenResult = { ok: true; editor: string } | { error: string }

/**
 * Opens a folder in the chosen editor.
 *
 * `execFile`, never `exec`: the folder is an argument rather than part of a
 * shell string, so a path containing a space or a semicolon cannot become a
 * second command. The command itself is one of a fixed list, never user text.
 */
export async function openInEditor(folderPath: string, configuredId?: string): Promise<OpenResult> {
  if (!(await exists(folderPath))) return { error: 'FOLDER_NOT_FOUND' }

  const editor = await detectEditor(configuredId)
  if (editor === null) return { error: 'NO_EDITOR_FOUND' }

  const { command, args } = launchArgvFor(editor, folderPath)
  return new Promise<OpenResult>((resolve) => {
    execFile(command, args, (err) => {
      resolve(err ? { error: err.message } : { ok: true, editor: editor.name })
    })
  })
}
