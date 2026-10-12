import type { GithubAPI, GithubTarget } from '@terminator/extension-sdk'
import { runGit } from '../shell/run-git.js'

// The PR-review surface's gh knowledge (ADR-009): auth-error detection, the
// repository a checkout belongs to, and the git log co-change signal. The core
// runs gh itself, through api.github.

/** The core's GitHub verbs, and the token this extension's settings may hold. */
export interface GithubAccess {
  github: GithubAPI
  getToken: () => string
}

export function isAuthError(e: unknown): boolean {
  const msg = String(e)
  return msg.includes('gh auth login') || msg.includes('GH_TOKEN') || msg.includes('401')
}

export type RegisterFn = (
  channel: string,
  handler: (payload: unknown) => Promise<unknown> | unknown
) => void

/** Wraps a handler registrar so each call logs its channel and duration. */
export function withTiming(register: RegisterFn): RegisterFn {
  return (channel, handler) =>
    register(channel, (payload) => {
      const start = performance.now()
      const done = () =>
        console.debug(`[git-integration] ${channel} ${Math.round(performance.now() - start)}ms`)
      const result = handler(payload)
      if (result instanceof Promise) return result.finally(done)
      done()
      return result
    })
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
