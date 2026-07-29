import * as fs from 'node:fs'
import * as path from 'node:path'
import type { CardLanes, Lane } from './lane-coordination.js'

// The lanes a card declares, read from the file the plan phase writes.
//
// The contract between the pipeline and the console is a file, not an API:
// `/speckit-plan` writes `workitem.json` into the feature directory when a spec
// touches more than one repository, and the console watches for it. That keeps
// the pipeline usable in a bare terminal and means a card with no such file is
// a single-repository card rather than a broken one.
//
// Nothing here trusts the file: it is written by an agent, and a lane list that
// throws on read would take the card's whole drawer with it.

export const WORKITEM_FILE = 'workitem.json'

function laneFrom(raw: unknown): Lane | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  const ord = typeof value.ord === 'number' ? value.ord : null
  const repo = typeof value.repo === 'string' ? value.repo : null
  const branch = typeof value.branch === 'string' ? value.branch : null
  // Without all three the lane cannot be ordered, named or checked out, and a
  // half-lane in the strip reads as a repository you forgot to start.
  if (ord === null || repo === null || branch === null) return null

  const ords = (input: unknown): number[] =>
    Array.isArray(input) ? input.filter((n): n is number => typeof n === 'number') : []

  return {
    ord,
    repo,
    branch,
    role: value.role === 'producer' || value.role === 'consumer' ? value.role : undefined,
    // Normalised here so every rule downstream can read them without guarding:
    // an absent array and an empty one mean the same thing.
    blocks: ords(value.blocks),
    blocked_by: ords(value.blocked_by),
  }
}

/**
 * The card's lanes, or null when it does not declare any.
 *
 * Null rather than an empty item: "one repository" and "a work item with no
 * lanes" are different things, and only the second is worth showing.
 */
export function readCardLanes(featureDir: string): CardLanes | null {
  let raw: string
  try {
    raw = fs.readFileSync(path.join(featureDir, WORKITEM_FILE), 'utf8')
  } catch {
    return null
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const value = parsed as Record<string, unknown>
  const lanes = (Array.isArray(value.lanes) ? value.lanes : [])
    .map(laneFrom)
    .filter((lane): lane is Lane => lane !== null)
  if (lanes.length === 0) return null

  const contract = value.contract
  const sharedFiles =
    typeof contract === 'object' &&
    contract !== null &&
    Array.isArray((contract as never)['shared_files'])
      ? ((contract as { shared_files: unknown[] }).shared_files.filter(
          (file): file is string => typeof file === 'string'
        ) as string[])
      : []

  return {
    id: typeof value.id === 'string' ? value.id : path.basename(featureDir),
    lanes,
    contract: { shared_files: sharedFiles },
  }
}
