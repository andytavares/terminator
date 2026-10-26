import { shellQuote } from '@terminator/extension-sdk/node'
import { writeFileSync, mkdirSync } from 'fs'
import { isAbsolute, join } from 'path'
import { homedir } from 'os'
import { existsSync, realpathSync } from 'fs'

// The settings that make an agent answerable from the console, and where its
// transcript is. The agent itself is started over ACP (`api.agents`), which
// chooses the session id; the hook is keyed by a run id minted here instead.

/** What one run's settings file needs. */
export interface RunSettingsOptions {
  /** Names the file and is the hook script's session argument. */
  runId: string
  /** Written here, one file per run. */
  settingsDirectory: string
  hookScriptPath: string
  controlUrl: string
  controlToken: string
  /**
   * The program that runs the hook. Electron's own binary in `node` mode, so
   * the hook does not depend on a node being installed or on whatever the
   * login shell put on PATH.
   */
  nodePath?: string
}

/**
 * How long the runtime waits for a decision before giving up on the hook.
 *
 * Twelve hours, because the thing it is waiting for is a person, and a person
 * goes to lunch. Safe to set this high: when it does expire the runtime falls
 * back to its own ask in the agent tab rather than to a decision nobody made
 * — verified against claude 2.1.220, along with the fact that a timeout this
 * large is accepted at all.
 */
const HOOK_TIMEOUT_SECONDS = 43_200

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

/** What a hook command line carries: the script, how to reach the console, and whose session it is. */
interface HookCommandOptions {
  hookScriptPath: string
  controlUrl: string
  controlToken: string
  sessionId: string
  nodePath: string
}

/**
 * The settings handed to one run.
 *
 * A file per session rather than a shared one: two agents running at once each
 * need their own session id on their own hook command line, and a single file
 * would have them answering each other's permission requests. Nothing is
 * written into the repository — the operator's own `.claude/settings.json` is
 * never touched.
 * @internal
 */
export function buildSettings(options: HookCommandOptions): unknown {
  return {
    hooks: {
      PreToolUse: [
        {
          // Every tool, not a list of the dangerous ones: what counts as
          // dangerous is the autonomy ladder's judgement, and it lives in the
          // console where it can be changed without restarting an agent.
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: toolHookCommand(options),
              timeout: HOOK_TIMEOUT_SECONDS,
            },
          ],
        },
      ],
    },
  }
}

/** The hook script run against the console's URL, for one run. */
function toolHookCommand(options: HookCommandOptions): string {
  return [
    // Electron refuses to be a node unless told; without this the hook script
    // would launch a second copy of the application.
    'ELECTRON_RUN_AS_NODE=1',
    shellQuote(options.nodePath),
    shellQuote(options.hookScriptPath),
    shellQuote(options.controlUrl),
    shellQuote(options.controlToken),
    shellQuote(options.sessionId),
  ].join(' ')
}

/** The run's settings, written to a file of its own; returns where. */
export function writeRunSettings(options: RunSettingsOptions): string {
  // Absolute, or the agent fails in a way that only shows up at runtime: a
  // relative path is resolved against the card's worktree, where it never
  // exists, and the whole run dies on "Settings file not found".
  if (!isAbsolute(options.settingsDirectory)) {
    throw new Error(`settingsDirectory must be absolute, got ${options.settingsDirectory}`)
  }
  mkdirSync(options.settingsDirectory, { recursive: true })
  const settingsPath = join(options.settingsDirectory, `${options.runId}.settings.json`)
  const settings = buildSettings({
    hookScriptPath: options.hookScriptPath,
    controlUrl: options.controlUrl,
    controlToken: options.controlToken,
    sessionId: options.runId,
    nodePath: options.nodePath ?? process.execPath,
  })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
  return settingsPath
}
