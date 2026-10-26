import { join } from 'path'
import { homedir } from 'os'
import { existsSync, realpathSync } from 'fs'

// Where an agent's transcript is. The agent itself is started over ACP (`api.agents`),
// which chooses the session id.

/**
 * Where Claude Code keeps a session's transcript.
 *
 * The directory is the working copy's absolute path with every separator and
 * dot replaced by a dash. Reproduced rather than discovered because the stall
 * detector and the reconciler both need it, and waiting for the runtime to
 * announce it means the first minutes of a session are unwatched.
 *
 * **Through the resolved path**, because the runtime encodes the directory the
 * process is actually in, and macOS hands out two names for the same one. A
 * worktree under `/var/folders/…` is `/private/var/folders/…` to the process
 * that chdir'd into it, so this predicted
 *
 *   ~/.claude/projects/-var-folders-…/<session>.jsonl
 *
 * for a file the runtime was writing at
 *
 *   ~/.claude/projects/-private-var-folders-…/<session>.jsonl
 *
 * and every reader of it opened nothing. The ladder reported rungs that had
 * just run and exited 0 as "not measured"; the stall detector, which reads
 * transcripts and nothing else, saw an agent that never said anything.
 *
 * The third time this pair of names has cost something here — the trust
 * dialog and the write-outside check were the other two.
 */
export function transcriptPathFor(cwd: string, sessionId: string, home = homedir()): string {
  const encoded = realPath(cwd).replace(/[/.]/g, '-')
  return join(home, '.claude', 'projects', encoded, `${sessionId}.jsonl`)
}

/** The session to `--resume` from this directory, or undefined to start a fresh one. */
export function resumableIn(
  cwd: string,
  sessionId: string | undefined,
  home = homedir()
): string | undefined {
  if (sessionId === undefined) return undefined
  return existsSync(transcriptPathFor(cwd, sessionId, home)) ? sessionId : undefined
}

/** The path with every symlink resolved, or the path itself when it has none. */
function realPath(target: string): string {
  try {
    return realpathSync(target)
  } catch {
    // Not there yet — a worktree about to be cut. The unresolved name is the
    // best answer available and is right wherever the two agree.
    return target
  }
}
