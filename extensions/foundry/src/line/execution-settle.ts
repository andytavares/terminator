import * as fs from 'node:fs'
import { markPassed, markFailed, rework } from './scheduler.js'
import { withNode, stepFor, unitsOf } from './run-graph.js'
import type { Feedback } from './run-graph.js'
import { checkExpect } from '../recipe/step-kinds.js'
import type { CommitOutcome } from './commit.js'
import { describeDocument } from './document-outcome.js'
import { collectableWrites } from './rung-output.js'
import type { DocumentHandBack } from '../order/schema.js'
import { verdictFromExit } from '../verify/verdict.js'
import { commitMessage, lastLines, refusedReason } from './execution-parts.js'
import type { Execution } from './execution.js'
import type { Launched, Ran } from './execution-launch.js'
import type { RungCollection } from './executor.js'

// What a node's turn came to: what it handed back, the verdicts a checking
// party gives, whether it kept what it promised and committed its work, and
// then passed, sent back or failed.

type Refusal = Extract<CommitOutcome, { kind: 'refused' }>

/** Why a node that did not pass did not, beyond its exit status. */
interface Shortfall {
  readonly unmet: readonly string[]
  readonly madeNoChange: boolean
  readonly refusal: Refusal | null
}

export async function settle(run: Execution, launched: Launched): Promise<void> {
  // A command this repository's toolchain could not resolve. It never ran —
  // not a pass, and not a failure, which is why it does not go through the
  // pass/fail machinery below.
  if ('skipped' in launched) {
    const { node, skipReason } = launched
    const at = run.deps.now()
    await run.advance(withNode(run.current, node.id, { state: 'skipped', endedAt: at, skipReason }))
    return
  }
  const ran = launched
  // A no-op when the run already reported its session. Kept for the caller
  // that reports none — every ladder rung, and every test stub.
  await run.noteStarted(ran.node.id, ran.result.sessionId)
  const handedBack = await collectRung(run, ran)
  // Who produced the work on this unit, so the party checking it can be held
  // against them rather than against itself.
  if (!ran.readOnly) {
    for (const unitId of ran.node.unitIds) run.producedUnit.set(unitId, ran.result.sessionId)
  }
  judgeUnits(run, ran)
  const judged = await judgeExpectations(run, ran)
  const committed = judged.passed ? await commitWork(run, ran, handedBack) : NOTHING_SHORT
  if (judged.passed && committed === NOTHING_SHORT) {
    await run.advance(markPassed(run.current, ran.node.id, run.deps.now()))
    run.deps.onEvent({ type: 'passed', nodeId: ran.node.id })
    return
  }
  await notPassed(run, ran, { ...committed, unmet: judged.unmet })
}

const NOTHING_SHORT: Shortfall = { unmet: [], madeNoChange: false, refusal: null }

/**
 * What the rung actually produced, which for a read-only role is the whole of
 * its work. Before this the brief named no destination and nothing read a
 * result past its exit status, so a scout's report, an architect's plan and a
 * red team's attack all ended in a terminal nobody read and the node passed
 * regardless.
 */
async function collectRung(run: Execution, ran: Ran): Promise<DocumentHandBack | null> {
  const { node, roleId, outputPath } = ran
  if (outputPath === null || roleId === null) return null
  const collected = await run.deps
    .collect({ nodeId: node.id, role: roleId, outputPath })
    // Never fatal, for the reason `persist` is not: a run that cannot file
    // what a rung wrote is still a run.
    .catch(() => null)
  if (collected === null) {
    await run.deps.record(
      'rung.wrote_nothing',
      node.id,
      `The ${roleId} left nothing at ${outputPath}. Its turn ended, so whatever it worked out is only in its terminal.`
    )
    return null
  }
  return filed(run, { node, roleId }, collected)
}

/** What a rung filed, put on the brief and the record, and raised when it disputes the order. */
async function filed(
  run: Execution,
  { node, roleId }: { node: Ran['node']; roleId: string },
  collected: RungCollection
): Promise<DocumentHandBack | null> {
  // What the next rung is told. The agreement it is judged against is
  // deliberately not this.
  run.briefed = collected.order
  const handedBack = collected.document ?? null
  if (handedBack !== null) {
    await run.deps.record('document.handed_back', node.id, describeDocument(handedBack))
  }
  const note = collected.note === '' ? `the ${roleId} filed its result` : collected.note
  await run.deps.record('rung.collected', node.id, note)
  if (collected.defect !== null) {
    const summary = `${run.order.title} is contradicted by its own ${roleId}`
    const stops = await run.raise('forge-defect', {
      summary,
      why: collected.defect,
      nodeId: node.id,
    })
    run.halted = stops || run.halted
  }
  return handedBack
}

