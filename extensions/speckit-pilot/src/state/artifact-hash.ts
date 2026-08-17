import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { ArtifactEntry } from './artifact-paths.js'

// What a phase's artifacts were when you approved them.
//
// Approving a spec and then editing it by hand is not a hypothetical: it is how
// you fix a typo, and it is also how the plan downstream ends up built against
// something nobody approved. The hash is what lets the board tell those apart.

export async function computeHash(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath)
    const hash = createHash('sha256').update(content).digest('hex')
    return hash
  } catch {
    return null
  }
}

/**
 * One hash over every artifact a phase produced.
 *
 * Combined rather than one hash per file, because `PhaseState.approvedHash` is a
 * single field and a phase can produce more than one artifact — comparing every
 * file against one file's hash, which is what the unused version of this did,
 * reports a change on the second artifact of every multi-artifact phase.
 *
 * Each entry contributes its **name** and its content, where the name is
 * repository-relative. Renaming an artifact therefore counts as a change, while
 * reading the same artifact from a different checkout does not — and it is read
 * from a different checkout routinely: a card acquires a worktree the moment its
 * next phase starts. Sorted by name, so the order they were listed in does not
 * matter either.
 */
export async function hashArtifacts(entries: readonly ArtifactEntry[]): Promise<string | null> {
  if (entries.length === 0) return null

  const digest = createHash('sha256')
  for (const entry of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const hash = await computeHash(entry.path)
    // A missing artifact is a change, and a distinguishable one: it hashes
    // differently from any content, so an approval does not survive a delete.
    digest.update(`${entry.name}:${hash ?? 'missing'}\n`)
  }
  return digest.digest('hex')
}
