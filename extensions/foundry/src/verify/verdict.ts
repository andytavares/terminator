// A verdict, and the one invariant the whole design leans on.
//
// Three values, not two. "Not measured" is a first-class result because a
// check that could not run here has to be sayable — coercing it to a boolean
// anywhere in this path turns "we did not check" into "it is fine", which is
// the failure mode that makes an unattended factory dangerous.
//
// And a verdict may not come from the session that produced the work. The
// builder's justification lives in that context window; a verdict derived from
// it is the builder marking its own homework with extra steps.

export type VerdictResult = 'pass' | 'fail' | 'not_measured'

export type EvidenceKind = 'exit_code' | 'stdout' | 'report_file' | 'screenshot' | 'diff'

export interface Evidence {
  readonly kind: EvidenceKind
  readonly path?: string
  readonly excerpt?: string
  readonly exitCode?: number
}

export interface Verdict {
  readonly nodeId: string
  readonly criterionId: string
  readonly result: VerdictResult
  /** Required for anything but a pass. A refusal with no reason is a shrug. */
  readonly reason: string
  readonly evidence: readonly Evidence[]
  readonly producedBy: { readonly role: string; readonly sessionId: string }
  readonly at: string
}

export class SelfVerificationError extends Error {
  readonly code = 'SELF_VERIFICATION'
  constructor(nodeId: string) {
    super(
      `A verdict for ${nodeId} was produced by the same session that did the work. Nothing may mark its own homework — the checking party gets the change and the criteria, and nothing else.`
    )
    this.name = 'SelfVerificationError'
  }
}

export class UnevidencedVerdictError extends Error {
  readonly code = 'UNEVIDENCED_VERDICT'
  constructor(nodeId: string, result: VerdictResult) {
    super(
      `A "${result}" verdict for ${nodeId} cites no evidence. A pass or a fail has to point at something: an exit status, a named test, a report, a picture.`
    )
    this.name = 'UnevidencedVerdictError'
  }
}

export interface VerdictInput extends Omit<Verdict, 'at'> {
  /** The session that produced the work being checked. */
  readonly nodeSessionId: string | null
  readonly at: string
}

/**
 * Build a verdict, or refuse to.
 *
 * Both refusals are structural rather than advisory. A rule that only lives in
 * a prompt is a rule the next model may reinterpret.
 */
export function makeVerdict(input: VerdictInput): Verdict {
  if (input.nodeSessionId !== null && input.producedBy.sessionId === input.nodeSessionId) {
    throw new SelfVerificationError(input.nodeId)
  }
  if (input.result !== 'not_measured' && input.evidence.length === 0) {
    throw new UnevidencedVerdictError(input.nodeId, input.result)
  }
  if (input.result !== 'pass' && input.reason.trim() === '') {
    throw new UnevidencedVerdictError(input.nodeId, input.result)
  }

  return {
    nodeId: input.nodeId,
    criterionId: input.criterionId,
    result: input.result,
    reason: input.reason,
    evidence: input.evidence,
    producedBy: input.producedBy,
    at: input.at,
  }
}

export interface VerdictSummary {
  readonly passed: number
  readonly failed: number
  readonly notMeasured: number
  /** Every criterion passed. An unmeasured one is not a pass. */
  readonly ok: boolean
  readonly unmeasuredCriteria: readonly string[]
}

export function summarise(verdicts: readonly Verdict[]): VerdictSummary {
  const passed = verdicts.filter((v) => v.result === 'pass').length
  const failed = verdicts.filter((v) => v.result === 'fail').length
  const unmeasured = verdicts.filter((v) => v.result === 'not_measured')
  return {
    passed,
    failed,
    notMeasured: unmeasured.length,
    ok: verdicts.length > 0 && failed === 0 && unmeasured.length === 0,
    unmeasuredCriteria: unmeasured.map((v) => v.criterionId),
  }
}

/**
 * A verdict derived from a command.
 *
 * From the exit status, never from what the command printed. A suite that
 * reports failures and exits zero, or prints passes and exits non-zero, is
 * exactly the case that makes reading the summary wrong.
 */
export function verdictFromExit(input: {
  nodeId: string
  criterionId: string
  command: string
  exitCode: number | null
  nodeSessionId: string | null
  producedBy: { role: string; sessionId: string }
  at: string
  stdoutExcerpt?: string
}): Verdict {
  // A command that never ran has no exit status, and that is "not measured" —
  // not a failure, and certainly not a pass.
  if (input.exitCode === null) {
    return makeVerdict({
      ...input,
      result: 'not_measured',
      reason: `\`${input.command}\` did not run here.`,
      evidence: [],
    })
  }

  return makeVerdict({
    ...input,
    result: input.exitCode === 0 ? 'pass' : 'fail',
    reason: input.exitCode === 0 ? '' : `\`${input.command}\` exited ${input.exitCode}.`,
    evidence: [
      { kind: 'exit_code', exitCode: input.exitCode },
      ...(input.stdoutExcerpt === undefined
        ? []
        : [{ kind: 'stdout' as const, excerpt: input.stdoutExcerpt }]),
    ],
  })
}
