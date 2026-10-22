import * as fs from 'node:fs'
import * as path from 'node:path'
import { writeJsonAtomic } from '@terminator/extension-sdk/node'

import { safeFilename } from '../line/execution-parts.js'
import { indexFor } from '../state/live-index.js'
import { ProfileSchema, type Profile } from './schema.js'

// One profile per repository, at `<dataRoot>/profiles/<key>.json`. The key is
// the repository's real path with every character outside [A-Za-z0-9._-]
// replaced by `_`, so a symlinked checkout and its target share one profile.

export function profileKey(repoPath: string): string {
  try {
    return safeFilename(fs.realpathSync(repoPath))
  } catch {
    return safeFilename(path.resolve(repoPath))
  }
}

function profilePath(root: string, repoPath: string): string {
  return path.join(root, 'profiles', `${profileKey(repoPath)}.json`)
}

/** A missing or unreadable profile is none, never a thrown surface. */
export async function readProfile(root: string, repoPath: string): Promise<Profile | null> {
  try {
    const text = await fs.promises.readFile(profilePath(root, repoPath), 'utf8')
    const parsed = ProfileSchema.safeParse(JSON.parse(text))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Disk first, then the windows are told (the index holds no profile, so it only announces). */
export async function writeProfile(
  root: string,
  repoPath: string,
  profile: Profile
): Promise<void> {
  const target = profilePath(root, repoPath)
  await fs.promises.mkdir(path.dirname(target), { recursive: true })
  await writeJsonAtomic(target, ProfileSchema.parse(profile))
  indexFor(root).announce({ kind: 'profile', orderId: '' })
}
