import * as fs from 'node:fs'
import * as path from 'node:path'

// Where Foundry keeps its records.
//
// Resolved once, at activation, and handed to every writer as an absolute
// path. That is not tidiness: an order can span repositories, and once it does
// "the working directory" is ambiguous, so two writers resolving independently
// could disagree about where the record is. One resolution, one answer.
//
// Nothing here ever writes inside a target repository. That includes the
// operator's `.gitignore`: taking the default location leaves an untracked
// directory behind, and Foundry says so once rather than editing a file the
// order did not ask to change (FR-070).

export const DEFAULT_DIR_NAME = '.foundry'

export class RelativeDataDirError extends Error {
  readonly code = 'RELATIVE_DATA_DIR'
  constructor(value: string) {
    super(
      `Foundry's data directory must be an absolute path, because an order can span repositories and a relative path has nothing to be relative to. Got "${value}".`
    )
    this.name = 'RelativeDataDirError'
  }
}

export interface DataRootResolution {
  /** Absolute. Every writer takes this and never resolves again. */
  readonly root: string
  /** True when derived from the working directory rather than configured. */
  readonly usingDefault: boolean
}

/**
 * The records root for a working directory.
 *
 * Pure, so the two behaviours FR-074 asks for are one table rather than a
 * branch buried in a writer.
 */
export function resolveDataRoot(setting: string | undefined, workdir: string): DataRootResolution {
  const configured = (setting ?? '').trim()
  if (configured === '') {
    return { root: path.join(workdir, DEFAULT_DIR_NAME), usingDefault: true }
  }
  if (!path.isAbsolute(configured)) throw new RelativeDataDirError(configured)
  return { root: configured, usingDefault: false }
}

export function orderDir(root: string, orderId: string): string {
  return path.join(root, 'orders', orderId)
}

/**
 * Reserved by the data-root contract, and proved by `footprint.spec.ts` to sit
 * under the root like everything else. Nothing writes per-unit records yet;
 * when something does, this is where they go — and deleting it to satisfy a
 * reachability grep would remove the proof along with the path.
 */
export function unitDir(root: string, orderId: string, unitId: string): string {
  return path.join(orderDir(root, orderId), 'units', unitId)
}

/** Named by merge order first so a directory listing reads in merge order. */
export function laneDir(root: string, orderId: string, ord: number, repo: string): string {
  return path.join(orderDir(root, orderId), 'lanes', `${ord}-${repo}`)
}

export function ledgerPath(root: string, orderId: string): string {
  return path.join(orderDir(root, orderId), 'ledger.jsonl')
}

export type WritableResult = { ok: true } | { ok: false; reason: string }

/**
 * What to tell the operator, once, about the default location.
 *
 * Taking the default leaves an untracked directory in every repository an
 * order runs in, and Foundry will not tidy it away — adding an ignore entry
 * means editing a file the order did not ask to change. So it says so, and
 * says what avoids it, and then never mentions it again.
 */
export function untrackedNotice(resolution: DataRootResolution): string | null {
  if (!resolution.usingDefault) return null
  return (
    `Foundry is writing its records to ${resolution.root}, which is untracked and which ` +
    `Foundry will not add to your .gitignore — that would mean editing a file your order did ` +
    `not ask to change. Setting one folder in settings avoids it, and is the only workable ` +
    `answer once an order spans repositories.`
  )
}

/**
 * Checked when an order starts, not at first write (FR-075).
 *
 * An order that fails half way through because a directory could not be
 * created has already spent agent time, and the message would arrive attached
 * to the wrong thing.
 */
export async function ensureWritable(root: string): Promise<WritableResult> {
  try {
    const existing = await fs.promises.stat(root).catch(() => null)
    if (existing !== null && !existing.isDirectory()) {
      return { ok: false, reason: `${root} exists and is not a directory.` }
    }
    await fs.promises.mkdir(root, { recursive: true })
    await fs.promises.access(root, fs.constants.W_OK)
    return { ok: true }
  } catch (error) {
    return { ok: false, reason: `Cannot write to ${root}: ${(error as Error).message}` }
  }
}
