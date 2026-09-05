/**
 * The editors Terminator knows how to open a folder in.
 *
 * Pure: this module chooses and builds an argv, and probes nothing. Whether an
 * editor is actually installed is the caller's question, passed in as a
 * predicate, which keeps the choosing exhaustively testable without a file
 * system.
 *
 * Order is preference order when several are installed. It is not a ranking of
 * editors — it puts the ones whose CLI is unambiguous first, since a CLI opens
 * a folder in an existing window rather than launching a second copy of the app.
 */
export interface KnownEditor {
  id: string
  /** What the menu item says: "Open in Cursor". */
  name: string
  /** Command on PATH, if the editor ships one. */
  cli?: string
  /** macOS application name, for `open -a`. */
  macApp?: string
}

export const KNOWN_EDITORS: readonly KnownEditor[] = [
  { id: 'cursor', name: 'Cursor', cli: 'cursor', macApp: 'Cursor' },
  { id: 'vscode', name: 'VS Code', cli: 'code', macApp: 'Visual Studio Code' },
  { id: 'windsurf', name: 'Windsurf', cli: 'windsurf', macApp: 'Windsurf' },
  { id: 'zed', name: 'Zed', cli: 'zed', macApp: 'Zed' },
  { id: 'sublime', name: 'Sublime Text', cli: 'subl', macApp: 'Sublime Text' },
  { id: 'webstorm', name: 'WebStorm', cli: 'webstorm', macApp: 'WebStorm' },
  { id: 'intellij', name: 'IntelliJ IDEA', cli: 'idea', macApp: 'IntelliJ IDEA' },
  { id: 'xcode', name: 'Xcode', macApp: 'Xcode' },
]

/**
 * Which editor to open a folder in.
 *
 * A configured id wins when that editor is actually installed — it is the
 * user's own answer to "my default editor". When it is not installed, or names
 * something we do not know, detection takes over rather than failing: an
 * editor that opens is better than an error about one that does not exist.
 */
export function pickEditor(
  isAvailable: (id: string) => boolean,
  configuredId: string | undefined
): KnownEditor | null {
  if (configuredId) {
    const configured = KNOWN_EDITORS.find((e) => e.id === configuredId)
    if (configured && isAvailable(configured.id)) return configured
  }
  return KNOWN_EDITORS.find((e) => isAvailable(e.id)) ?? null
}

/**
 * How to launch it, as a command and an argument list.
 *
 * Never a shell string. The folder is passed as one argument, so a directory
 * whose name contains a space, a quote or a semicolon is a directory name and
 * not a second command.
 */
export function launchArgvFor(
  editor: KnownEditor,
  folderPath: string
): { command: string; args: string[] } {
  if (editor.cli) return { command: editor.cli, args: [folderPath] }
  return { command: 'open', args: ['-a', editor.macApp as string, folderPath] }
}
