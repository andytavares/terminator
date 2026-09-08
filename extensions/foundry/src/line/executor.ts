import {
  readyNodes,
  startReady,
  markPassed,
  markFailed,
  isComplete,
  budgetBreach,
  hasStalled,
  blockedNodes,
} from './scheduler.js'
import { withNode, stepFor, wantsFreshContext } from './run-graph.js'
import { checkExpect } from '../recipe/step-kinds.js'
import type { RunGraph, RunNode } from './run-graph.js'
import { createRoleRegistry } from './roles.js'
import type { RoleRegistry } from './roles.js'
import { brief } from './brief.js'
import { collectableWrites, rungOutputPath } from './rung-output.js'
import { orderDir } from '../data-root.js'
import type { ResolveSources } from '../recipe/resolve.js'
import type { Recipe, Rule } from '../recipe/parse.js'
import type { Budgets, RiskAssessment, WorkOrder } from '../order/schema.js'
import { verdictFromExit, summarise } from '../verify/verdict.js'
import type { Verdict } from '../verify/verdict.js'
import { inspectionFor, regrade } from '../verify/inspection-triggers.js'
import { ladderFor, climb } from '../verify/ladder.js'
import type { LadderOutcome, LadderStep } from '../verify/ladder.js'
import { raiseGate } from '../gates/rules.js'
import type { Gate, GateRuleId } from '../gates/rules.js'
import { isLive } from '../gates/autonomy.js'
import { GATE_RULES } from '../gates/rules.js'
import type { Autonomy } from '../gates/autonomy.js'

// The thing that joins the pieces.
//
// The scheduler says what may start, the role registry says how it is allowed
// to run, and a session actually runs it. Each of those was testable alone and
// none of them did anything on its own — this is where a run happens.
//
// Everything the executor enforces is enforced here rather than asked for in a
// prompt: a role that may not resume is refused a session to resume, a role
// that may not write gets a read-only decision on every tool call, and a
// verdict that came from the working session is rejected outright.

export interface StartedRun {
  readonly sessionId: string
  /** Null when the run produced no exit status — "not measured", not a failure. */
  readonly exitCode: number | null
  /**
   * Where this node's own turn starts in the lane's transcript, in bytes.
   *
   * A lane is one conversation and every node after the first resumes it, so
   * a reader with no mark answers with whatever an earlier node happened to
   * run. Absent for a caller that keeps no transcript.
   */
  readonly transcriptFrom?: number
}

/** What a rung turned out to have written, as the caller read it back. */
export interface RungCollection {
  /**
   * The order with the rung's findings on it.
   *
   * Only the *brief* is rebuilt from this. Budgets, risk and the criteria a
   * verdict is held against stay on the order that was agreed, because those
   * are the agreement and a rung mid-run is not entitled to move them. What a
   * scout read about the repository is another matter entirely: it exists to
   * inform the builder that comes after it, and before this it reached nobody.
   */
  readonly order: WorkOrder
  /** What it said it found, in one line, for the record. */
  readonly note: string
  /**
   * A disagreement with the order this run is already building from.
   *
   * Null when the rung only reported what it read. Not null when it wanted to
   * change the plan or the criteria, which cannot be applied under work
   * already in flight — so it becomes a `forge-defect`, the rule for an order
   * that contradicts itself and the one rule nothing in this build ever
   * raised.
   */
  readonly defect: string | null
}

export interface ExecutorDeps {
  /** Runs one node and resolves when its turn is over. */
  readonly run: (input: {
    node: RunNode
    role: string | null
    prompt: string
    /** Undefined for a role that may not resume, always. */
    resumeSessionId: string | undefined
    /** True when this role may not write; the caller installs the policy. */
    readOnly: boolean
    /**
     * The tier this role asked for, resolved here where the registry is.
     * 'deep' for a node with no role, so the operator's choice stands.
     */
    modelTier: 'fast' | 'deep'
    /** Whether this role declared the class of work a tool belongs to. */
    mayUseTool: (tool: string) => boolean
    /**
     * Where this rung writes what it found, or null when it has no artefact.
     *
     * The caller lets exactly this path through the read-only policy, the way
     * intake has always done for a proposal. Null for a role whose product is
     * the diff, and for a bare command.
     */
    outputPath: string | null
    /**
     * Called the moment the session exists, which is not when the turn ends.
     *
     * Without it the graph learned a node's session only once `run` resolved
     * — after the agent had finished — so a running node named nobody and the
     * Floor's Watch and Attach buttons, which need a session, appeared only
     * once there was nothing left to attach to. Optional: a caller that never
     * reports one is still named from the result.
     */
    onStarted?: (sessionId: string) => void
  }) => Promise<StartedRun>
  readonly now: () => string
  readonly sources: ResolveSources
  readonly onEvent?: (event: ExecutorEvent) => void

