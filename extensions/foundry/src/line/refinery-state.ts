import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import type { Gate } from '../gates/rules.js'

// Whether an order's merge has already been acted on.
//
// The refinery's tick runs every 60 seconds against every order in flight, so
// "has this predecessor's merge already been restacked for" has to survive
// between ticks — otherwise the same merge restacks every overlapping order
// again on the very next pass.

export interface RefineryState {
  readonly mergedAt: string | null
  /** Merged order ids this order has already been restacked after. */
  readonly restackedFor: readonly string[]
  /**
   * The order whose merge this one is waiting for, when it is: the base branch
   * failed a check this order did not cause, and a separate order is fixing it.
   */
  readonly waitingOn: string | null
}

const DEFAULT_STATE: RefineryState = { mergedAt: null, restackedFor: [], waitingOn: null }

function statePath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'refinery.json')
}

/** Missing, unreadable, or malformed all read as the default: never merged. */
export async function readRefineryState(root: string, orderId: string): Promise<RefineryState> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(statePath(root, orderId), 'utf8'))
    if (typeof raw !== 'object' || raw === null) return DEFAULT_STATE
    const obj = raw as { mergedAt?: unknown; restackedFor?: unknown; waitingOn?: unknown }
    return {
      mergedAt: typeof obj.mergedAt === 'string' ? obj.mergedAt : null,
      restackedFor: Array.isArray(obj.restackedFor)
        ? obj.restackedFor.filter((id): id is string => typeof id === 'string')
        : [],
      waitingOn: typeof obj.waitingOn === 'string' && obj.waitingOn !== '' ? obj.waitingOn : null,
    }
  } catch {
    return DEFAULT_STATE
  }
}

export async function writeRefineryState(
  root: string,
  orderId: string,
  state: RefineryState
): Promise<void> {
  const file = statePath(root, orderId)
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  await fs.promises.writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

/**
 * How many times the finished change has already been sent back from its final
 * check, by the operator's own decision. The next feedback is the one after.
 */
export function finalCheckSendBacks(gates: readonly Gate[]): number {
  return gates.filter(
    (g) =>
      g.rule === 'verify.repeat-fail' && g.nodeId === null && g.decision?.option === 'send_back'
  ).length
}

/**
 * The order that fixes a check already failing on the base branch.
 *
 * The step, its command and the base log are read back from the gate that
 * raised the question, because that is the one place they were all written
 * down. The first sentence is the title — intake takes it from there.
 */
export function baseFixOrderText(
  gate: Gate,
  order: { readonly id: string; readonly title: string },
  baseBranch: string
): { readonly title: string; readonly step: string; readonly text: string } {
  const stdout = gate.evidence.filter((e) => e.kind === 'stdout')
  const onBase = stdout[stdout.length - 1]
  const step = onBase?.step ?? 'the final check'
  const command = onBase?.command ?? null
  const title = `Fix ${step} on ${baseBranch}`
  const lines = [
    `${title}.`,
    '',
    command === null
      ? `${step} fails on ${baseBranch}.`
      : `\`${command}\` (${step}) fails on ${baseBranch}.`,
    `It fails on ${baseBranch} without any order's change.`,
    '',
    `Found while verifying ${order.title} (${order.id}).`,
  ]
  if (onBase?.path !== undefined) lines.push('', `Log: ${onBase.path}`)
  if (onBase?.excerpt !== undefined && onBase.excerpt !== '')
    lines.push('', 'End of the log:', '', onBase.excerpt)
  return { title, step, text: lines.join('\n') }
}
