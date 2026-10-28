import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { contextFilePath } from './agent-context.js'
import { HOOK_MARKERS, reportDirectory } from '../agents/claude-hook.js'
import { shellQuote } from '@terminator/extension-sdk/node'
import { sessionContextDirectory } from './session-context.js'
import {
  putSessionStartHook,
  readClaudeSettings,
  runsCommandContaining,
  writeClaudeSettings,
  type ClaudeSettingsFile,
} from './claude-settings.js'

// How an agent session comes to already know the issue.
//
// A SessionStart hook, registered in the project's own
// `.claude/settings.local.json`, runs a script that prints the context file's
// markdown as `additionalContext`. That file is documented as the
// highest-precedence settings file and is gitignored by convention, and hooks
// from every level merge rather than replace.
//
// It is a hook rather than `claude --settings` at launch because FR-020
// requires a session the operator starts *by hand*, in an ordinary shell, to
// get the same context — and a launch flag only ever covers sessions this
// application starts.

// ── The owned block in the project's settings ────────────────────────────────

export interface HookCommandOptions {
  /** Electron's own binary, run in node mode. */
  execPath: string
  hookScriptPath: string
  projectId: string
}

/**
 * The command line the runtime executes.
 *
 * `ELECTRON_RUN_AS_NODE=1` with the application's own binary, so the hook needs
 * neither a `node` on `PATH` nor whatever a login shell happened to export.
 * Without it, the script would launch a second copy of the application.
 * @internal
 */
export function hookCommand(options: HookCommandOptions): string {
  return [
    'ELECTRON_RUN_AS_NODE=1',
    shellQuote(options.execPath),
    shellQuote(options.hookScriptPath),
    shellQuote(reportDirectory()),
    shellQuote(sessionContextDirectory()),
    shellQuote(contextFilePath(options.projectId)),
  ].join(' ')
}

function localSettingsPath(projectDir: string): string {
  return path.join(projectDir, '.claude', 'settings.local.json')
}

/**
 * Register the hook in a project's settings.
 *
 * Merge, never replace: an existing `SessionStart` array keeps every entry it
 * had, and `.claude/settings.json` — the shared, checked-in one — is never
 * read or written. Idempotent, so re-linking does not stack up copies.
 */
export async function installProjectHook(
  projectDir: string,
  options: HookCommandOptions
): Promise<void> {
  await putSessionStartHook(
    localSettingsPath(projectDir),
    [options.hookScriptPath, ...HOOK_MARKERS],
    hookCommand(options)
  )
}

/**
 * Remove it again, leaving the file as it was.
 *
 * If ours was the only thing in it, the file goes; if we created the `.claude`
 * directory for it, that goes too. SC-010 is "the project directory is
 * unchanged after detachment", and a leftover empty file fails that.
 */
export async function removeProjectHook(projectDir: string, hookScriptPath: string): Promise<void> {
  const settings = await readClaudeSettings(localSettingsPath(projectDir)).catch(() => null)
  if (settings === null) return

  const hooks = settings.hooks
  const sessionStart = Array.isArray(hooks?.SessionStart) ? hooks.SessionStart : []
  const remaining = sessionStart.filter(
    (entry) => !runsCommandContaining(entry, [hookScriptPath, ...HOOK_MARKERS])
  )
  if (remaining.length === sessionStart.length && sessionStart.length > 0) return

  const nextHooks: Record<string, unknown> = { ...hooks }
  if (remaining.length > 0) nextHooks.SessionStart = remaining
  else delete nextHooks.SessionStart

  const next: ClaudeSettingsFile = { ...settings }
  if (Object.keys(nextHooks).length > 0) next.hooks = nextHooks as ClaudeSettingsFile['hooks']
  else delete next.hooks

  if (Object.keys(next).length === 0) {
    await fs.rm(localSettingsPath(projectDir), { force: true })
    // Only if it is now empty — an operator's own .claude contents stay.
    await fs.rmdir(path.join(projectDir, '.claude')).catch(() => {})
    return
  }
  await writeClaudeSettings(localSettingsPath(projectDir), next)
}
