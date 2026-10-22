import { emptyProfile, type Profile } from './schema.js'
import { readProfile, writeProfile } from './store.js'

// What the base branch answered to a repository's commands, kept with the profile.

export interface ProofResult {
  readonly commit: string
  readonly at: string
  /** By command. */
  readonly exitCodes: Readonly<Record<string, number | null>>
}

/** Codes proved on the same commit join those already there; another commit starts afresh. */
export async function recordExitCodes(
  root: string,
  repoPath: string,
  result: ProofResult
): Promise<Profile> {
  const stored = (await readProfile(root, repoPath)) ?? emptyProfile(repoPath)
  const kept = stored.proof?.commit === result.commit ? stored.proof.exitCodes : {}
  const profile = {
    ...stored,
    proof: { commit: result.commit, at: result.at, exitCodes: { ...kept, ...result.exitCodes } },
  }
  await writeProfile(root, repoPath, profile)
  return profile
}
