import type { RunCommand } from '../../codehost/check-status.js'

// FR-044. The spec's first non-goal is "not an editor" — handing the worktree
// path to a real one is a first-class action, not a gap. This is that action.

export interface HandoffResult {
  readonly ok: boolean
  readonly reason: string | null
}

export interface HandoffOptions {
  /** The operator's configured editor command, e.g. `code`, `zed`, `cursor`. */
  editorCommand: string | null
  worktreePath: string
  run: RunCommand
}

export async function openInEditor(options: HandoffOptions): Promise<HandoffResult> {
  const { editorCommand, worktreePath, run } = options

  if (editorCommand === null || editorCommand.trim() === '') {
    // Stated, not silent. A button that does nothing is worse than one that
    // explains what is missing.
    return { ok: false, reason: 'no external editor is configured' }
  }

  // The command is split rather than shelled out, so a worktree path containing
  // spaces or shell metacharacters cannot become command injection.
  const [command, ...args] = editorCommand.trim().split(/\s+/)

  try {
    const result = await run(command, [...args, worktreePath], worktreePath)
    return result.ok
      ? { ok: true, reason: null }
      : { ok: false, reason: result.stderr.trim() || `${command} exited non-zero` }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
