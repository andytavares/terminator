import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'

const execFileAsync = promisify(execFile)

// All gh-CLI knowledge for the PR-review surface lives here (ADR-009): binary
// resolution for packaged apps, GH_TOKEN handling with expired-token retry,
// auth-error detection, and the git log co-change signal. GhService
// (gh-service.ts) is the separate, sandboxed api.shell.exec transport used by
// the PR-create flow — it cannot set env or custom binary paths, which this
// module needs.

export interface GhOptions {
  getGhPath: () => string
  getToken: () => string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Packaged Electron apps don't inherit the shell PATH, so we probe common
// locations where `gh` is installed on macOS before falling back to the name.
const GH_CANDIDATE_PATHS = [
  '/opt/homebrew/bin/gh', // Apple Silicon Homebrew
  '/usr/local/bin/gh', // Intel Homebrew
  '/usr/bin/gh',
]

let autoResolvedGhPath: string | null = null

async function resolveGh(configuredPath: string): Promise<string> {
  if (configuredPath) return configuredPath
  if (autoResolvedGhPath) return autoResolvedGhPath
  for (const p of GH_CANDIDATE_PATHS) {
    if (existsSync(p)) {
      autoResolvedGhPath = p
      return p
    }
  }
  autoResolvedGhPath = 'gh'
  return autoResolvedGhPath
}

export function isAuthError(e: unknown): boolean {
  const msg = String(e)
  return msg.includes('gh auth login') || msg.includes('GH_TOKEN') || msg.includes('401')
}

export async function runGh(
  cwd: string,
  args: string[],
  opts: GhOptions,
  timeoutMs = 30_000
): Promise<string> {
  const gh = await resolveGh(opts.getGhPath())
  const token = opts.getToken()
  const env = token ? { ...process.env, GH_TOKEN: token } : undefined
  try {
    const { stdout, stderr } = await execFileAsync(gh, args, { cwd, timeout: timeoutMs, env })
    if (stderr && !stdout) throw new Error(stderr)
    return stdout.trim()
  } catch (e) {
    // If an explicit token was set but auth failed, retry without it so the
    // system gh auth / GH_TOKEN env var gets a chance (token may be expired).
    if (token && isAuthError(e)) {
      const { stdout, stderr } = await execFileAsync(gh, args, {
        cwd,
        timeout: timeoutMs,
        env: undefined,
      })
      if (stderr && !stdout) throw new Error(stderr)
      return stdout.trim()
    }
    throw e
  }
}

export async function getRepoOwnerAndName(
  repoRoot: string,
  opts: GhOptions
): Promise<{ owner: string; repo: string }> {
  const raw = await runGh(repoRoot, ['repo', 'view', '--json', 'owner,name'], opts)
  const data = JSON.parse(raw) as { owner: { login: string }; name: string }
  return { owner: data.owner.login, repo: data.name }
}

export async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 30_000 })
  return stdout.trim()
}

export const PR_JSON_FIELDS =
  'number,title,author,createdAt,headRefName,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,files,additions,deletions,reviews,assignees,latestReviews'

// ─── Co-change affinity (language-agnostic Signal 3) ─────────────────────────

export async function computeCoChangeAffinityFromGit(
  repoRoot: string,
  files: string[]
): Promise<Map<string, string[]>> {
  const affinity = new Map<string, string[]>()
  if (files.length < 2) return affinity
  try {
    const raw = await runGit(repoRoot, ['log', '--name-only', '--format=%H', '--since=90 days ago'])
    const fileSet = new Set(files)
    const lines = raw.split('\n')
    let currentFiles: string[] = []

    const flushCommit = () => {
      const prFilesInCommit = currentFiles.filter((f) => fileSet.has(f))
      if (prFilesInCommit.length >= 2) {
        for (const a of prFilesInCommit) {
          for (const b of prFilesInCommit) {
            if (a === b) continue
            const existing = affinity.get(a) ?? []
            existing.push(b)
            affinity.set(a, existing)
          }
        }
      }
      currentFiles = []
    }

    for (const line of lines) {
      if (/^[0-9a-f]{40}$/.test(line.trim())) {
        flushCommit()
      } else if (line.trim()) {
        currentFiles.push(line.trim())
      }
    }
    flushCommit()
  } catch {
    // co-change is best-effort — failures degrade gracefully to Signal 1+2 only
  }
  return affinity
}
