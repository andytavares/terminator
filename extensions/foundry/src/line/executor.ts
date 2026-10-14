import type { RunGraph, RunNode } from './run-graph.js'
import type { CommitOutcome } from './commit.js'
import type { ResolveSources } from '../recipe/resolve.js'
import type { EffortLevel, Recipe, Rule } from '../recipe/parse.js'
import type { DocumentHandBack, RiskAssessment, WorkOrder } from '../order/schema.js'
import type { Verdict } from '../verify/verdict.js'
import type { LadderOutcome, LadderStep } from '../verify/ladder.js'
import type { Gate } from '../gates/rules.js'
import type { Autonomy } from '../gates/autonomy.js'
import { Execution } from './execution.js'
import { runWaves } from './execution-waves.js'
import { finishExecution } from './execution-final.js'

export { opensPullRequest, skillsFor } from './execution-parts.js'

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
  /** The document this rung handed back, when it handed one back. */
  readonly document?: DocumentHandBack | null
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
    /**
     * How hard this node's agent works: the step's own effort, else the
     * recipe's, else null. Null for a fast-tier role always, because the fast
     * model takes none — and null means "pass no flag", never a default.
     */
    effort: EffortLevel | null
    /** Whether this role declared the class of work a tool belongs to. */
    mayUseTool: (tool: string) => boolean
    /**
     * The role writes documentation and nothing else, so the caller refuses
     * its edits to anything that is not a documentation path.
     */
    docsOnly?: boolean
    /**
     * Where this rung writes what it found, or null when it has no artefact.
     *
     * The caller lets exactly this path through the read-only policy, the way
     * intake has always done for a proposal. Null for a role whose product is
     * the diff, and for a bare command.
     */
    outputPath: string | null
    /**
     * The order's own `outputs/` directory, or null.
     *
     * Given only to a role that hands back a document, which may write there
     * as well as to documentation in the checkout.
     */
    outputsDir: string | null
    /**
     * Where this node's skills were mounted, or null when it declared none.
     *
     * Handed to the caller so it can pass `--add-dir` and put the same value
     * on the tool decision — a node's skills are readable and nothing else
     * about the mount is.
     */
    skillsMount: string | null
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

  /**
   * Run a `run` step's command directly, rather than handing it to an agent as
   * an instruction.
   *
   * Without this every `run` step went to `deps.run`, which starts an agent
   * session; the agent was told "run this exactly" and the turn's end reported
   * exit 0 regardless, so a `run` step could never actually fail.
   */
  readonly runCommand: (input: {
    node: RunNode
    command: string
    title: string
    logPath: string
  }) => Promise<number | null>

  /**
   * Commit what a node's agent left in its lane's checkout.
   *
   * Nothing else ever runs `git commit`, so without it a branch has no commits
   * to push and a pull request has nothing to open on. A clean tree is how an
   * agent that passed having changed nothing is told from one that did the
   * work, and a refusal from both.
   */
  readonly commitNode: (input: { node: RunNode; message: string }) => Promise<CommitOutcome>

  /**
   * End a lane's live session before it is resumed.
   *
   * The previous process of that conversation may still be sitting at its
   * prompt; two processes must not share one conversation — the same reason
   * `endAndWait` exists in `src/runtime/end-session.ts`.
   */
  readonly endSession: (sessionId: string) => Promise<void>

  readonly now: () => string
  readonly sources: ResolveSources
  readonly onEvent: (event: ExecutorEvent) => void

  /**
   * Put a raised gate where the operator will see it.
   *
   * A seam rather than a store, so the executor knows nothing about disk.
   */
  readonly raise: (gate: Gate) => Promise<void>

  /**
   * This order's gates from earlier attempts. A resume re-runs everything
   * after the last passed node, so a rule that fires on the finished work
   * fires again; without these, Approve resumed straight into the same gate.
   */
  readonly priorGates: readonly Gate[]

  /** Which rules are live. */
  readonly autonomy: Autonomy

  /** The house rules in force here, for the brief. Loaded by the caller. */
  readonly rules: readonly Rule[]

  /**
   * Run one rung of the verification ladder, returning its exit status.
   *
   * Null means it did not run, which the ladder reports as "not measured" and
   * never as a pass.
   */
  readonly runStep: (step: LadderStep, logPath: string) => Promise<number | null>

  /**
   * Run one rung in a checkout of the order's base branch, without this change.
   *
   * It is how a failure the change caused is told from one that was already
   * there. Null means it could not run there, which is "not known", never
   * "passes on the base".
   */
  readonly runStepOnBase: (step: LadderStep, logPath: string) => Promise<number | null>

  /**
   * Let go of the base checkout `runStepOnBase` used. Called once, in a
   * `finally`, after any base run, so a throwing rung cannot leave it behind.
   */
  readonly releaseBase: () => Promise<void>

  /**
   * Install the dependencies afresh in the order's own checkout or the base
   * checkout, returning the install's exit status. Null means it could not run.
   */
  readonly reinstall: (where: 'change' | 'base', logPath: string) => Promise<number | null>

  /** Minutes elapsed, for the wall-clock budget. */
  readonly observe: () => { elapsedMinutes: number } | Promise<{ elapsedMinutes: number }>

  /** Write a line to the order's record. */
  readonly record: (action: string, subject: string, reason: string) => Promise<void>

  /**
   * Take what a read-only rung wrote and put it on the order.
   *
   * A seam rather than a store, for the reason `raise` is one: the executor
   * knows nothing about disk, and the order is the caller's to save. Null
   * means the rung left nothing, which is a result and is recorded as one.
   */
  readonly collect: (input: {
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
  readonly persist: (graph: RunGraph) => Promise<void>

  /**
   * Wait, interruptibly. Injected so a test can drive the clock.
   *
   * Used only to re-read the budget while agents are in flight — see
   * `waveOrBreach`.
   */
  readonly wait: (ms: number) => Promise<void>

  /**
   * Called once the graph's work is done and before the final check climbs,
   * but only when no inspection is owed. The caller opens the drafts here (and
   * starts watching their CI) so the check runs while CI does. It decides for
   * itself whether the shipping mode allows that; resolves true when drafts are
   * open, in which case a failed climb is recorded as `ship.final_check_failed`.
   */
  readonly beforeFinalCheck?: (input: {
    readonly risk: RiskAssessment
    readonly verdicts: readonly Verdict[]
  }) => Promise<boolean>

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
  readonly sessionFor: (lane: number, role: string | null) => string | undefined

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
   * The two are combined rather than swapped: an empty answer from git means
   * "unknown", not "nothing touched authentication".
   */
  readonly observedChange: () => Promise<{
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

/** What a run is of: the order, the shape of work it follows, and the graph built from both. */
export interface RunPlan {
  readonly order: WorkOrder
  readonly recipe: Recipe
  readonly graph: RunGraph
}

/**
 * Run everything that can run, one wave at a time, until nothing else can,
 * then climb the final check over the finished work.
 *
 * The waves are `runWaves` (execution-waves.ts), the final check and the
 * gates only the finished work can raise are `finishExecution` (execution-final.ts),
 * and what a run holds while it runs is `Execution` (execution.ts).
 */
export async function executePlan(plan: RunPlan, deps: ExecutorDeps): Promise<RunOutcome> {
  const run = new Execution(plan, deps)
  await runWaves(run)
  return finishExecution(run)
}
