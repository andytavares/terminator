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
import { trustRepository, isProbedCommand } from '../runtime/agent-policy.js'
import { runtime, strandedAgents } from '../runtime/runtime-state.js'
import { notePending, noteResolved } from '../runtime/held-calls.js'
import { readOnlyTools, autonomyFor, letAutoModeDecide, modelForTier } from '../state/settings.js'
import { announceLive } from '../state/live-index.js'

type NodeInput = Parameters<ExecutorDeps['run']>[0]

/** One node's turn as it goes: the session it got, and settling it exactly once. */
interface NodeTurn {
  sessionId: string
  // Where this node's turn begins in the lane's transcript. Every node
  // after the first resumes that conversation, so without the mark a rung
  // reads an earlier node's tool calls as its own.
  transcriptFrom: number
  readonly finish: (exitCode: number | null) => void
}

/** Where one node runs: the run, the node, and the lane checkout it runs in. */
interface NodeLaunch {
  readonly context: RunContext
  readonly input: NodeInput
  readonly checkout: Checkout
}

/**
 * One node, from launch to the end of its turn.
 *
 * A promise around the runner's callbacks rather than an await, because the
 * runner reports an ending through `onEnd` and returns as soon as the
 * session exists. Settled exactly once: an agent that both fails to start
 * and reports an end would otherwise resolve twice.
 */
export function runNode(context: RunContext, input: NodeInput): Promise<StartedRun> {
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
  // Claude Code shows its workspace trust dialog for a directory it has
  // not seen, in interactive sessions only — and this is an interactive
  // session by design. Without this the agent comes up, sits at that
  // dialog, and never starts: the process is running, the register has it,
  // the graph says `running`, and nothing happens for ever.
  //
  // Keyed to the repository rather than the worktree, because that is what
  // the documentation says trust is keyed to for a worktree.
  const { context, checkout } = launch
  trustRepository(context.api, checkout.origin, context.order.id, context.store)
  void runner
    .start(startOptions(launch, turn))
    .then((run) => {
      if (run === null) {
        turn.finish(null)
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
    finish: (exitCode) => {
      if (settled) return
      settled = true
      resolve({ sessionId: turn.sessionId, exitCode, transcriptFrom: turn.transcriptFrom })
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
    addDirs: input.skillsMount === null ? undefined : [input.skillsMount],
    autoDecide: toolDecisionFor(launch),
    onPending: (pending) => onPending(context, pending),
    onResolved: (requestId, outcome) => onResolved(context, turn, { requestId, outcome }),
    // Refusals reach the console. An agent being turned down looks
    // exactly like one that has gone quiet, and reading its transcript
    // was the only way to tell them apart.
    onAutoDenied: (tool, reason) => postToConsole(turn.sessionId, `refused ${tool}: ${reason}`),
    onRegistered: (run) => onRegistered(input, turn, run),
    onEnd: (exitCode) => onEnd(turn, exitCode),
    onTurnEnd: (turns) => onTurnEnd(turn, turns),
  }
}

// The read-only decision is taken by the same policy the hook
// applies, so a verifier that decides to fix what it found is
// refused rather than reminded.
// Two gates, not one. Read-only is the whole-role decision; the
// second holds a role that may write to what it said it writes with
// — a scribe that decided to edit source rather than documentation
// is refused by the first if it has no checkout, and by neither if
// the only check were "may this role write at all".
// Composed in `runtime/tool-decision.ts`, where it can be tested:
// every live failure of this feature that was not a stall came from
// this decision, and the tests that mention `autoDecide` all pass a
// stub, so they covered the bridge and never the decision.
function toolDecisionFor({
  context,
  input,
  checkout,
}: NodeLaunch): StartSupervisedRunOptions['autoDecide'] {
  const { api, order } = context
  return (tool, toolInput) =>
    decideTool({
      tool,
      input: toolInput,
      readOnly: input.readOnly,
      role: input.role,
      mayUseTool: input.mayUseTool,
      docsOnly: input.docsOnly,
      isProbed: (name, given) => isProbedCommand(order, name, given),
      readOnlyTools: readOnlyTools(api),
      autonomy: autonomyFor(api),
      letModeDecide: letAutoModeDecide(api),
      worktreePath: checkout.path,
      outputPath: input.outputPath ?? null,
      outputsDir: input.outputsDir ?? null,
      skillsMount: input.skillsMount,
    })
}

function postToConsole(sessionId: string, summary: string): void {
  runtime.supervision?.feed.post({ at: Date.now(), sessionId, author: 'console', summary })
}

type PendingCall = Parameters<StartSupervisedRunOptions['onPending']>[0]

function onPending(context: RunContext, pending: PendingCall): void {
  // Asks reach the console as well as the inbox. A refusal is posted
  // here and a *question* was not, so an agent waiting on one looked
  // exactly like an agent that had gone quiet — which is what it
  // then became. Watched live: a builder redirected its test output
  // to a scratch file outside the checkout, FR-050 asked about it,
  // nobody was there, the bridge handed the call back to the
  // terminal's own prompt five minutes later, and the run sat until
  // the wall-clock budget ended it half an hour on. Nothing anywhere
  // said a question had been asked.
  postToConsole(pending.sessionId, `asked about ${pending.toolName}: waiting for a decision`)
  // An agent that is asking again is an agent that got past the
  // prompt somebody answered for it.
  strandedAgents.delete(pending.sessionId)
  announceLive(context.order.id)
  notePending(
    context.api,
    { ...pending, featureDir: context.featureDir },
    { id: context.order.id, root: context.root }
  )
}

function onResolved(
  context: RunContext,
  turn: NodeTurn,
  resolution: {
    requestId: string
    outcome: Parameters<StartSupervisedRunOptions['onResolved']>[1]
  }
): void {
  // A hand-back is not an answer. The runtime puts its own prompt in the
  // terminal instead, which an unattended run never reaches — so this is
  // the moment the agent stops, and it should say so.
  if (resolution.outcome === 'handback') {
    const { sessionId } = turn
    postToConsole(
      sessionId,
      'nobody answered, so the question went to the prompt in the terminal — an agent waits there'
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
function onRegistered(input: NodeInput, turn: NodeTurn, run: SupervisedRun): void {
  turn.sessionId = run.sessionId
  turn.transcriptFrom = run.transcriptFrom
  // The graph learns the session while there is still an agent in
  // it. Before this the Floor's Watch and Attach appeared only after
  // the turn ended, so the one moment you needed a terminal was the
  // one moment there was no way into it.
  input.onStarted?.(run.sessionId)
}

function onEnd(turn: NodeTurn, exitCode: number | null): void {
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

function onTurnEnd(turn: NodeTurn, turns: number): void {
  void runtime.supervision?.finishTurn(turn.sessionId, turns, Date.now())
  // The node is over when the *turn* is over, not when the process
  // is. A supervised session sits at its prompt after answering —
  // that is the whole point of running it in a terminal you can
  // type into — so waiting for `onEnd` waits for something that
  // never happens, and the Line could not complete a single agent
  // node. Intake has always got this right; this is the same rule.
  //
  // Zero because the turn ended, not because the work was good:
  // whether it was is the verifier's to say and the ladder's to
  // measure, never the producing agent's (FR-033).
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
  // The lane's open conversation, for the next node that may carry it
  // on. A role that may not resume is never offered it — the registry
  // refuses, structurally — and neither is a role that is not the one
  // whose conversation this is.
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
