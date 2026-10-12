import type { GithubAPI, GithubTarget } from '@terminator/extension-sdk'
import { runGit } from '../shell/run-git.js'

// The PR-review surface's gh knowledge (ADR-009): auth-error detection, the
// repository a checkout belongs to, and the git log co-change signal. The core
// runs gh itself, through api.github.

/** The core's GitHub verbs, and the token this extension's settings may hold. */
export interface GithubAccess {
  github: GithubAPI
  getToken: () => string
  /**
   * Where gh runs when it needs no checkout (`GH_REPO`, `gh api user`):
   * `api.paths.userData`, a directory the core lets gh run in (ADR 102).
   */
  noCheckoutCwd: string
}

export function isAuthError(e: unknown): boolean {
  const msg = String(e)
  return msg.includes('gh auth login') || msg.includes('GH_TOKEN') || msg.includes('401')
}

export async function getRepoOwnerAndName(
  target: GithubTarget,
  github: GithubAPI
): Promise<{ owner: string; repo: string }> {
  const data = (await github.repositories.view(target, ['owner', 'name'])) as {
    owner: { login: string }
    name: string
  }
  return { owner: data.owner.login, repo: data.name }
}

export const PR_JSON_FIELDS = [
  'number',
  'title',
  'state',
  'author',
  'createdAt',
  'headRefName',
  'baseRefName',
  'isDraft',
  'mergeStateStatus',
  'statusCheckRollup',
  'files',
  'additions',
  'deletions',
  'reviews',
  'assignees',
  'latestReviews',
]

export type SearchState = 'open' | 'closed' | 'merged' | 'all'

/** Reads an `is:merged|closed|all` qualifier out of a search box; without one only open PRs match. */
export function stateForSearch(query: string): { state: SearchState; text: string } {
  let state: SearchState = 'open'
  const text = query
    .replace(/(^|\s)is:(merged|closed|all)(?=\s|$)/gi, (_m, _lead, kind: string) => {
      state = kind.toLowerCase() as SearchState
      return ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
  return { state, text }
}

// ─── Co-change affinity (language-agnostic Signal 3) ─────────────────────────

/** The files each commit in `git log --name-only --format=%H` output touched. */
function filesPerCommit(log: string): string[][] {
  const commits: string[][] = [[]]
  for (const line of log.split('\n').map((l) => l.trim())) {
    if (/^[0-9a-f]{40}$/.test(line)) commits.push([])
    else if (line) commits[commits.length - 1].push(line)
  }
  return commits
}

/** Records that every pair of `files` changed together. */
function addPairs(affinity: Map<string, string[]>, files: string[]): void {
  if (files.length < 2) return
  for (const a of files) {
    for (const b of files) {
      if (a !== b) affinity.set(a, [...(affinity.get(a) ?? []), b])
    }
  }
}

export async function computeCoChangeAffinityFromGit(
  repoRoot: string,
  files: string[]
): Promise<Map<string, string[]>> {
  const affinity = new Map<string, string[]>()
  if (files.length < 2) return affinity
  try {
    const raw = await runGit(repoRoot, ['log', '--name-only', '--format=%H', '--since=90 days ago'])
    const fileSet = new Set(files)
    for (const commit of filesPerCommit(raw))
      addPairs(
        affinity,
        commit.filter((f) => fileSet.has(f))
      )
  } catch {
    // co-change is best-effort — failures degrade gracefully to Signal 1+2 only
  }
  return affinity
}
