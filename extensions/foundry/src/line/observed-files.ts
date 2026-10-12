import * as fs from 'node:fs'
import * as path from 'node:path'
import { orderDir } from '../data-root.js'

// The files an order's checkouts have changed, as of the last step that
// settled.
//
// Recorded when the work moves, because the refinery's queue asks for them on
// every read and reading them means running git in each checkout. A record
// written at the step boundary is the same answer to the question the queue
// asks — which in-flight orders touch the same files — without a process.

function observedPath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'observed-files.json')
}

export async function writeObservedFiles(
  root: string,
  orderId: string,
  files: readonly string[]
): Promise<void> {
  await fs.promises.mkdir(orderDir(root, orderId), { recursive: true })
  await fs.promises.writeFile(observedPath(root, orderId), JSON.stringify([...new Set(files)]))
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
