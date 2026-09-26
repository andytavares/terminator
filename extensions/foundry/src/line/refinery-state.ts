import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'

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
