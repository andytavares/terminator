import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'
import type { Check } from './ci.js'

// The CI state of one order, on disk.
//
// Kept beside the order rather than inferred from the run graph, so a surface
// that only wants "where does CI stand" can read one small file instead of
// walking nodes and feedback to reconstruct it.

export interface CiState {
  readonly round: number
  readonly max: number
  readonly status: 'watching' | 'green' | 'red' | 'not_measured' | 'reworking'
  readonly pulls: readonly { url: string; checks: readonly Check[] }[]
  readonly reason: string
  readonly at: string
}

function ciStatePath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'ci.json')
}

export async function writeCiState(root: string, orderId: string, state: CiState): Promise<void> {
  await fs.promises.mkdir(orderDir(root, orderId), { recursive: true })
  await fs.promises.writeFile(
    ciStatePath(root, orderId),
    `${JSON.stringify(state, null, 2)}\n`,
    'utf8'
  )
}

/** A missing or unreadable file is no state, never a thrown surface. */
export async function readCiState(root: string, orderId: string): Promise<CiState | null> {
  try {
    const raw = await fs.promises.readFile(ciStatePath(root, orderId), 'utf8')
    return JSON.parse(raw) as CiState
  } catch {
    return null
  }
}

/** The words a surface shows for where CI stands. */
export function ciLabel(state: CiState): string {
  switch (state.status) {
    case 'watching':
      return state.round === 0
        ? `First run · up to ${state.max} ${state.max === 1 ? 'fix' : 'fixes'}`
        : `Fix ${state.round} of ${state.max}`
    case 'green':
      return 'Passed'
    case 'red':
      return `Failed after ${state.max} ${state.max === 1 ? 'fix' : 'fixes'}`
    case 'not_measured':
      return `Not measured: ${state.reason}`
    case 'reworking':
      return `Fixing: round ${state.round} of ${state.max}`
  }
}
