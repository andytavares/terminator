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
}

const DEFAULT_STATE: RefineryState = { mergedAt: null, restackedFor: [] }

function statePath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'refinery.json')
}

/** Missing, unreadable, or malformed all read as the default: never merged. */
export async function readRefineryState(root: string, orderId: string): Promise<RefineryState> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(statePath(root, orderId), 'utf8'))
    if (typeof raw !== 'object' || raw === null) return DEFAULT_STATE
    const obj = raw as { mergedAt?: unknown; restackedFor?: unknown }
    return {
      mergedAt: typeof obj.mergedAt === 'string' ? obj.mergedAt : null,
      restackedFor: Array.isArray(obj.restackedFor)
        ? obj.restackedFor.filter((id): id is string => typeof id === 'string')
        : [],
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
  return gates.filter((g) => sendsBackFinalCheck(g, g.decision?.option)).length
}

/**
 * Whether a decision gives the final check's failure back to the nodes that
 * wrote the work. A failure already on the base branch is fixed the same way,
 * in this order, rather than in another one.
 */
export function sendsBackFinalCheck(gate: Gate, option: string | undefined): boolean {
  return (
    option === 'send_back' &&
    gate.nodeId === null &&
    (gate.rule === 'verify.repeat-fail' || gate.rule === 'verify.base-fail')
  )
}
