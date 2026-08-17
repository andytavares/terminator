import { spawn, type SpawnOptions } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { selfReviewCommand } from './self-review-plan.js'
import { shellQuote } from '../runtime/claude-launch.js'
import { readSelfReviewSummary } from '../state/self-review-summary.js'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'
import type { PhaseId } from '../types/speckit.types.js'
import type { SupervisedRun, SupervisedRunner } from '../runtime/supervised-runner.js'
import type { PendingPermission, PermissionOutcome } from '../runtime/permission-bridge.js'
import type { PendingAsk } from '../runtime/pending-permissions.js'
import { buildReadOnlySettings, installReadOnlyHookScript } from '../runtime/read-only-hook.js'
import {
  noteFromStreamJsonLine,
  sessionIdFromStreamJsonLine,
  textFromStreamJsonLine,
} from './stream-json.js'

/** Absolute path to a phase's persisted output log. */
export function phaseLogPath(featureDir: string, phase: PhaseId): string {
  return path.join(featureDir, '.pilot', 'logs', `${phase}.log`)
}

/**
 * Delete persisted phase logs older than the retention window (best-effort).
 * Returns the number of log files removed.
 */
export async function pruneOldLogs(
  featureDir: string,
  retentionDays: number,
  now: number = Date.now()
): Promise<number> {
  const logsDir = path.join(featureDir, '.pilot', 'logs')
  const cutoff = now - Math.max(1, retentionDays) * 24 * 60 * 60 * 1000
  let removed = 0
  let entries: string[]
  try {
    entries = await fs.promises.readdir(logsDir)
  } catch {
    return 0
  }
  for (const name of entries) {
    if (!name.endsWith('.log')) continue
    const file = path.join(logsDir, name)
    try {
      const stat = await fs.promises.stat(file)
      if (stat.mtimeMs < cutoff) {
        await fs.promises.unlink(file)
        removed++
      }
    } catch {
      // ignore unreadable entries
    }
  }
  return removed
}

export interface RunnerHandle {
  stop(): void
}

export interface StartPhaseRunnerOpts {
  featureDir: string
  worktreePath: string
  phaseCommand: string
  phase: PhaseId
  feedbackNote?: string
  /** What the card's worktree was branched from, for measuring its diff. */
  baseBranch?: string
  batchIndex?: number
  // When set, resume the given Claude session instead of starting fresh — used
  // to answer the model's questions from the run console (the reply is
  // `phaseCommand`).
  resumeSessionId?: string
  /** What `--model` gets. Empty or absent leaves the flag off entirely. */
  model?: string
  // Kill the run if it hasn't finished in this long (default 15 min).
  timeoutMs?: number
  onStart?: () => void | Promise<void>
  onComplete?: (exitCode: number) => void | Promise<void>
  // Fires with the Claude session id as soon as it's known, so the pilot can
  // resume the conversation later.
  onSession?: (sessionId: string) => void
}

export interface AgentRunner {
  startPhaseRunner(opts: StartPhaseRunnerOpts): RunnerHandle
}

/**
 * The supervised path, when one is available.
 *
 * Set during activation. When present a phase runs in a terminal the operator
 * can see, with every tool call held at a PreToolUse hook until somebody
 * decides; when absent — a build with no window, or a test — the headless
 * spawn below is still used. Kept as a module-level seam rather than threaded
 * through five call sites, none of which cares how a phase is executed.
 */
let supervised: SupervisedRunner | null = null

export function setSupervisedRunner(runner: SupervisedRunner | null): void {
  supervised = runner
}

/**
 * Where a raised request is held so a surface can show it, and cleared again
 * once it is answered. Injected rather than imported so the runner does not
 * reach into the extension's state, and so a test can watch it.
 */
let onPermissionPending: ((ask: PendingAsk) => void) | null = null
let onPermissionResolved: ((requestId: string) => void) | null = null