  /**
   * Put a raised gate where the operator will see it.
   *
   * A seam rather than a store, so the executor knows nothing about disk. A
   * run with no way to raise a gate does not silently continue past one: it
   * halts, and says which rule it could not put in front of anybody.
   */
  readonly raise?: (gate: Gate) => Promise<void>

  /** Which rules are live. Without one, everything is asked — the safe end. */
  readonly autonomy?: Autonomy

  /** The house rules in force here, for the brief. Loaded by the caller. */
  readonly rules?: readonly Rule[]

  /**
   * Run one rung of the verification ladder, returning its exit status.
   *
   * Null means it did not run, which the ladder reports as "not measured" and
   * never as a pass. Absent entirely means the whole climb is not measured —
   * honest, and visible, rather than a silent green.
   */
  readonly runStep?: (step: LadderStep) => Promise<number | null>

  /** Minutes elapsed and files touched, for the budget rules. */
  /**
   * What the run has spent so far, read against the world rather than the plan.
   *
   * May answer asynchronously, because counting the files a run has touched
   * means asking git. It used to be handed `plan.units.flatMap(touches).size`
   * — the files the plan *predicted* — so the files-touched budget measured
   * the plan and could not be exceeded by an agent going wide, which is the
   * only thing a files-touched budget is for.
   */
  readonly observe?: () =>
    | { elapsedMinutes: number; filesTouched: number }
    | Promise<{ elapsedMinutes: number; filesTouched: number }>

  /** Write a line to the order's record. */
  readonly record?: (action: string, subject: string, reason: string) => Promise<void>

  /**
   * Take what a read-only rung wrote and put it on the order.
   *
   * A seam rather than a store, for the reason `raise` is one: the executor
   * knows nothing about disk, and the order is the caller's to save. Null
   * means the rung left nothing, which is a result and is recorded as one.
   *
   * Absent entirely means rung output is not collected here — the ladder's own
   * runs and every test stub — and the brief then names no destination rather
   * than pointing an agent at a file nobody will read.
   */
  readonly collect?: (input: {
    readonly nodeId: string
    readonly role: string
    readonly outputPath: string
  }) => Promise<RungCollection | null>

  /**
   * Write the graph down, as it changes.
   *
   * The graph on disk is what `run.observe` reads, and it was written once
   * when the run started and once when it ended — so for the whole of a run
   * the Floor showed every node `waiting` while agents were working in their
   * worktrees, and a crash left a record saying nothing had started.
   */
  readonly persist?: (graph: RunGraph) => Promise<void>

  /**
   * Wait, interruptibly. Injected so a test can drive the clock.
   *
   * Used only to re-read the budget while agents are in flight — see
   * `waveOrBreach`.
   */
  readonly wait?: (ms: number) => Promise<void>

  /** How often to re-read the budget while a wave is running. */
  readonly budgetPollMs?: number

  /**
   * The session a role may carry on in, when it may.
   *
   * A recipe is one conversation per role per lane, not one agent per node: a
   * fresh agent for every step is a terminal per step and an agent that has
   * read the repository from scratch, which is what `continueRun` exists to
   * avoid. A role with `allowResume: false` is never offered one, structurally.
   *
   * **Keyed by role as well as lane, and that is the whole guard.** A node can
   * only be offered the conversation its own role has been having, so a change
   * of role has nothing to resume: the context window carries who the agent
   * has been, not only what it read, and a builder that inherited forty turns
   * of being the architect stayed the architect. A `null` role — a bare
   * command, a ladder rung — has its own, so a rung told "run this and do not
   * fix what it reports" never arrives carrying the builder's identity.
   */
  readonly sessionFor?: (lane: number, role: string | null) => string | undefined