/**
 * The verdict comes from the exit status. Whatever the run printed is
 * evidence, never the decision.
 *
 * **Only from a checking party.** A role that may write is the one that did
 * the work, and its turn ending says nothing whatever about whether the
 * criteria its unit claims are met — that claim is precisely what
 * verification exists to test. This used to run for every node with a unit,
 * so a builder finishing stamped `pass` on every criterion the unit
 * `satisfies`, off its own exit code, labelled `verifier`.
 *
 * `makeVerdict` has a structural guard against exactly that, and this caller
 * walked around it: passing `${sessionId}-verify` as the checking session is a
 * string that differs from the working one by a suffix, so the guard sees two
 * sessions where there is one. The independence is real now — the checker's
 * own session, held against the builder's.
 *
 * Found by a live run: a verifier read the file, saw the change had never been
 * made, and then found a `pass` already in the ledger for the criterion it was
 * there to judge, stamped at the millisecond the builder's turn ended.
 */
function judgeUnits(run: Execution, { node, result, roleId, readOnly }: Ran): void {
  if (node.unitIds.length === 0 || !readOnly) return
  for (const unit of unitsOf(run.order, node)) {
    for (const criterionId of unit.satisfies) {
      const verdict = verdictFromExit({
        nodeId: node.id,
        criterionId,
        command: `${node.role ?? node.stepId} on ${unit.id}`,
        exitCode: result.exitCode,
        // The session that produced the work being checked — not this one.
        // Where the two are the same session, `makeVerdict` refuses.
        nodeSessionId: run.producedUnit.get(unit.id) ?? null,
        producedBy: { role: roleId ?? node.stepId, sessionId: result.sessionId },
        at: run.deps.now(),
      })
      run.verdicts.push(verdict)
      run.deps.onEvent({ type: 'verdict', verdict })
    }
  }
}

/**
 * A judge declares what it expects; checking it is what makes it a judge
 * rather than another agent. What a step's own result actually offers:
 * `suite_exit_code` is an alias — for a `run` step the suite *is* the step,
 * and the bugfix shape names it that way to say which exit status it means.
 *
 * A key nothing can supply is *not measured* — never a silent pass and never a
 * silent failure. `tests_added` needs diff metrics this path does not gather,
 * so an expectation naming it is recorded and the step falls back to its exit
 * status, rather than becoming a shape that can never pass.
 *
 * A measurable expectation *replaces* the exit-status judgement rather than
 * adding to it. That is what lets the bugfix shape say a reproduction must
 * fail before the fix exists — the one place a passing command is the wrong
 * answer, and where reading exit 0 as success would pass a reproduction that
 * reproduces nothing.
 */
async function judgeExpectations(
  run: Execution,
  { node, result }: Ran
): Promise<{ passed: boolean; unmet: string[] }> {
  const expect = stepFor(run.recipe, node)?.expect ?? {}
  const observed: Record<string, unknown> = {
    exit_code: result.exitCode,
    exitCode: result.exitCode,
    suite_exit_code: result.exitCode,
  }
  const named = Object.keys(expect)
  const unmeasurable = named.filter((key) => !(key in observed))
  const measurable = Object.fromEntries(Object.entries(expect).filter(([key]) => key in observed))
  const unmet = checkExpect(measurable, observed).map(
    (failure) => `${failure.key} expected ${failure.expected}, got ${String(failure.actual)}`
  )
  if (unmeasurable.length > 0) {
    await run.deps.record(
      'step.expectation_not_measured',
      node.id,
      `${node.stepId} promised ${unmeasurable.join(', ')}, which nothing here measures. Judged on its exit status instead.`
    )
  }
  const promised = named.length > unmeasurable.length
  return { passed: promised ? unmet.length === 0 : result.exitCode === 0, unmet }
}

/**
 * An agent that may write has to have written something: committed by the
 * agent itself, or committed here, since a branch the agent only edited has
 * nothing to push. A role that only ever documents may have nothing to
 * document, and an author whose document is outside the checkout changes
 * nothing in it. NOTHING_SHORT when the work stands.
 */
async function commitWork(
  run: Execution,
  { node, roleId }: Ran,
  handedBack: DocumentHandBack | null
): Promise<Shortfall> {
  const { roles } = run
  if (roleId === null || !roles.mayWrite(roleId)) return NOTHING_SHORT
  const commit = await run.deps.commitNode({ node, message: commitMessage(node, run.order) })
  const mayChangeNothing =
    (handedBack !== null && handedBack.location !== 'checkout') ||
    (roles.writesOnlyDocs(roleId) && !collectableWrites(roles.get(roleId)).includes('document'))
  if (commit.kind === 'committed' || mayChangeNothing) return NOTHING_SHORT
  if (commit.kind === 'refused') {
    await run.deps.record('step.commit_refused', node.id, refusedReason(commit))
    // The builder's next attempt is told what refused its work.
    const feedback: Feedback = {
      from: node.id,
      attempt: node.attempts,
      source: 'check',
      command: commit.command,
      exitCode: commit.exitCode,
      excerpt: lastLines(commit.output, 120),
      logPath: null,
    }
    await run.advance(withNode(run.current, node.id, { feedback: [...node.feedback, feedback] }))
    return { unmet: [], madeNoChange: false, refusal: commit }
  }
  await run.deps.record('step.no_change', node.id, 'made no change to the checkout')
  return { unmet: [], madeNoChange: true, refusal: null }
}