export function setPermissionSink(
  sink: {
    onPending: (ask: PendingAsk) => void
    onResolved: (requestId: string) => void
  } | null
): void {
  onPermissionPending = sink?.onPending ?? null
  onPermissionResolved = sink?.onResolved ?? null
}

/**
 * The supervision layer, when the extension has one.
 *
 * A run has to be registered for anything downstream to see it: the review
 * queue reads finished runs, backpressure counts them, the stall detector
 * watches them. Without this they are all correct and all empty.
 */
let supervision: RunSupervision | null = null

export interface RunSupervision {
  runs: {
    add(run: {
      sessionId: string
      featureDir: string
      phase: string
      worktreePath: string
      branch: string
      baseBranch: string | null
      terminalSessionId: string
      transcriptPath: string
      startedAt: number
    }): unknown
    setState(sessionId: string, state: 'working' | 'waiting', at: number): void
    /** The card moved on to the next phase inside the same conversation. */
    notePhase(sessionId: string, phase: string, at: number): void
    noteAsked(sessionId: string): void
    /** What the run has changed so far, for deciding whether a turn finished it. */
    get(sessionId: string): { diff: { files: number; added: number; removed: number } } | null
  }
  finishTurn(sessionId: string, turns: number, at: number): Promise<void>
  finish(sessionId: string, at: number): void
}

export function setRunSupervision(next: RunSupervision | null): void {
  supervision = next
}

/**
 * Where the read-only policy lives on disk, installed on first use.
 *
 * Null when it cannot be written, which the caller turns into a refusal rather
 * than a fallback: a review that runs unsupervised is the thing this replaced.
 */
let readOnlyStateDir: string | null = null

/**
 * Where a self-review's exit codes and reports go.
 *
 * Beside the runtime's other state, never in the worktree: a review that adds a
 * `coverage/` directory to the diff it is reviewing has changed the thing it
 * was measuring.
 */
function selfReviewDir(featureDir: string): string | null {
  if (readOnlyStateDir === null) return null
  return path.join(readOnlyStateDir, 'self-review', path.basename(featureDir))
}

/** Records the summary beside the card, where the gate reads it. */
function writeSelfReviewSummary(featureDir: string, outputDir: string): void {
  try {
    const summary = readSelfReviewSummary(outputDir)
    if (summary === null) return
    const pilotDir = path.join(featureDir, '.pilot')
    mkdirSync(pilotDir, { recursive: true })
    writeFileSync(path.join(pilotDir, 'self-review.json'), JSON.stringify(summary, null, 2), 'utf8')
  } catch {
    // The gate reads the console when there is no summary, so failing to write
    // one must not fail the phase.
  }
}
let installedReadOnlySettings: string | null = null

export function setReadOnlyStateDir(dir: string | null): void {
  readOnlyStateDir = dir
  installedReadOnlySettings = null
}

function readOnlySettingsPath(): string | null {
  if (installedReadOnlySettings !== null) return installedReadOnlySettings
  if (readOnlyStateDir === null) return null
  try {
    const hookPath = installReadOnlyHookScript(readOnlyStateDir)
    const settingsPath = path.join(readOnlyStateDir, 'read-only.settings.json')
    fs.writeFileSync(
      settingsPath,
      JSON.stringify(buildReadOnlySettings(hookPath, process.execPath), null, 2),
      'utf-8'
    )
    installedReadOnlySettings = settingsPath
    return settingsPath
  } catch {
    return null
  }
}

/**
 * Says, where anyone can see it, that a phase is about to run unsupervised.
 *
 * Three things drop a run to the headless spawn: the supervision runtime
 * failed to start, the repository belongs to no workspace, or no terminal could
 * be opened. All three end in `bypassPermissions`, and a log line is not a
 * signal — the operator would see a card working normally and never learn that
 * this one approved everything itself.
 */