  /**
   * What the working copies actually changed.
   *
   * The regrade and the inspection are supposed to answer for the change the
   * work turned out to be, and they were handed `plan.units.flatMap(touches)`
   * — the files the plan *predicted*, with `linesChanged` hardcoded to zero.
   * So a builder that went outside what its unit declared was invisible to
   * precisely the check that exists to notice, and no change could ever be
   * graded worse than it was planned as. The comment above the regrade already
   * said it must not read the plan; the code read the plan.
   *
   * Absent, the executor falls back to the declaration and nothing is worse
   * than it was. Present, the two are combined rather than swapped: an empty
   * answer from git means "unknown", not "nothing touched authentication".
   */
  readonly observedChange?: () => Promise<{
    readonly changedFiles: readonly string[]
    readonly linesChanged: number
  }>
}

export type ExecutorEvent =
  | { type: 'started'; nodeId: string; sessionId: string }
  | { type: 'passed'; nodeId: string }
  | { type: 'failed'; nodeId: string; needsDecision: boolean }
  | { type: 'verdict'; verdict: Verdict }
  | { type: 'inspection'; required: boolean; triggers: readonly string[] }
  | { type: 'gate'; gate: Gate }
  | { type: 'ladder'; outcome: LadderOutcome }

/**
 * Whether this shape of work ends in a pull request at all.
 *
 * A spike is a question, not a change: it opens nothing, which is FR-019 and
 * is stated in the recipe by having no ship step rather than by a flag. A
 * caller that shipped regardless would turn every investigation into a branch.
 */
export function opensPullRequest(recipe: Recipe): boolean {
  return recipe.steps.some((step) => step.kind === 'gate' && step.rule === 'ready-for-review')
}

export interface RunOutcome {
  readonly graph: RunGraph
  readonly verdicts: readonly Verdict[]
  readonly complete: boolean
  /** Nodes whose next attempt must be a decision rather than a retry. */
  readonly awaitingDecision: readonly string[]
  /** Gates this run raised. Empty when nothing needed anybody. */
  readonly gates: readonly Gate[]
  /** The climb, or null when the units never got far enough to warrant one. */
  readonly ladder: LadderOutcome | null
  /** What the accumulated change was graded, and whether it warrants a look. */
  readonly inspection: { required: boolean; triggers: readonly string[]; reason: string }
  /**
   * The grade the change turned out to deserve.
   *
   * Not the one the plan predicted. Shipping reads this, because a change
   * planned as P3 that turns out to touch authentication must still take the
   * decision that its real grade calls for.
   */
  readonly risk: RiskAssessment
  /**
   * True when the work is finished *and* nothing is waiting on a person, so
   * the caller may ship. Distinct from `complete`: a graph with every node
   * passed and an open gate is complete and must not ship.
   */
  readonly shippable: boolean
}

/**
 * What this node's agent is told.
 *
 * The role's prompt plus whatever that role declared it may read, resolved
 * against this order and this unit. The bare prompt on its own describes a
 * job and names no work, which is every "it built the wrong thing" failure.
 */
/** Whether a recipe named a rule this build knows. */
function isGateRule(value: unknown): value is GateRuleId {
  return typeof value === 'string' && (GATE_RULES as readonly string[]).includes(value)
}

function promptFor(
  order: WorkOrder,
  recipe: Recipe,
  node: RunNode,
  roles: RoleRegistry,
  rules: readonly Rule[],
  outputPath: string | null
): string {
  const step = stepFor(recipe, node)
  if (step === undefined) return ''
  return brief({
    order,
    role: node.role === null ? null : roles.get(node.role),
    unit:
      node.unitId === null ? null : (order.plan.units.find((u) => u.id === node.unitId) ?? null),
    rules,
    command: step.kind === 'run' ? (step.command ?? '') : undefined,
    outputPath: outputPath ?? undefined,
  })
}

/**
 * Run everything that can run, one wave at a time, until nothing else can.
 *
 * A wave rather than a loop over nodes because the agent budget is a property
 * of the whole graph: what may start depends on what is already running, so
 * starting them one at a time and asking again is the only way the limit means
 * anything.
 */
