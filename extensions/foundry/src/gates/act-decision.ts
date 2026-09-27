/**
 * What "Answer" on a `forge-defect` gate does.
 *
 * The finding that raises this gate has already sent the order back to
 * `draft` (`amendOrder`), and `runs.resume` refuses anything that is not
 * `running` — so answering used to call it anyway and do nothing. This reads
 * the order first: a drafted order gets an architect turn carrying every
 * open blocking finding, in the review loop's own words; a still-running
 * order (nothing sent it back) resumes as it always did.
 */
export type GateActAction =
  | { readonly kind: 'converge'; readonly message: string }
  | {
      readonly kind: 'resume'
    }

export function forgeDefectAnswer(input: {
  readonly order: { readonly status: string } | null
  readonly fixMessage: string | null
  readonly gateRule: string
}): GateActAction {
  const { order, fixMessage, gateRule } = input
  if (order !== null && order.status !== 'running') {
    return {
      kind: 'converge',
      message: fixMessage ?? `The order was sent back to draft at the ${gateRule} gate.`,
    }
  }
  return { kind: 'resume' }
}