function warnUnsupervised(api: ExtensionAPI, featureDir: string, phase: PhaseId): void {
  const card = path.basename(featureDir)
  api.log.error(`running ${phase} unsupervised in ${card} — no terminal, no held tool calls`)
  api.notifications.showToast(
    'error',
    `${card}: ${phase} is running unsupervised — its tool calls are being approved automatically`,
    // Keyed by card, so one unsupervised run does not stack a toast per phase.
    `speckit.unsupervised.${card}`
  )
}

/** The workspace a card's repository belongs to, for placing its terminal. */
function workspaceIdFor(api: ExtensionAPI, workspacePath: string): string | null {
  return api.workspace.list().find((w) => w.folderPath === workspacePath)?.id ?? null
}

async function branchIn(api: ExtensionAPI, cwd: string): Promise<string | null> {
  const res = await api.shell.exec({
    command: 'git',
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
    cwd,
  })
  const branch = res.stdout.trim()
  return res.exitCode === 0 && branch !== '' ? branch : null
}

/**
 * Self-review: format, lint, tests, then a review of the diff.
 *
 * The review no longer bypasses permissions. It runs under a hook that decides
 * from a fixed read-only policy — allow what only reads, refuse everything else
 * — so a review cannot rewrite the worktree it is reviewing, and no person is
 * ever asked. Waiting on one would turn an automated gate into a flaky failure.
 *
 * Restricting tools instead does not work, and this was checked rather than
 * assumed: with `--allowedTools Read Grep Glob --disallowedTools Write Edit`, an
 * agent asked to create a file still created it, because a review needs Bash for
 * `git diff` and Bash can write. The decision has to be made on the command.
 */

// Kill a phase that has produced nothing for this long — a headless run that
// hangs (e.g. on a blocked API call) would otherwise wait forever.
const DEFAULT_PHASE_TIMEOUT_MS = 15 * 60 * 1000