export async function execute(
  order: WorkOrder,
  recipe: Recipe,
  graph: RunGraph,
  deps: ExecutorDeps
): Promise<RunOutcome> {
  const roles = createRoleRegistry(deps.sources)
  const budgets: Budgets = order.budgets
  const rules = deps.rules ?? []
  const autonomy: Autonomy = deps.autonomy ?? 'escorted'
  const verdicts: Verdict[] = []
  /** unit id → the session that did the work, so a checker is never it. */
  const producedUnit = new Map<string, string>()
  const awaitingDecision: string[] = []
  const gates: Gate[] = []

  let current = graph
  let gateSeq = 0

  /**
   * The order as later briefs see it, which is not the order the run is judged
   * against. See `RungCollection.order`.
   */
  let briefed: WorkOrder = order

  /**
   * Move to the next state of the graph, and say so.
   *
   * Every reassignment of `current` goes through here, so there is one place
   * that can be wrong rather than fifteen.
   */
  async function advance(next: RunGraph): Promise<void> {
    current = next
    // Never fatal: a run that cannot write its graph down is still a run, and
    // failing it here would turn a reporting problem into a lost agent.
    await deps.persist?.(current).catch(() => undefined)
  }

  /** Nodes whose session is already on the graph, so a late write is not a second start. */
  const announced = new Set<string>()

  /**
   * Put a node's session on the graph, and say it started.
   *
   * Called the moment the agent exists rather than when its turn ends. Both
   * happen: `run` reports the session as it comes up, and the result names it
   * again for a caller that reports nothing — the set is what makes the second
   * one a no-op instead of a second start.
   *
   * The Floor renders Watch and Attach on `node.sessionId !== null`, so before
   * this a running rung had no controls at all and the only agent you could
   * reach was one that had already finished.
   */
  async function noteStarted(nodeId: string, sessionId: string): Promise<void> {
    if (announced.has(nodeId)) return
    announced.add(nodeId)
    await advance(withNode(current, nodeId, { sessionId }))
    deps.onEvent?.({ type: 'started', nodeId, sessionId })
  }

  /**
   * Where this node writes what it found, or null when it has nothing to file.
   *
   * Null for a role whose product is the checkout, for a bare command, and for
   * a caller that collects nothing — an agent told to write a file nobody will
   * read is worse off than one told nothing.
   */
  function outputFor(node: RunNode, roleId: string | null): string | null {
    if (roleId === null || deps.collect === undefined) return null
    const role = roles.get(roleId)
    if (role === null || collectableWrites(role).length === 0) return null
    try {
      return rungOutputPath(orderDir(deps.sources.dataRoot, order.id), node.id)
    } catch {
      // A node id a recipe gave that would not sit under this order. Refusing
      // the channel is right; failing the run over it is not.
      return null
    }
  }

  /**
   * Raise one, if this autonomy setting is asking about it.
   *
   * Returns true when the run must stop. A rule this setting silences raises
   * nothing and stops nothing — that is what the dial *is*. A rule it asks
   * about, with nowhere to put the question, still stops: continuing past a
   * decision nobody could take is the failure the gates exist to prevent.
   */
  async function raise(
    rule: GateRuleId,
    input: {
      summary: string
      why: string
      nodeId?: string | null
      blockedUnits?: number
      /**
       * Minutes before this gate takes its stated default. A recipe's own
       * `deadlineMinutes`, when the step declared one — without this the field
       * parsed and reached nothing, so "what happens when nobody answers" was
       * a promise no gate could keep.
       */
      deadlineMinutes?: number
    }
  ): Promise<boolean> {
    if (!isLive(rule, autonomy)) return false
    gateSeq += 1
    const gate = raiseGate({
      id: `${order.id}-${rule}-${gateSeq}`,
      rule,
      orderId: order.id,
      nodeId: input.nodeId ?? null,
      summary: input.summary,
      why: input.why,
      riskGrade: order.risk.grade,
      blockedUnits: input.blockedUnits ?? current.nodes.filter((n) => n.state === 'waiting').length,
      at: deps.now(),
      deadline:
        input.deadlineMinutes === undefined
          ? null
          : new Date(Date.parse(deps.now()) + input.deadlineMinutes * 60_000).toISOString(),
    })
    gates.push(gate)
    deps.onEvent?.({ type: 'gate', gate })
    await deps.raise?.(gate)
    return true
  }

  let halted = false
  let stalled = false

  /** The budget, read against what is happening right now. */
  async function currentBreach(): Promise<ReturnType<typeof budgetBreach>> {
    const observed = (await deps.observe?.()) ?? { elapsedMinutes: 0, filesTouched: 0 }
    return budgetBreach(budgets, {
      ...observed,
      agents: current.nodes.filter((n) => n.state === 'running').length,
    })
  }

  /**
   * Wait for the wave, or for the budget to be exceeded while it runs.
   *
   * Checking budgets only *between* waves means a single agent that never
   * returns is the one case the check cannot catch — and it is the case the
   * budget exists for. FR-030 asks for a pause when the budget is exceeded,
   * not for one when the wave that exceeded it happens to end.
   *
   * The agents are not killed: their terminals are still there and their work
   * is still in the worktree, which is what "preserving work in progress"
   * means. The run stops asking for more.
   */
  async function waveOrBreach<T>(
    wave: Promise<T[]>
  ): Promise<{ results: T[] } | { breach: NonNullable<ReturnType<typeof budgetBreach>> }> {
    const pollMs = deps.budgetPollMs ?? 15_000
    const wait = deps.wait
    if (wait === undefined) return { results: await wave }

    let settled = false
    const done = wave.then((results) => {
      settled = true
      return results
    })

    for (;;) {
      const raced = await Promise.race([
        done.then((results) => ({ results })),
        wait(pollMs).then(() => null),
      ])
      if (raced !== null) return raced
      if (settled) return { results: await done }
      const breach = await currentBreach()
      if (breach !== null) return { breach }
    }
  }

  while (!isComplete(current) && !halted) {
    // Budgets are part of the agreement, not advice. Checked before a wave
    // rather than after, so a breach stops the next agent instead of being
    // discovered once it has spent its turn.
    const breach = await currentBreach()
    if (breach !== null) {
      halted = await raise('budget.exceeded', {
        summary: `${order.title} has gone past its ${breach.kind.replace('_', ' ')} budget`,
        why: `The order budgets ${breach.limit} and this run is at ${Math.round(breach.actual)}.`,
      })
      if (halted) break
    }

    const ready = readyNodes(current, budgets)
    if (ready.length === 0) {
      // Nothing running, nothing runnable, and not finished: the graph cannot
      // move on its own. Said out loud, because reporting it as "waiting on a
      // gate" when no gate exists is a run that looks answerable and is not.
      if (hasStalled(current, budgets)) {
        halted = await raise('verify.repeat-fail', {
          summary: `${order.title} cannot go any further on its own`,
          why: `${blockedNodes(current).length} units are blocked and nothing is runnable. Something they depend on failed, or the plan has a cycle.`,
        })
        stalled = true
      }
      break
    }

    // A join is a synchronisation point, not work. Its dependencies are what
    // it was waiting for, and the scheduler only offered it because they are
    // done — so it passes here rather than being launched as an agent with
    // nothing to do, which is what it used to be.
    const joins = ready.filter((node) => node.kind === 'join')
    if (joins.length > 0) {
      for (const join of joins) await advance(markPassed(current, join.id, deps.now()))
      continue
    }

    // A gate node in the recipe is a stated pause. It is not the executor's to
    // answer: it is raised, and the run stops until the inbox comes back.
    //
    // The rule is the recipe's own — every shipped recipe declares one, and
    // ignoring it in favour of a hardcoded rule would give the operator the
    // wrong question, the wrong options and the wrong default.
    const blocking = ready.find((node) => node.kind === 'gate')
    if (blocking !== undefined) {
      const declared = stepFor(recipe, blocking)?.rule

      // A recipe's terminal `ready-for-review` gate is its way of saying
      // "shipping happens here". It is not a pause: the real decision is
      // raised once the drafts exist, by whatever opens them, because "mark it
      // ready?" asked before there is anything to mark is a question with no
      // answer. So it passes, and the tail takes it from here.
      if (declared === 'ready-for-review') {
        await advance(markPassed(current, blocking.id, deps.now()))
        continue
      }

      const rule: GateRuleId = isGateRule(declared) ? declared : 'unit.boundary'
      halted = await raise(rule, {
        summary: `${order.title} reached the "${blocking.stepId}" checkpoint`,
        why: `The "${recipe.id}" shape of work stops here by design.`,
        nodeId: blocking.id,
        deadlineMinutes: stepFor(recipe, blocking)?.deadlineMinutes,
      })
      // A silenced checkpoint is a checkpoint that does not stop anything —
      // but the node still has to leave the graph, or the wave loops on it.
      await advance(markPassed(current, blocking.id, deps.now()))
      if (halted) break
      continue
    }

    const started = startReady(current, budgets, deps.now())
    await advance(started.graph)

    const wave = Promise.all(
      started.started
        .map((id) => current.nodes.find((n) => n.id === id))
        .filter((n): n is RunNode => n !== undefined && n.kind !== 'gate')
        .map(async (node) => {
          const roleId = node.role
          // One conversation per lane, where the role allows it. A fresh agent
          // per node is a terminal per node and an agent that has read nothing
          // — which is what `continueRun` exists to avoid.
          //
          // `assertResumable` is what makes the permission structural: a role
          // with `allowResume: false` is *handed* undefined, so the refusal
          // cannot be forgotten by a caller.
          // A step may demand a fresh conversation even from a role that is
          // allowed to resume. Five of the six built-in shapes say
          // `context: fresh` on their verify step, and it reached nothing —
          // the effect happened to hold only because the verifier's own role
          // file forbids resuming, so a recipe asking it of any other role got
          // a resumed session anyway.
          const wantsFresh = wantsFreshContext(recipe, node)
          // And never across a change of role.
          //
          // The conversation carries who the agent has been, not only what it
          // has read, and forty turns of being the architect outweigh a
          // paragraph saying the next turn is the builder's. Three live runs
          // died on it. The last one ended with the builder writing its own
          // recap: "I've handed over the work order with criteria and two
          // units, and I'm waiting on your sign-off plus write access to
          // implement." It was still the architect, waiting to be approved,
          // while the graph said the unit was being built.
          //
          // This is what `context: fresh` already says for the verifier, and
          // the evidence is that it is not a verifier quirk — it is what a
          // change of role needs. What the architect produced is carried by
          // the work order, which is the artefact for exactly that, rather
          // than by a context window that also carries its posture.
          //
          // A role continuing its own work still resumes, which is where the
          // saving was: a builder taking a second unit in the same lane keeps
          // everything it learned taking the first. `sessionFor` keys on the
          // role, so across a boundary there is simply nothing to offer.
          const offered = wantsFresh ? undefined : deps.sessionFor?.(node.lane ?? 1, roleId)
          const resumeSessionId =
            roleId !== null && offered !== undefined && roles.mayResume(roleId)
              ? offered
              : undefined
          if (roleId !== null) roles.assertResumable(roleId, resumeSessionId)
          const readOnly = roleId !== null && !roles.mayWrite(roleId)
          const outputPath = outputFor(node, roleId)

          const result = await deps.run({
            node,
            role: roleId,
            prompt: promptFor(briefed, recipe, node, roles, rules, outputPath),
            resumeSessionId,
            readOnly,
            modelTier: (roleId === null ? null : roles.get(roleId))?.modelTier ?? 'deep',
            mayUseTool: (tool) => roleId === null || roles.mayUseTool(roleId, tool),
            outputPath,
            // Reported as it happens rather than waited for: this is what puts
            // a session on a node while there is still an agent in it.
            onStarted: (sessionId) => void noteStarted(node.id, sessionId),
          })
          return { node, result, roleId, readOnly, outputPath }
        })
    )

    const waved = await waveOrBreach(wave)
    if ('breach' in waved) {
      const { breach } = waved
      halted = await raise('budget.exceeded', {
        summary: `${order.title} has gone past its ${breach.kind.replace('_', ' ')} budget`,
        why:
          `The order budgets ${breach.limit} and this run is at ${Math.round(breach.actual)}. ` +
          `Its agents are still in their terminals — nothing was thrown away.`,
      })
      // Even where the rule is silenced, a run past its budget stops asking
      // for more. The budget is part of what was agreed, not a preference.
      break
    }
    const { results } = waved

    for (const { node, result, roleId, readOnly, outputPath } of results) {
      // A no-op when the run already reported its session. Kept for the caller
      // that reports none — every ladder rung, and every test stub.
      await noteStarted(node.id, result.sessionId)

      // What the rung actually produced, which for a read-only role is the
      // whole of its work. Before this the brief named no destination and
      // nothing read a result past its exit status, so a scout's report, an
      // architect's plan and a red team's attack all ended in a terminal
      // nobody read and the node passed regardless.
      if (outputPath !== null && roleId !== null) {
        const collected = await deps
          .collect?.({ nodeId: node.id, role: roleId, outputPath })
          // Never fatal, for the reason `persist` is not: a run that cannot
          // file what a rung wrote is still a run.
          .catch(() => null)

        if (collected === null || collected === undefined) {
          await deps.record?.(
            'rung.wrote_nothing',
            node.id,
            `The ${roleId} left nothing at ${outputPath}. Its turn ended, so whatever it worked out is only in its terminal.`
          )
        } else {
          // What the next rung is told. The agreement it is judged against is
          // deliberately not this.
          briefed = collected.order
          await deps.record?.(
            'rung.collected',
            node.id,
            collected.note === '' ? `the ${roleId} filed its result` : collected.note
          )
          if (collected.defect !== null) {
            halted =
              (await raise('forge-defect', {
                summary: `${order.title} is contradicted by its own ${roleId}`,
                why: collected.defect,
                nodeId: node.id,
              })) || halted
          }
        }
      }

      // Who produced the work on this unit, so the party checking it can be
      // held against them rather than against itself.
      if (node.unitId !== null && !readOnly) producedUnit.set(node.unitId, result.sessionId)

      // The verdict comes from the exit status. Whatever the run printed is
      // evidence, never the decision.
      //
      // **Only from a checking party.** A role that may write is the one that
      // did the work, and its turn ending says nothing whatever about whether
      // the criteria its unit claims are met — that claim is precisely what
      // verification exists to test. This block used to run for every node
      // with a unit, so a builder finishing stamped `pass` on every criterion
      // the unit `satisfies`, off its own exit code, labelled `verifier`.
      //
      // `makeVerdict` has a structural guard against exactly that, and this
      // caller walked around it: passing `${sessionId}-verify` as the checking
      // session is a string that differs from the working one by a suffix, so
      // the guard sees two sessions where there is one. The independence is
      // real now — the checker's own session, held against the builder's.
      //
      // Found by a live run: a verifier read the file, saw the change had
      // never been made, and then found a `pass` already in the ledger for the
      // criterion it was there to judge, stamped at the millisecond the
      // builder's turn ended.
      if (node.unitId !== null && readOnly) {
        const criteria = order.plan.units.find((u) => u.id === node.unitId)?.satisfies ?? []
        for (const criterionId of criteria) {
          const verdict = verdictFromExit({
            nodeId: node.id,
            criterionId,
            command: `${node.role ?? node.stepId} on ${node.unitId}`,
            exitCode: result.exitCode,
            // The session that produced the work being checked — not this
            // one. Where the two are the same session, `makeVerdict` refuses.
            nodeSessionId: producedUnit.get(node.unitId) ?? null,
            producedBy: { role: roleId ?? node.stepId, sessionId: result.sessionId },
            at: deps.now(),
          })
          verdicts.push(verdict)
          deps.onEvent?.({ type: 'verdict', verdict })
        }
      }

      // A judge declares what it expects; checking it is what makes it a judge
      // rather than another agent. Parsed, validated and then ignored was the
      // state of this before.      // What a step's own result actually offers. `suite_exit_code` is an
      // alias: for a `run` step the suite *is* the step, and the bugfix shape
      // names it that way to say which exit status it means.
      const step = stepFor(recipe, node)
      const observed: Record<string, unknown> = {
        exit_code: result.exitCode,
        exitCode: result.exitCode,
        suite_exit_code: result.exitCode,
      }

      // A key nothing can supply is *not measured* — never a silent pass and
      // never a silent failure. `tests_added` needs diff metrics this path
      // does not gather, so an expectation naming it is recorded and the step
      // falls back to its exit status, rather than becoming a shape that can
      // never pass.
      const named = Object.keys(step?.expect ?? {})
      const unmeasurable = named.filter((key) => !(key in observed))
      const measurable = Object.fromEntries(
        Object.entries(step?.expect ?? {}).filter(([key]) => key in observed)
      )
      const promised = named.length > unmeasurable.length

      const unmet = checkExpect(measurable, observed).map(
        (failure) => `${failure.key} expected ${failure.expected}, got ${String(failure.actual)}`
      )
      if (unmeasurable.length > 0) {
        await deps.record?.(
          'step.expectation_not_measured',
          node.id,
          `${node.stepId} promised ${unmeasurable.join(', ')}, which nothing here measures. Judged on its exit status instead.`
        )
      }

      // A measurable expectation *replaces* the exit-status judgement rather
      // than adding to it. That is what lets the bugfix shape say a
      // reproduction must fail before the fix exists — the one place a passing
      // command is the wrong answer, and where reading exit 0 as success would
      // pass a reproduction that reproduces nothing.
      const passed = promised ? unmet.length === 0 : result.exitCode === 0

      if (passed) {
        await advance(markPassed(current, node.id, deps.now()))
        deps.onEvent?.({ type: 'passed', nodeId: node.id })
      } else {
        if (unmet.length > 0) {
          await deps.record?.(
            'step.expectation_unmet',
            node.id,
            `${node.stepId} did not meet what it promised: ${unmet.join('; ')}`
          )
        }
        const failure = markFailed(current, node.id, deps.now())
        await advance(failure.graph)
        deps.onEvent?.({ type: 'failed', nodeId: node.id, needsDecision: failure.needsDecision })

        if (failure.needsDecision) {
          awaitingDecision.push(node.id)
          // Two failures is a pattern, not bad luck. The third attempt is a
          // decision rather than a retry, and this is where it is asked for.
          halted =
            (await raise('verify.repeat-fail', {
              summary: `${node.unitId ?? node.id} failed twice`,
              why: `Attempt ${node.attempts + 1} of ${node.id} exited ${result.exitCode ?? 'without a status'}. A third try is a decision, not a retry.`,
              nodeId: node.id,
            })) || halted
        }
      }
    }
  }

  // The accumulated change, not any single unit — which is what stops a unit
  // finishing early from skipping the inspection.
  const declared = order.plan.units.flatMap((u) => u.touches)
  // What the plan said, plus what the work did. Combined rather than swapped,
  // because git reporting nothing means it could not be read — and reading
  // that as "nothing touched authentication" is how a P0 quietly grades P3.
  const seen = deps.observedChange === undefined ? null : await deps.observedChange()
  const touched = [...new Set([...declared, ...(seen?.changedFiles ?? [])])]
  const summary = summarise(verdicts)
  const observed = {
    changedFiles: touched,
    linesChanged: seen?.linesChanged ?? 0,
    checkState: (summary.ok ? 'passing' : 'failing') as 'passing' | 'failing',
  }
  const inspection = inspectionFor(order, observed)

  // The grade the change turned out to deserve, not the one the plan predicted.
  // Shipping reads this: a change planned as P3 that turns out to touch
  // authentication must take the operator's decision before it reaches the
  // remote, and reading the stale grade is how it would not have.
  const risk = regrade(order, observed)
  deps.onEvent?.({
    type: 'inspection',
    required: inspection.required,
    triggers: inspection.triggers,
  })

  // The ladder runs over the finished work, and only when there is finished
  // work to climb over: a run that halted at a gate has not earned a verdict
  // on the whole change, and reporting one would be inventing it.
  let ladder: LadderOutcome | null = null
  if (!halted && !stalled && isComplete(current)) {
    ladder = await climb(
      ladderFor({
        toolchain: order.context.toolchain,
        risk,
        touchesUi: touched.some((path) => /\.(tsx|css|html|svelte|vue)$/.test(path)),
      }),
      deps.runStep ?? (() => Promise.resolve(null))
    )
    deps.onEvent?.({ type: 'ladder', outcome: ladder })
  }

  // The three rules that fire on what the change turned out to be, rather than
  // on what the plan said it would be. Raised after the work, because that is
  // when the answer exists.
  if (!halted && ladder !== null) {
    if (inspection.required) {
      halted = await raise('risk.p0', {
        summary: `${order.title} graded ${risk.grade} once it was done${
          risk.grade === order.risk.grade ? '' : ` — it was planned as ${order.risk.grade}`
        }`,
        why: `${inspection.reason} Triggered by ${inspection.triggers.join(', ')}.`,
      })
    }
    if (!halted && !ladder.ok) {
      halted = await raise('verify.repeat-fail', {
        summary: `${order.title} did not pass verification`,
        why:
          ladder.stoppedAt === null
            ? `Nothing failed, but ${ladder.unmeasured.join(', ')} could not be measured here.`
            : `The climb stopped at ${ladder.stoppedAt}: ${ladder.steps.find((s) => s.result === 'fail')?.reason ?? 'a step failed'}.`,
      })
    }
  }

  const complete = isComplete(current)
  return {
    graph: current,
    verdicts,
    complete,
    awaitingDecision,
    gates,
    ladder,
    inspection: {
      required: inspection.required,
      triggers: inspection.triggers,
      reason: inspection.reason,
    },
    risk,
    // Everything done, nothing waiting on a person, and the climb either
    // passed or was never owed. A complete graph with an open gate is not
    // shippable, which is the distinction this field exists to make.
    // A shape with no ship step never ships, however well it went.
    shippable:
      opensPullRequest(recipe) &&
      complete &&
      !halted &&
      !stalled &&
      gates.length === 0 &&
      (ladder?.ok ?? false),
  }
}
