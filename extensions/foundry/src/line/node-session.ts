import type { StartedRun, ExecutorDeps } from './executor.js'
import type { Checkout } from './worktree.js'
import { issueOf } from './order-project.js'
import { conversationKey, workspaceOf } from './run-context.js'
import type { RunContext } from './run-context.js'
import type {
  StartSupervisedRunOptions,
  SupervisedRun,
  SupervisedRunner,
} from '../runtime/supervised-runner.js'
import { agentTitle } from '../runtime/agent-title.js'
import { decideTool } from '../runtime/tool-decision.js'
import { refusesUnlistedCalls, roleSettings } from '../runtime/role-settings.js'
import { probedCommands } from '../runtime/agent-policy.js'
import { runtime, strandedAgents } from '../runtime/runtime-state.js'
import { notePending, noteResolved } from '../runtime/held-calls.js'
import { readOnlyTools, autonomyFor, letAutoModeDecide, modelForTier } from '../state/settings.js'
import { announceLive } from '../state/live-index.js'
import { NO_START_REASON } from '../runtime/start-failure.js'

type NodeInput = Parameters<ExecutorDeps['run']>[0]

/** One node's turn as it goes: the session it got, and settling it exactly once. */
interface NodeTurn {
  sessionId: string
  // Where this node's turn begins in the lane's transcript. Every node
  // after the first resumes that conversation, so without the mark a rung
  // reads an earlier node's tool calls as its own.
  transcriptFrom: number
  readonly finish: (exitCode: number | null, notStarted?: string) => void
  /** The agent's own reason for not starting, once it gives one. */
  startFailure: string | null
}

/** Where one node runs: the run, the node, and the lane checkout it runs in. */
interface NodeLaunch {
  readonly context: RunContext
  readonly input: NodeInput
  readonly checkout: Checkout
}

// One node, from launch to the end of its turn: a promise around the runner's
// callbacks, since the runner returns once the session exists. Settled once, so an
// agent that fails to start and also reports an end cannot resolve twice.
export function runNodeSession(context: RunContext, input: NodeInput): Promise<StartedRun> {
  const checkout = context.checkouts.get(input.node.lane ?? 1)
  // No checkout and no runner mean nothing ran. Reported with a null exit
  // status, which the verdict path reads as "not measured" — calling it a
  // pass or a failure would both be claims nobody checked.
  const runner = runtime.supervisedRunner
  if (checkout === undefined || runner === null) {
    return Promise.resolve({ sessionId: `${input.node.id}-unstarted`, exitCode: null })
  }
  return new Promise<StartedRun>((resolve) => {
    startNode(runner, { context, input, checkout }, resolve)
  })
}

function startNode(
  runner: SupervisedRunner,
  launch: NodeLaunch,
  resolve: (run: StartedRun) => void
): void {
  const turn = openTurn(launch.input.node.id, resolve)
  void runner
    .start(startOptions(launch, turn))
    .then((run) => {
      if (run === null) {
        turn.finish(null, turn.startFailure ?? NO_START_REASON)
        return
      }
      registerStartedRun(launch, turn, run)
    })
    .catch(() => turn.finish(null))
}

function openTurn(nodeId: string, resolve: (run: StartedRun) => void): NodeTurn {
  let settled = false
  const turn: NodeTurn = {
    sessionId: `${nodeId}-unstarted`,
    transcriptFrom: 0,
    startFailure: null,
    finish: (exitCode, notStarted) => {
      if (settled) return
      settled = true
      resolve({
        sessionId: turn.sessionId,
        exitCode,
        transcriptFrom: turn.transcriptFrom,
        ...(notStarted === undefined ? {} : { notStarted }),
      })
    },
  }
  return turn
}

function startOptions(launch: NodeLaunch, turn: NodeTurn): StartSupervisedRunOptions {
  const { context, input, checkout } = launch
  return {
    featureDir: context.featureDir,
    worktreePath: checkout.path,
    workspaceId: workspaceOf(context.api, checkout),
    branch: checkout.branch,
    issue: issueOf(context.order),
    title: agentTitle(input.role ?? input.node.stepId),
    prompt: input.prompt,
    phase: (input.role ?? input.node.id) as never,
    resumeSessionId: input.resumeSessionId,
    model: modelForTier(context.api, input.modelTier),
    effort: input.effort ?? undefined,
    addDirs: addDirsFor(input),
    ...settingsOf(launch),
    autoDecide: toolDecisionFor(launch),
    onPending: (pending) => onPending(context, pending),
    onResolved: (requestId, outcome) => recordResolution(context, turn, { requestId, outcome }),
    // Refusals reach the console. An agent being turned down looks
    // exactly like one that has gone quiet, and reading its transcript
    // was the only way to tell them apart.
    onAutoDenied: (tool, reason) => postToConsole(turn.sessionId, `refused ${tool}: ${reason}`),
    onStartFailed: (reason) => void (turn.startFailure = reason),
    onRegistered: (run) => adoptRegisteredRun(input, turn, run),
    onEnd: (exitCode) => archiveEndedSession(turn, exitCode),
    onTurnEnd: (turns) => finishNodeTurn(turn, turns),
  }
}

/** The folders outside the checkout the agent is allowed to reach: its skills and its outputs. */
function addDirsFor(input: NodeInput): string[] | undefined {
  const dirs = [input.skillsMount, input.outputsDir].filter((dir) => dir != null)
  return dirs.length === 0 ? undefined : dirs
}

/** What the node may write: the facts both its settings and its fallback decision read. */
const writeFactsOf = (input: NodeInput) => ({
  readOnly: input.readOnly,
  docsOnly: input.docsOnly === true,
  restrictedWrites: input.outputPath != null || input.outputsDir != null,
  outputsDir: input.outputsDir ?? null,
})

