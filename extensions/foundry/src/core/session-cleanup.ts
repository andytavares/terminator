import * as fs from 'node:fs/promises'
import * as path from 'node:path'

interface LegacySessionRun {
  featureBranch?: string
  worktreePath?: string
}

interface LegacySession {
  run?: LegacySessionRun
}

/**
 * On extension load: detect old-format session.json (missing featureBranch),
 * wipe the session file, and remove the referenced worktree directory.
 * New-format sessions (with featureBranch) are left untouched.
 */
export async function cleanupLegacySessions(workspaceRoot: string): Promise<void> {
  const sessionPath = path.join(workspaceRoot, '.foundry', 'session.json')
  let raw: string
  try {
    raw = await fs.readFile(sessionPath, 'utf-8')
  } catch {
    return
  }

  let session: LegacySession
  try {
    session = JSON.parse(raw) as LegacySession
  } catch {
    // Malformed session — remove it
    await fs.unlink(sessionPath).catch(() => undefined)
    return
  }

  // If run has featureBranch it is the new format — leave it alone
  if (session.run?.featureBranch) return

  // Legacy format — clean up worktree directory and session file
  const worktreePath = session.run?.worktreePath
  if (worktreePath) {
    await fs.rm(worktreePath, { recursive: true, force: true }).catch(() => undefined)
  }

  await fs.unlink(sessionPath).catch(() => undefined)
}
