import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

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
 * The path goes into the digest with the content, so renaming an artifact counts
 * as a change. Sorted, so the order the paths happen to be listed in does not.
 */
export async function hashArtifacts(paths: readonly string[]): Promise<string | null> {
  if (paths.length === 0) return null

  const digest = createHash('sha256')
  for (const path of [...paths].sort()) {
    const hash = await computeHash(path)
    // A missing artifact is a change, and a distinguishable one: it hashes
    // differently from any content, so an approval does not survive a delete.
    digest.update(`${path}:${hash ?? 'missing'}\n`)
  }
  return digest.digest('hex')
}
