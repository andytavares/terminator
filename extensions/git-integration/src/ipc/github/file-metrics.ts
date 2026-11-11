import { runGit } from '../../shell/run-git.js'
import { parseRemoteRepo } from '../repo-root.js'

export interface FileMetrics {
  churn90d: number
}

const REMOTE_FILE_METRICS: FileMetrics = { churn90d: 0 }

const BATCH_MAX_BUFFER = 20 * 1024 * 1024

/** Commits in the last 90 days touching each wanted path, from one `git log`. */
async function churnFor(repoRoot: string, wanted: Set<string>): Promise<Map<string, number>> {
  const args = [
    '-c',
    'core.quotepath=false',
    'log',
    '--no-renames',
    '--name-only',
    '--format=%H',
    '--since=90 days ago',
  ]
  const raw = await runGit(repoRoot, args, { maxBuffer: BATCH_MAX_BUFFER })
  const churn = new Map<string, number>()
  for (const line of raw.split('\n')) {
    const file = line.trim()
    if (file && !/^[0-9a-f]{40}$/.test(file) && wanted.has(file)) {
      churn.set(file, (churn.get(file) ?? 0) + 1)
    }
  }
  return churn
}

/** Metrics for every path from one git process in total, not one per path. */
export async function measureFiles(
  repoRoot: string,
  paths: string[]
): Promise<Record<string, FileMetrics>> {
  if (parseRemoteRepo(repoRoot))
    return Object.fromEntries(paths.map((p) => [p, REMOTE_FILE_METRICS]))
  const churn = await churnFor(repoRoot, new Set(paths))
  return Object.fromEntries(paths.map((path) => [path, { churn90d: churn.get(path) ?? 0 }]))
}
