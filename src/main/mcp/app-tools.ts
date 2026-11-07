import type { QuietUpdateCheck } from '../app-updater.js'
import { toolMarks, type McpToolDef, type ToolProvider } from './tool-types.js'

// Tools about the Terminator app itself (ADR 145): its updates and its main window.

const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {} }
/** Long enough for the answer to reach Claude before the app quits. */
const RESTART_DELAY_MS = 1000

interface AppToolDeps {
  checkForUpdate: () => Promise<QuietUpdateCheck>
  downloadedUpdate: () => string | null
  quitAndInstall: () => void
  showWindow: () => void
}

const APP_TOOLS = [
  {
    name: 'check_for_update',
    description: 'Checks GitHub Releases for a newer Terminator and downloads it.',
    destructive: false,
  },
  {
    name: 'install_update',
    description:
      'Restarts Terminator into the downloaded update. This closes every terminal and agent.',
    destructive: true,
  },
  {
    name: 'show_window',
    description: 'Shows and focuses the Terminator main window.',
    destructive: false,
  },
] as const

type AppToolName = (typeof APP_TOOLS)[number]['name']

function installUpdate(deps: AppToolDeps): { restarting: string } {
  const version = deps.downloadedUpdate()
  if (version === null) throw new Error('No update is downloaded. Run check_for_update first.')
  setTimeout(deps.quitAndInstall, RESTART_DELAY_MS).unref()
  return { restarting: version }
}

export function appTools(deps: AppToolDeps): ToolProvider {
  const calls: Record<AppToolName, () => Promise<unknown>> = {
    check_for_update: deps.checkForUpdate,
    install_update: async () => installUpdate(deps),
    show_window: async () => {
      deps.showWindow()
      return { shown: true }
    },
  }
  return {
    tools: () =>
      APP_TOOLS.map(
        ({ name, description, destructive }): McpToolDef => ({
          name,
          description,
          inputSchema: EMPTY_OBJECT_SCHEMA,
          ...toolMarks({ destructive, readOnly: false }),
          call: calls[name],
        })
      ),
  }
}