export function createAgentRunner(api: ExtensionAPI): AgentRunner {
  return {
    startPhaseRunner(opts) {
      const {
        featureDir,
        worktreePath,
        phaseCommand,
        phase,
        feedbackNote,
        batchIndex,
        resumeSessionId,
        timeoutMs = DEFAULT_PHASE_TIMEOUT_MS,
        onStart,
        onComplete,
        onSession,
      } = opts

      // Supervised when the extension has a runtime and the card's repository
      // belongs to a workspace we can place a terminal in. Self-review is a
      // shell chain rather than an agent, so it stays a plain spawn.
      if (supervised !== null && phase !== 'self-review') {
        const startedSupervised = startSupervised({
          api,
          featureDir,
          worktreePath,
          phase,
          phaseCommand,
          feedbackNote,
          baseBranch: opts.baseBranch,
          resumeSessionId,
          model: opts.model,
          onStart,
          onComplete,
          onSession,
        })
        if (startedSupervised !== null) return startedSupervised
        // It could not be supervised, and the fall-through below is
        // `--permission-mode bypassPermissions`: an agent nobody can see,
        // approving its own tool calls in a worktree. That is the exact thing
        // this replaced, so it is said out loud rather than logged.
        warnUnsupervised(api, featureDir, phase)
      } else if (phase !== 'self-review') {
        warnUnsupervised(api, featureDir, phase)
      }

      const shellBin = process.env.SHELL ?? '/bin/sh'
      // Point the native `/speckit-*` skills at this card's feature directory so
      // they operate on the right spec/plan/tasks files regardless of the git
      // branch name (SpecKit's common.sh honors these over branch inference).
      // The dir is relative to the worktree cwd, matching SpecKit's own
      // `specs/<slug>` convention.
      const featureSlug = path.basename(featureDir)
      // Typed, so `spawn` picks the overload that gives the child piped
      // streams. As a bare object literal the `as const` stdio tuple matched no
      // overload at all and every use of the child below inferred `never`.
      const spawnOpts: SpawnOptions = {
        cwd: worktreePath,
        env: {
          ...process.env,
          SPECIFY_FEATURE: featureSlug,
          SPECIFY_FEATURE_DIRECTORY: path.join('specs', featureSlug),
        } as Record<string, string>,
        stdio: ['ignore', 'pipe', 'pipe'],
      }

      // Self-review runs a shell chain (npm/vitest/google-review) whose stdout is
      // already plain, line-buffered text. Every other phase runs claude in
      // stream-json mode so its assistant output streams to the console in real
      // time instead of arriving in one chunk when --print buffers to the end.
      const streaming = phase !== 'self-review'
      let selfReviewOutputDir: string | null = null
      let cmd: string
      if (phase === 'self-review') {
        selfReviewOutputDir = selfReviewDir(opts.featureDir)
        cmd = selfReviewCommand({
          worktreePath: opts.worktreePath,
          // Anywhere but the worktree. A review that adds files to the diff it
          // is reviewing has changed the thing it was measuring, so with no
          // state directory this goes to a temp one and the gate falls back to
          // the console as it did before.
          outputDir: selfReviewOutputDir ?? path.join(tmpdir(), 'speckit-self-review'),
          settingsPath: readOnlySettingsPath(),
        })
      } else {
        const prompt = feedbackNote
          ? `${phaseCommand}\n\nFeedback from reviewer:\n${feedbackNote}`
          : phaseCommand
        // A reply resumes the existing conversation so the model has full context
        // for the answer; a fresh phase run starts a new session.
        const resumeFlag = resumeSessionId ? `--resume ${shellQuote(resumeSessionId)} ` : ''
        // Phases run headless in the card's isolated worktree, so bypass
        // permission prompts — a spawned `--print` process has no interactive
        // channel to approve tool calls, and without this every Write/Edit/Bash
        // stalls forever (see ADR-007). `--strict-mcp-config` (with no
        // --mcp-config) disables all MCP servers, which otherwise hang the
        // headless spawn on startup (context7, Linear, Gmail, …).
        cmd = `claude --print ${resumeFlag}--permission-mode bypassPermissions --strict-mcp-config --output-format stream-json --verbose --include-partial-messages ${shellQuote(prompt)}`
      }

      const child = spawn(shellBin, ['-l', '-c', cmd], spawnOpts)

      // Safety net: a hung headless run (blocked API call, wedged tool) would
      // otherwise never emit `close`. Kill it and let the close handler report.
      const killTimer = setTimeout(() => {
        api.window.broadcast('speckit:run-output', {
          featureDir,
          phase,
          line: `⚠ no response after ${Math.round(timeoutMs / 60000)} min — stopping this phase`,
          ts: new Date().toISOString(),
        })
        child.kill('SIGTERM')
        setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            // already gone
          }
        }, 3000)
      }, timeoutMs)

      if (onStart) void Promise.resolve(onStart())

      const outputBuffer: string[] = []

      // Persist output so it can be reviewed after the run finishes.
      let logStream: fs.WriteStream | null = null
      try {
        const logPath = phaseLogPath(featureDir, phase)
        fs.mkdirSync(path.dirname(logPath), { recursive: true })
        logStream = fs.createWriteStream(logPath, { flags: 'a' })
        logStream.write(`\n=== run ${new Date().toISOString()} — ${phase} ===\n`)
      } catch {
        logStream = null
      }
      const persist = (line: string) => {
        try {
          logStream?.write(line + '\n')
        } catch {
          // best-effort logging; never break the run
        }
      }

      const emitLine = (line: string) => {
        outputBuffer.push(line + '\n')
        persist(line)
        api.window.broadcast('speckit:run-output', {
          featureDir,
          phase,
          line,
          ts: new Date().toISOString(),
        })
      }

      // Show immediate activity so the console isn't a silent "Waiting for
      // output…" while the agent boots (it can be seconds before the first
      // assistant token, and longer if it's stuck).
      emitLine(`▶ ${phase}${phaseCommand ? `: ${phaseCommand}` : ''}`)

      // Two-level line buffering for stream-json: stdout chunks can split a JSON
      // event, and a display line can span several text deltas.
      let jsonlBuffer = ''
      let displayBuffer = ''

      let sessionCaptured = false
      const handleStreamJson = (text: string) => {
        jsonlBuffer += text
        const jsonLines = jsonlBuffer.split('\n')
        jsonlBuffer = jsonLines.pop() ?? ''
        for (const jline of jsonLines) {
          if (!sessionCaptured) {
            const sid = sessionIdFromStreamJsonLine(jline)
            if (sid) {
              sessionCaptured = true
              onSession?.(sid)
              // Confirm the agent actually launched, before any assistant text.
              emitLine(`· session ${sid.slice(0, 8)} started`)
            }
          }
          const chunk = textFromStreamJsonLine(jline)
          if (!chunk) {
            // No assistant text — surface tool activity / errors so a run that's
            // busy with tool calls (or has failed) isn't a silent blank console.
            const note = noteFromStreamJsonLine(jline)
            if (note) {
              if (displayBuffer.length > 0) {
                emitLine(displayBuffer)
                displayBuffer = ''
              }
              emitLine(note)
            }
            continue
          }
          displayBuffer += chunk
          const displayLines = displayBuffer.split('\n')
          displayBuffer = displayLines.pop() ?? ''
          for (const dline of displayLines) emitLine(dline)
        }
      }

      // Emit any buffered trailing text (a final line with no terminating newline).
      const flushStreamJson = () => {
        if (jsonlBuffer.trim()) {
          displayBuffer += textFromStreamJsonLine(jsonlBuffer)
          jsonlBuffer = ''
        }
        if (displayBuffer.length > 0) {
          emitLine(displayBuffer)
          displayBuffer = ''
        }
      }

      const handleData = (data: Buffer | string) => {
        const text = typeof data === 'string' ? data : data.toString()
        if (streaming) {
          handleStreamJson(text)
        } else {
          for (const line of text.split('\n')) {
            if (line) emitLine(line)
          }
        }
      }

      child.stdout?.on('data', handleData)
      // In stream-json mode stdout is pure JSON, so stderr carries only
      // diagnostics (command-not-found, rate-limit notices, node errors). Stream
      // it to the console so a stalled or failed run is visible instead of a
      // silent "Waiting for output…".
      let stderrBuffer = ''
      child.stderr?.on('data', (data: Buffer | string) => {
        const text = typeof data === 'string' ? data : data.toString()
        outputBuffer.push(text)
        stderrBuffer += text
        const lines = stderrBuffer.split('\n')
        stderrBuffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          persist(line)
          api.window.broadcast('speckit:run-output', {
            featureDir,
            phase,
            line: `⚠ ${line}`,
            ts: new Date().toISOString(),
          })
        }
      })

      child.on('error', (err) => {
        clearTimeout(killTimer)
        flushStreamJson()
        persist(`[runner error] ${err.message}`)
        logStream?.end()
        api.window.broadcast('speckit:run-output', {
          featureDir,
          phase,
          line: `[runner error] ${err.message}`,
          ts: new Date().toISOString(),
        })
        if (onComplete) void Promise.resolve(onComplete(1))
        api.window.broadcast('speckit:run-phase-complete', { featureDir, phase, exitCode: 1 })
      })

      child.on('close', (exitCode) => {
        clearTimeout(killTimer)
        flushStreamJson()
        const code = exitCode ?? 0
        logStream?.end()
        // What the checks recorded, assembled for the gate. Written before
        // `onComplete`, which is what moves the phase to awaiting_review and
        // puts the gate on screen.
        if (selfReviewOutputDir !== null) {
          writeSelfReviewSummary(opts.featureDir, selfReviewOutputDir)
        }
        if (onComplete) void Promise.resolve(onComplete(code))
        if (phase === 'implement' && batchIndex !== undefined) {
          api.window.broadcast('speckit:checkin-ready', {
            featureDir,
            batchIndex,
            diffSummary: outputBuffer.join('').slice(-500),
          })
        } else {
          api.window.broadcast('speckit:run-phase-complete', {
            featureDir,
            phase,
            exitCode: code,
          })
        }
      })

      return {
        stop() {
          clearTimeout(killTimer)
          child.kill('SIGTERM')
        },
      }
    },
  }
}