/** The role's permission mode and Claude settings; see `roleSettings`. */
function settingsOf({
  context,
  input,
  checkout,
}: NodeLaunch): Pick<StartSupervisedRunOptions, 'mode' | 'settings'> {
  const { api, order } = context
  const { permissionMode, settings } = roleSettings({
    ...writeFactsOf(input),
    autonomy: autonomyFor(api),
    letModeDecide: letAutoModeDecide(api),
    outputPath: input.outputPath ?? null,
    skillsMount: input.skillsMount,
    mayUseTool: input.mayUseTool,
    probedCommands: probedCommands(order),
    readOnlyTools: readOnlyTools(api, checkout.origin),
  })
  return { mode: permissionMode, settings }
}

// What Claude's settings leave to Foundry, decided in `runtime/tool-decision.ts`.
function toolDecisionFor({ context, input }: NodeLaunch): StartSupervisedRunOptions['autoDecide'] {
  return (tool, toolInput) =>
    decideTool({
      tool,
      input: toolInput,
      autonomy: autonomyFor(context.api),
      outputsDir: input.outputsDir ?? null,
      readOnly: refusesUnlistedCalls(writeFactsOf(input)),
    })
}

function postToConsole(sessionId: string, summary: string): void {
  runtime.supervision?.feed.post({ at: Date.now(), sessionId, author: 'console', summary })
}

type PendingCall = Parameters<StartSupervisedRunOptions['onPending']>[0]

function onPending(context: RunContext, pending: PendingCall): void {
  // Asks reach the console as well as the inbox, so an agent waiting on a question
  // does not look like one gone quiet (SUPERVISION.md, "Incidents behind the code").
  postToConsole(pending.sessionId, `asked about ${pending.toolName}: waiting for a decision`)
  // An agent that is asking again is an agent that got past the
  // prompt somebody answered for it.
  strandedAgents.delete(pending.sessionId)
  announceLive(context.order.id)
  notePending(context.api, { ...pending, featureDir: context.featureDir })
}

function recordResolution(
  context: RunContext,
  turn: NodeTurn,
  resolution: {
    requestId: string
    outcome: Parameters<StartSupervisedRunOptions['onResolved']>[1]
  }
): void {
  // A hand-back is not an answer. The ask stays open in the agent tab
  // instead, which an unattended run never reaches — so this is
  // the moment the agent stops, and it should say so.
  if (resolution.outcome === 'handback') {
    const { sessionId } = turn
    postToConsole(
      sessionId,
      'nobody answered, so the question stays open in the agent tab — an agent waits there'
    )
    // Recorded, not only posted. A feed entry scrolls away; this is
    // what lets the order say it is waiting on a person rather than
    // building, which is what it said for the two hours after.
    strandedAgents.set(sessionId, { orderId: context.order.id, sessionId, at: Date.now() })
    announceLive(context.order.id)
  }
  noteResolved(resolution.requestId)
}

// Set here as well as after `start` resolves, so a turn that ends
// before the promise settles still names the right session rather
// than the placeholder.
function adoptRegisteredRun(input: NodeInput, turn: NodeTurn, run: SupervisedRun): void {
  turn.sessionId = run.sessionId
  turn.transcriptFrom = run.transcriptFrom
  // The graph learns the session while the agent is in it, so Watch and Attach are
  // there while the step runs.
  input.onStarted?.(run.sessionId)
}

function archiveEndedSession(turn: NodeTurn, exitCode: number | null): void {
  // Off the live list and into the record, so a finished unit stops
  // holding a review slot and the next wave can start.
  runtime.supervision?.finish(turn.sessionId, Date.now())
  runtime.supervision?.runs.archive(
    turn.sessionId,
    exitCode === 0 ? 'ended' : 'stopped',
    Date.now()
  )
  turn.finish(exitCode)
}

function finishNodeTurn(turn: NodeTurn, turns: number): void {
  void runtime.supervision?.finishTurn(turn.sessionId, turns, Date.now())
  // The node is over when its turn is: a supervised session waits at its prompt, so
  // `onEnd` never comes. Zero because the turn ended, not because the work was good,
  // which is the verifier's and the ladder's to say (FR-033).
  turn.finish(0)
  // Nothing types into it again: a later node in the lane resumes
  // the conversation in a fresh tab. Left at its prompt, every
  // finished node kept a terminal and a process open.
  runtime.supervisedRunner?.stop(turn.sessionId)
}

function registerStartedRun(launch: NodeLaunch, turn: NodeTurn, run: SupervisedRun): void {
  const { context, input, checkout } = launch
  turn.sessionId = run.sessionId
  turn.transcriptFrom = run.transcriptFrom
  input.onStarted?.(run.sessionId)
  // The lane's open conversation, for the next node of this role; the registry
  // refuses it to a role that may not resume.
  context.conversations.set(conversationKey(input.node.lane ?? 1, input.role), run.sessionId)
  // On the register, which is what the stall detector and the palette
  // read from. Without this the agent is running and both see an idle factory —
  // the register was the seam the old phase dispatcher filled.
  runtime.supervision?.runs.add({
    sessionId: run.sessionId,
    featureDir: context.featureDir,
    phase: input.role ?? input.node.stepId,
    worktreePath: checkout.path,
    branch: checkout.branch,
    baseBranch:
      checkout.origin === '' ? null : (context.order.context.repos[0]?.baseBranch ?? null),
    terminalSessionId: run.terminalSessionId,
    transcriptPath: run.transcriptPath,
    startedAt: Date.now(),
  })
  void runtime.supervision?.measure(run.sessionId)
}
