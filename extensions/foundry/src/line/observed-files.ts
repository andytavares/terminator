import * as fs from 'node:fs'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'

// The files an order's checkouts changed as of the last settled step, recorded at
// that boundary so the refinery's queue, read constantly, never runs git per checkout.

function observedPath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'observed-files.json')
}

export async function writeObservedFiles(
  root: string,
  orderId: string,
  files: readonly string[]
): Promise<void> {
  await fs.promises.mkdir(orderDir(root, orderId), { recursive: true })
  await writeJsonAtomic(observedPath(root, orderId), [...new Set(files)])
}

/** Nothing recorded, or an unreadable record, is no files: the plan's own `touches` stand in. */
export async function readObservedFiles(root: string, orderId: string): Promise<string[]> {
  try {
    const raw: unknown = JSON.parse(await fs.promises.readFile(observedPath(root, orderId), 'utf8'))
    return Array.isArray(raw) ? raw.filter((file): file is string => typeof file === 'string') : []
  } catch {
    return []
  }
}