async function notPassed(run: Execution, ran: Ran, short: Shortfall): Promise<void> {
  const { node } = ran
  if (short.unmet.length > 0) {
    await run.deps.record(
      'step.expectation_unmet',
      node.id,
      `${node.stepId} did not meet what it promised: ${short.unmet.join('; ')}`
    )
  }
  const sendTo = reworkTarget(run, ran)
  if (sendTo === null) await failNode(run, ran, short)
  else await sendBack(run, ran, sendTo)
}

/**
 * A check that names a place to send its failure back to, rather than
 * stopping the line over it. The role it sends work back to has to be one
 * that may actually write, or "rework" is a decision nobody scoped it to make.
 */
function reworkTarget(run: Execution, { node }: Ran): { to: string; max: number } | null {
  const onFail = stepFor(run.recipe, node)?.onFail
  if (onFail === undefined || node.reworks >= onFail.max) return null
  const target = run.recipe.steps.find((s) => s.id === onFail.rework)
  if (target === undefined) return null
  const targetRole =
    target.kind === 'fanout' ? ((target.step ?? {}) as { role?: string }).role : target.role
  if (targetRole === undefined || !run.roles.mayWrite(targetRole)) return null
  return { to: onFail.rework, max: onFail.max }
}

async function sendBack(run: Execution, ran: Ran, sendTo: { to: string; max: number }) {
  const { node, result, command, logPath } = ran
  const excerpt =
    logPath !== null && fs.existsSync(logPath)
      ? lastLines(fs.readFileSync(logPath, 'utf8'), 120)
      : ''
  const feedback: Feedback = {
    from: node.id,
    attempt: node.attempts,
    source: 'check',
    command,
    exitCode: result.exitCode,
    excerpt,
    logPath,
  }
  await run.advance(rework(run.current, node.id, { to: sendTo.to, feedback }))
  await run.deps.record(
    'rework.started',
    node.id,
    `${node.stepId} exited ${result.exitCode ?? 'without a status'}; sending ${sendTo.to} back (round ${node.reworks + 1} of ${sendTo.max})`
  )
}

async function failNode(run: Execution, ran: Ran, short: Shortfall): Promise<void> {
  const { node } = ran
  const failure = markFailed(run.current, node.id, {
    at: run.deps.now(),
    reason: failReason(ran, short),
  })
  await run.advance(failure.graph)
  run.deps.onEvent({ type: 'failed', nodeId: node.id, needsDecision: failure.needsDecision })
  if (!failure.needsDecision) return
  run.awaitingDecision.push(node.id)
  // Two failures is a pattern, not bad luck. The third attempt is a decision
  // rather than a retry, and this is where it is asked for.
  const stops = await run.raise('verify.repeat-fail', repeatFailAsk(ran, short))
  run.halted = stops || run.halted
}

function failReason({ result, command, logPath }: Ran, short: Shortfall): string {
  if (short.refusal) return refusedReason(short.refusal)
  if (short.madeNoChange) return 'made no change to the checkout'
  if (short.unmet.length > 0) return `did not meet what it promised: ${short.unmet.join('; ')}`
  return `exited ${result.exitCode ?? 'without a status'}${
    command ? ` running \`${command}\`` : ''
  }${logPath ? `. The output is in \`${logPath}\`` : ''}`
}

function repeatFailAsk({ node, result }: Ran, { refusal, madeNoChange }: Shortfall) {
  const outcome = refusal
    ? refusedReason(refusal)
    : madeNoChange
      ? 'made no change to the checkout'
      : `exited ${result.exitCode ?? 'without a status'}`
  return {
    summary: `${node.unitIds.join(', ') || node.id} failed twice`,
    why: `Attempt ${node.attempts + 1} of ${node.id} ${outcome}. A third try is a decision, not a retry.`,
    nodeId: node.id,
    evidence: refusal
      ? [
          {
            kind: 'stdout' as const,
            step: node.id,
            command: refusal.command,
            exitCode: refusal.exitCode ?? undefined,
            excerpt: lastLines(refusal.output, 40),
          },
        ]
      : undefined,
  }
}