/**
 * Starts a phase in a terminal, returning null when it cannot — no workspace
 * for the repository, or no window to show a tab in. Falling back to the
 * headless spawn is deliberate: a phase that does not run at all is worse than
 * one that runs unsupervised, and the caller is told either way through the
 * same callbacks.
 */
function startSupervised(opts: {
  api: ExtensionAPI
  featureDir: string
  worktreePath: string
  phase: PhaseId
  phaseCommand: string
  feedbackNote?: string
  /** What the worktree was branched from, so the run's diff is its own work. */
  baseBranch?: string
  resumeSessionId?: string
  model?: string
  onStart?: () => void | Promise<void>
  onComplete?: (exitCode: number) => void | Promise<void>
  onSession?: (sessionId: string) => void
}): RunnerHandle | null {
  const runner = supervised
  if (runner === null) return null

  const workspacePath = path.dirname(path.dirname(opts.featureDir))
  const workspaceId = workspaceIdFor(opts.api, workspacePath)
  if (workspaceId === null) return null

  const prompt = opts.feedbackNote
    ? `${opts.phaseCommand}\n\nFeedback from reviewer:\n${opts.feedbackNote}`
    : opts.phaseCommand

  let sessionId: string | null = null
  let ended = false
  let stopRequested = false
  /**
   * The diff as it stood when this phase began.
   *
   * A card now keeps one conversation across all its phases, so by the time
   * `plan` starts the run has already changed files — the ones `specify`
   * wrote. The rule below is "a turn that changed something ended the phase",
   * and against a cumulative diff that is true before the agent has read the
   * prompt. Measured from here instead, it means what it always meant.
   */
  let baseline = { files: 0, added: 0, removed: 0 }

  /** True once this phase's own work shows up in the diff. */
  const movedSinceBaseline = (diff: { files: number; added: number; removed: number }): boolean =>
    diff.files !== baseline.files ||
    diff.added !== baseline.added ||
    diff.removed !== baseline.removed

  void (async () => {
    const branch = (await branchIn(opts.api, opts.worktreePath)) ?? path.basename(opts.worktreePath)
    const phaseCallbacks = {
      onPending: (pending: PendingPermission) => {
        // The session comes from the bridge, which knows it: reading it back
        // from the run being started would be a reference to a binding that is
        // not assigned until start() returns.
        onPermissionPending?.({ ...pending, featureDir: opts.featureDir })
        supervision?.runs.setState(pending.sessionId, 'waiting', pending.at)
        supervision?.runs.noteAsked(pending.sessionId)
        opts.api.window.broadcast('speckit:permission-requested', {
          featureDir: opts.featureDir,
          phase: opts.phase,
          pending,
        })
      },
      onResolved: (requestId: string, decision: PermissionOutcome) => {
        onPermissionResolved?.(requestId)
        if (sessionId !== null) supervision?.runs.setState(sessionId, 'working', Date.now())
        opts.api.window.broadcast('speckit:permission-resolved', {
          featureDir: opts.featureDir,
          requestId,
          decision,
        })
      },
      onRegistered: (started: SupervisedRun) => {
        // Before the terminal is written to, so nothing the agent does can
        // arrive at a registry that has never heard of it.
        sessionId = started.sessionId
        supervision?.runs.add({
          sessionId: started.sessionId,
          featureDir: opts.featureDir,
          phase: opts.phase,
          worktreePath: opts.worktreePath,
          branch,
          baseBranch: opts.baseBranch ?? null,
          terminalSessionId: started.terminalSessionId,
          transcriptPath: started.transcriptPath,
          startedAt: Date.now(),
        })
      },
      onTurnEnd: (turns: number) => {
        // A turn ending is what finishes a supervised phase.
        //
        // In a terminal the agent does not exit when it is done — it sits at
        // its prompt, and `session_end` may never come. Waiting for it left the
        // phase `running` forever: the gate never appeared, approval never
        // unlocked, and the card looked busy while the agent sat idle.
        //
        // Only once it has changed something, though, which is the same rule
        // `finishTurn` applies to the register. A first turn that ends with a
        // plain question — text, so no tool call and no permission hold — was
        // driving the card to `awaiting_review` while the agent was still
        // working, and `ended` made that one-way.
        if (sessionId === null) return
        void supervision?.finishTurn(sessionId, turns, Date.now()).then(() => {
          if (ended) return
          const changed = supervision?.runs.get(sessionId as string)?.diff
          if (changed === undefined || !movedSinceBaseline(changed)) return
          ended = true
          void opts.onComplete?.(0)
        })
      },
      onEnd: (exitCode: number) => {
        if (sessionId !== null) supervision?.finish(sessionId, Date.now())
        if (ended) return
        ended = true
        // The terminal's own code when it has one: a session that died is not
        // a phase that succeeded, and `awaiting_review` on a crashed run is an
        // approval gate over nothing.
        void opts.onComplete?.(exitCode)
      },
    }

    // The card's open conversation, when it has one.
    //
    // Preferred over opening a second terminal because the agent sitting at
    // that prompt has already read the spec, written the plan and made every
    // decision in between — and because a card used to accumulate one tab, one
    // session and one idle-looking `claude` process per phase. An explicit
    // resume id wins: that is the run console answering a specific question.
    const reusable = opts.resumeSessionId ?? runner.liveSessionFor(opts.featureDir)
    const continued =
      reusable === null || reusable === undefined
        ? null
        : runner.continueRun(reusable, {
            prompt,
            phase: opts.phase,
            ...phaseCallbacks,
          })

    if (continued !== null) {
      sessionId = continued.sessionId
      // Whatever the previous phase left in the diff is this phase's starting
      // point, not its output.
      baseline = { ...(supervision?.runs.get(continued.sessionId)?.diff ?? baseline) }
      supervision?.runs.notePhase(continued.sessionId, opts.phase, Date.now())
      if (stopRequested) runner.stop(continued.sessionId, 'stopped from the pilot')
      opts.onSession?.(continued.sessionId)
      void opts.onStart?.()
      return
    }

    const run = await runner.start({
      featureDir: opts.featureDir,
      worktreePath: opts.worktreePath,
      workspaceId,
      branch,
      prompt,
      phase: opts.phase,
      resumeSessionId: opts.resumeSessionId,
      model: opts.model,
      ...phaseCallbacks,
    })
    if (run === null) {
      // Nothing was started, and the caller is waiting on a completion it will
      // otherwise never get.
      ended = true
      void opts.onComplete?.(1)
      return
    }
    if (stopRequested) {
      // Asked to stop before it had started. Honour it now that there is
      // something to stop.
      runner.stop(run.sessionId, 'stopped from the pilot')
    }
    // `onRegistered` above already added it, before the terminal was written
    // to; this only has to cover a runner that does not report registration.
    sessionId = run.sessionId
    opts.onSession?.(run.sessionId)
    void opts.onStart?.()
  })()

  return {
    stop(): void {
      // `start` is still in flight the moment this handle is returned, so a
      // stop that arrives first would have found no session and done nothing —
      // leaving the terminal to open and the agent to run anyway.
      stopRequested = true
      if (sessionId !== null) runner.stop(sessionId, 'stopped from the pilot')
    },
  }
}
