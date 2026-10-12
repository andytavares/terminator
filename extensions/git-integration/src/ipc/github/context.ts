import { z } from 'zod'
import type { GithubApiRequest, GithubAPI, GithubTarget } from '@terminator/extension-sdk'
import { type IssueLookup } from '../../github/pr-review-service.js'
import {
  resolveBranchExclusions,
  type BranchExclusionQuery,
} from '../../github/dashboard-search.js'
import { type GithubAccess, isAuthError, getRepoOwnerAndName } from '../../github/gh-cli.js'
import { exceededMaxBuffer } from '../../shell/run-git.js'
import { RepoRoot, parseRemoteRepo } from '../repo-root.js'

/** What the host offers the GitHub channels beyond gh itself; each part is optional. */
export interface GithubHandlerOptions {
  /** The application's tracker connection, when this build's host offers one. */
  issues?: IssueLookup
  /** Project checkouts, to find a dashboard PR's local repository. */
  listProjectRoots?: () => string[]
  /** The repositories the dashboard is scoped to. */
  getReviewRepos?: () => string[]
  /** Settings → Git → Branch Exclude Patterns, matched by the core. */
  isBranchExcluded?: BranchExclusionQuery
}

/** Everything the GitHub channels share for one registration, caches included. */
export interface GithubContext {
  github: GithubAPI
  noCheckoutCwd: string
  options: GithubHandlerOptions
  target(repoRoot: string): GithubTarget
  api(repoRoot: string, request: GithubApiRequest): Promise<string>
  ownerAndName(repoRoot: string): Promise<{ owner: string; repo: string }>
  /** The signed-in user's login, asked once. */
  viewer(cwd: string): Promise<string>
  excludedIn(
    prs: ReadonlyArray<{ headRefName: string }>,
    repoPath: string
  ): Promise<(branch: string, repoPath?: string) => boolean>
  /** Per pull request: the head commit its local pull ref was last fetched at, and its merge base. */
  prDiffBases: Map<string, { headSHA: string; mergeBase: string }>
  /** Every repository the viewer can reach, kept until a refresh. */
  accessibleRepos?: Promise<AccessibleRepo[]>
}

export interface AccessibleRepo {
  fullName: string
  owner: string
  private: boolean
  pushedAt: string
}

export const RepoRootPayload = z.object({ repoRoot: RepoRoot })

/** Payload of a channel that acts on one pull request of a checkout. */
export const PullRequestPayload = RepoRootPayload.extend({
  prNumber: z.number().int().positive(),
})

export const isOverflow = (e: unknown) =>
  exceededMaxBuffer(e) || (e as { exceededMaxBuffer?: boolean } | null)?.exceededMaxBuffer === true

/** Where gh runs for a repoRoot: the checkout, or the no-checkout directory and GH_REPO. */
export function githubTarget(repoRoot: string, access: GithubAccess): GithubTarget {
  const remote = parseRemoteRepo(repoRoot)
  const token = access.getToken()
  const as = token ? { token } : {}
  if (!remote) return { cwd: repoRoot, ...as }
  return { cwd: access.noCheckoutCwd, repository: `${remote.owner}/${remote.name}`, ...as }
}

/** The error a channel answers: not signed in, rate limited, or the error itself. */
export function catchError(e: unknown) {
  if (isAuthError(e)) return { error: 'NOT_AUTHENTICATED' as const }
  const msg = String(e)
  if (msg.includes('rate limit') || msg.includes('API rate limit')) {
    return { error: 'RATE_LIMITED' as const, resetAt: Date.now() + 60_000 }
  }
  return { error: msg }
}

/** Keeps a lookup's promise until it fails, so a failure is asked again next time. */
function cachedUntilFailure<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  lookup: () => Promise<T>
): Promise<T> {
  const cached = cache.get(key)
  if (cached) return cached
  const pending = lookup()
  cache.set(key, pending)
  pending.catch(() => cache.delete(key))
  return pending
}

/** A checkout's GitHub owner and name; `gh repo view` costs 0.4-0.7 s, so each is asked once. */
function ownerAndNameLookup(access: GithubAccess): GithubContext['ownerAndName'] {
  const owners = new Map<string, Promise<{ owner: string; repo: string }>>()
  return (repoRoot) => {
    const remote = parseRemoteRepo(repoRoot)
    if (remote) return Promise.resolve({ owner: remote.owner, repo: remote.name })
    const lookup = () => getRepoOwnerAndName(githubTarget(repoRoot, access), access.github)
    return cachedUntilFailure(owners, repoRoot, lookup)
  }
}

function viewerLookup(api: GithubContext['api']): GithubContext['viewer'] {
  const logins = new Map<string, Promise<string>>()
  const lookup = (cwd: string) => api(cwd, { path: 'user', jq: '.login' }).then((raw) => raw.trim())
  return (cwd) => cachedUntilFailure(logins, 'viewer', () => lookup(cwd))
}

/** Builds the helpers and caches one registration of the GitHub channels shares. */
export function githubContext(access: GithubAccess, options: GithubHandlerOptions): GithubContext {
  const target = (repoRoot: string) => githubTarget(repoRoot, access)
  const api = (repoRoot: string, request: GithubApiRequest) =>
    access.github.api(target(repoRoot), request)
  const isBranchExcluded = options.isBranchExcluded ?? (async () => false)
  return {
    github: access.github,
    noCheckoutCwd: access.noCheckoutCwd,
    options,
    target,
    api,
    ownerAndName: ownerAndNameLookup(access),
    viewer: viewerLookup(api),
    excludedIn: (prs, repoPath) =>
      resolveBranchExclusions(
        isBranchExcluded,
        prs.map((pr) => ({ branch: pr.headRefName, repoPath }))
      ),
    prDiffBases: new Map(),
  }
}
