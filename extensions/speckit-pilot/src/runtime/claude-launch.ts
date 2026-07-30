import { writeFileSync, mkdirSync } from 'fs'
import { isAbsolute, join } from 'path'
import { homedir } from 'os'

// What to type into the terminal to start an agent, and the settings that make
// it answerable from the console.
//
// The session id is minted here rather than read back from the runtime. That
// single decision removes the worst failure this feature has had: with the
// runtime choosing, every event it reported arrived keyed to an id the console
// had never registered, and the whole lot was silently discarded — a session
// that sat `working` for half an hour with no turns, no tool activity and
// nothing to show. Now the id is ours before the process exists, so the
// transcript path is known up front and a hook callback needs no correlation.

export interface LaunchSpec {
  /** The claude session id, which is also ours. `--resume` takes this. */
  readonly sessionId: string
  /** Where the agent runs: the provisioned working copy. */
  readonly cwd: string
  /** Typed into the terminal. Newline is added by whoever sends it. */
  readonly command: string
  /** Written for us; the runtime reads it via --settings. */
  readonly settingsPath: string
  /** Where the runtime will write its durable record, derivable before it exists. */
  readonly transcriptPath: string
}

export interface LaunchSpecOptions {
  sessionId: string
  cwd: string
  /** Lane tasks and artefact paths, composed upstream (FR-039). */
  prompt: string
  /** Written here, one file per session. */
  settingsDirectory: string
  /** Continuing an existing conversation rather than starting one. */
  resume?: boolean
  hookScriptPath: string
  controlUrl: string
  controlEventUrl: string
  controlToken: string
  /**
   * The program that runs the hook. Electron's own binary in `node` mode, so
   * the hook does not depend on a node being installed or on whatever the
   * login shell put on PATH.
   */
  nodePath?: string
  /** Overridden only by tests; the real one is resolved from PATH. */
  claudePath?: string
}

/**
 * How long the runtime waits for a decision before giving up on the hook.
 *
 * Twelve hours, because the thing it is waiting for is a person, and a person
 * goes to lunch. Safe to set this high: when it does expire the runtime falls
 * back to its own prompt in the terminal rather than to a decision nobody made
 * — verified against claude 2.1.220, along with the fact that a timeout this
 * large is accepted at all.
 */
const HOOK_TIMEOUT_SECONDS = 43_200

/** Single-quoted for a POSIX shell, which is what the terminal is running. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Where Claude Code keeps a session's transcript.
 *
 * The directory is the working copy's absolute path with every separator and
 * dot replaced by a dash. Reproduced rather than discovered because the stall
 * detector and the reconciler both need it, and waiting for the runtime to
 * announce it means the first minutes of a session are unwatched.
 */
export function transcriptPathFor(cwd: string, sessionId: string, home = homedir()): string {
  const encoded = cwd.replace(/[/.]/g, '-')
  return join(home, '.claude', 'projects', encoded, `${sessionId}.jsonl`)
}

/**
 * The settings handed to one run.
 *
 * A file per session rather than a shared one: two agents running at once each
 * need their own session id on their own hook command line, and a single file
 * would have them answering each other's permission requests. Nothing is
 * written into the repository — the operator's own `.claude/settings.json` is
 * never touched.
 */
export function buildSettings(options: {
  hookScriptPath: string
  controlUrl: string
  controlEventUrl: string
  controlToken: string
  sessionId: string
  nodePath: string
}): unknown {
  const invoke = (url: string, kind?: string): string =>
    [
      // Electron refuses to be a node unless told; without this the hook script
      // would launch a second copy of the application.
      'ELECTRON_RUN_AS_NODE=1',
      shellQuote(options.nodePath),
      shellQuote(options.hookScriptPath),
      shellQuote(url),
      shellQuote(options.controlToken),
      shellQuote(options.sessionId),
      ...(kind === undefined ? [] : [shellQuote(kind)]),
    ].join(' ')

  const notify = (kind: string): unknown => ({
    matcher: '*',
    // Seconds, not hours: nothing is waiting on the answer, and a lifecycle
    // hook that hangs would hold up the agent for no reason at all.
    hooks: [{ type: 'command', command: invoke(options.controlEventUrl, kind), timeout: 10 }],
  })

  return {
    hooks: {
      PreToolUse: [
        {
          // Every tool, not a list of the dangerous ones: what counts as
          // dangerous is the autonomy ladder's judgement, and it lives in the
          // console where it can be changed without restarting an agent.
          matcher: '*',
          hooks: [
            { type: 'command', command: invoke(options.controlUrl), timeout: HOOK_TIMEOUT_SECONDS },
          ],
        },
      ],
      // The agent finished responding and is waiting for input. Without this a
      // session that had finished would look identical to one that was stuck,
      // and the stall detector would call it a stall eight minutes later.
      Stop: [notify('stop')],
      SessionEnd: [notify('session_end')],
    },
  }
}

export function buildLaunchSpec(options: LaunchSpecOptions): LaunchSpec {
  const nodePath = options.nodePath ?? process.execPath
  const claudePath = options.claudePath ?? 'claude'

  // Absolute, or the command is wrong in a way that only shows up at runtime:
  // the runtime resolves `--settings` against the terminal's cwd, which is the
  // card's worktree, and a relative path put it somewhere that never exists.
  // The whole run then dies on "Settings file not found" with the card still
  // reading WORKING.
  if (!isAbsolute(options.settingsDirectory)) {
    throw new Error(`settingsDirectory must be absolute, got ${options.settingsDirectory}`)
  }
  mkdirSync(options.settingsDirectory, { recursive: true })
  const settingsPath = join(options.settingsDirectory, `${options.sessionId}.settings.json`)
  writeFileSync(
    settingsPath,
    JSON.stringify(
      buildSettings({
        hookScriptPath: options.hookScriptPath,
        controlUrl: options.controlUrl,
        controlEventUrl: options.controlEventUrl,
        controlToken: options.controlToken,
        sessionId: options.sessionId,
        nodePath,
      }),
      null,
      2
    ),
    'utf8'
  )

  const command = [
    claudePath,
    // `--resume` for a conversation that already exists, `--session-id` only
    // for one being created. The runtime refuses a `--session-id` it has seen
    // — "Session ID … is already in use" — and it refuses it by exiting, while
    // the shell around it lives on: no PTY exit fires, so the run sits
    // registered as working with a dead agent until the stall detector
    // eventually notices.
    options.resume === true ? '--resume' : '--session-id',
    options.sessionId,
    '--settings',
    shellQuote(settingsPath),
    // The ladder decides in the hook, so the runtime is left at its normal
    // footing. Anything the ladder abstains on becomes `ask`, and `ask` is the
    // prompt the operator can see in front of them.
    '--permission-mode',
    'default',
    shellQuote(options.prompt),
  ].join(' ')

  return {
    sessionId: options.sessionId,
    cwd: options.cwd,
    command,
    settingsPath,
    transcriptPath: transcriptPathFor(options.cwd, options.sessionId),
  }
}
