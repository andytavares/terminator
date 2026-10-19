import { z } from 'zod'
import { defineChannel, noPayload, type ChannelSpec } from '@terminator/extension-sdk'
import type {
  DashboardPR,
  DashboardSection,
  ReviewSession,
} from '../../schemas/pr-review.schema.js'
import {
  buildSectionQueries,
  dashboardBranches,
  parseDashboard,
  resolveBranchExclusions,
} from '../../github/dashboard-search.js'
import { mergedQuery, parseMerged } from '../../github/merged-search.js'
import { runGit } from '../../shell/run-git.js'
import { VALIDATION_ERROR } from '../register.js'
import { catchError, type AccessibleRepo, type GithubContext } from './context.js'
import { storedSessionsForRepo, storedSessions } from './sessions.js'

type SectionResults = Record<string, { issueCount?: number; nodes?: unknown[] }>

/** A repository as gh lists it. */
interface ListedRepo extends AccessibleRepo {
  archived: boolean
}

/** Every section's results merged by alias, what each section matched, and which failed. */
interface DashboardResults {
  merged: Record<string, { nodes: unknown[] }>
  matched: Map<DashboardSection, { issueCount: number; returned: number }>
  failed: Map<DashboardSection, string>
  firstFailure: unknown
}

const ACCESSIBLE_REPOS_JQ =
  '.[] | {fullName: .full_name, owner: .owner.login, private: .private, archived: .archived, pushedAt: .pushed_at}'

/** The fields the picker shows, without `archived`. */
function accessibleRepoFrom(repo: ListedRepo): AccessibleRepo {
  return {
    fullName: repo.fullName,
    owner: repo.owner,
    private: repo.private,
    pushedAt: repo.pushedAt,
  }
}

/** Unarchived repositories from gh's JSON lines, sorted by name ignoring case. */
function parseAccessibleRepos(jsonLines: string): AccessibleRepo[] {
  const listed = jsonLines
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as ListedRepo)
  const byFullName = (a: AccessibleRepo, b: AccessibleRepo) =>
    a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase())
  return listed
    .filter((repo) => !repo.archived)
    .map(accessibleRepoFrom)
    .sort(byFullName)
}

/** One `gh api --paginate` over every repository the viewer can reach, kept until a refresh. */
function loadAccessibleRepos(ctx: GithubContext, refresh: boolean): Promise<AccessibleRepo[]> {
  if (!refresh && ctx.accessibleRepos) return ctx.accessibleRepos
  const lookup = ctx
    .api(ctx.noCheckoutCwd, {
      path: 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100',
      paginate: true,
      jq: ACCESSIBLE_REPOS_JQ,
      timeoutMs: 60_000,
      maxBuffer: 50 * 1024 * 1024,
    })
    .then(parseAccessibleRepos)
  ctx.accessibleRepos = lookup
  lookup.catch(() => {
    if (ctx.accessibleRepos === lookup) ctx.accessibleRepos = undefined
  })
  return lookup
}

/** The last line of a gh failure, e.g. "gh: HTTP 502"; the first lines echo the whole command. */
function lastLine(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const lines = text.split('\n').filter((line) => line.trim())
  return (lines.at(-1) ?? text).trim()
}

// A remote URL is https (https://github.com/owner/name(.git)) or ssh (git@github.com:owner/name.git);
// both map to the "owner/name" key dashboard-search uses to find a PR's local checkout.
function parseGitRemoteUrl(url: string): { owner: string; name: string } | null {
  const trimmed = url.trim()
  const match =
    trimmed.match(/github\.com\/([^/]+)\/([^/]+?)(\.git)?\/?$/) ??
    trimmed.match(/github\.com:([^/]+)\/([^/]+?)(\.git)?\/?$/)
  if (!match) return null
  return { owner: match[1], name: match[2] }
}

/** owner/name -> project checkout, for each project whose origin is on GitHub. */
async function localRootsByRepo(listProjectRoots?: () => string[]): Promise<Map<string, string>> {
  const localRoots = new Map<string, string>()
  await Promise.all(
    (listProjectRoots?.() ?? []).map(async (root) => {
      try {
        const parsed = parseGitRemoteUrl(await runGit(root, ['remote', 'get-url', 'origin']))
        if (parsed) localRoots.set(`${parsed.owner}/${parsed.name}`, root)
      } catch {
        // no origin remote / not a git repo — skip
      }
    })
  )
  return localRoots
}

/** One alias's nodes, and how many GitHub matched; empty when the alias came back null. */
function aliasResult(result: SectionResults[string] | undefined) {
  const nodes = result?.nodes ?? []
  return { nodes, issueCount: result?.issueCount ?? 0 }
}

/** Adds one section's results; a section is capped when GitHub matched more than it returned. */
function addSection(results: DashboardResults, section: DashboardSection, value: SectionResults) {
  for (const [alias, result] of Object.entries(value)) {
    const { nodes, issueCount } = aliasResult(result)
    results.merged[alias] ??= { nodes: [] }
    results.merged[alias].nodes.push(...nodes)
    const prior = results.matched.get(section) ?? { issueCount: 0, returned: 0 }
    const matched = {
      issueCount: prior.issueCount + issueCount,
      returned: prior.returned + nodes.length,
    }
    results.matched.set(section, matched)
  }
}

/** Runs each section's query in parallel; a failed section is reported, not fatal. */
async function searchSections(
  ctx: GithubContext,
  requests: ReturnType<typeof buildSectionQueries>
) {
  const cwd = ctx.noCheckoutCwd
  const settled = await Promise.allSettled(
    requests.map(async ({ query }) => {
      const raw = await ctx.api(cwd, { path: 'graphql', fields: { query }, timeoutMs: 60_000 })
      return (JSON.parse(raw) as { data?: SectionResults }).data ?? {}
    })
  )
  const results: DashboardResults = {
    merged: {},
    matched: new Map(),
    failed: new Map(),
    firstFailure: undefined,
  }
  settled.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled')
      return addSection(results, requests[i].section, outcome.value)
    results.firstFailure ??= outcome.reason
    results.failed.set(requests[i].section, lastLine(outcome.reason))
  })
  return results
}

/** Each PR with the progress of its local review session, when there is one. */
function withSessionProgress(prs: DashboardPR[], stored: Record<string, unknown>): DashboardPR[] {
  const sessionsByRoot = new Map<string, Map<number, ReviewSession>>()
  const sessionsIn = (root: string) => {
    if (!sessionsByRoot.has(root)) {
      sessionsByRoot.set(
        root,
        new Map(storedSessionsForRepo(stored, root).map((s) => [s.prNumber, s]))
      )
    }
    return sessionsByRoot.get(root)!
  }
  return prs.map((pr) => {
    const session = pr.localRepoRoot ? sessionsIn(pr.localRepoRoot).get(pr.number) : undefined
    if (!session) return pr
    const sessionStatus = session.pausedAt ? ('paused' as const) : ('in-progress' as const)
    return { ...pr, sessionStatus, viewedFileCount: session.viewedFiles.length }
  })
}

export async function runDashboardSearch(ctx: GithubContext) {
  const login = await ctx.viewer(ctx.noCheckoutCwd)
  const repos = ctx.options.getReviewRepos?.() ?? []
  const requests = buildSectionQueries(login, repos)
  const results = await searchSections(ctx, requests)
  if (results.failed.size === new Set(requests.map((r) => r.section)).size) {
    return catchError(results.firstFailure)
  }
  const data = { data: results.merged }
  const localRoots = await localRootsByRepo(ctx.options.listProjectRoots)
  const isBranchExcluded = ctx.options.isBranchExcluded ?? (async () => false)
  const excluded = await resolveBranchExclusions(
    isBranchExcluded,
    dashboardBranches(data, localRoots)
  )
  const prs = parseDashboard(data, { login, localRoots }, excluded)
  const capped = [...results.matched]
    .filter(([, { issueCount, returned }]) => issueCount > returned)
    .map(([section]) => section)
  const answer = {
    prs: withSessionProgress(prs, await storedSessions()),
    capped,
    login,
    fetchedAt: new Date().toISOString(),
    failed: [...results.failed].map(([section, error]) => ({ section, error })),
    scopedTo: repos.length,
  }
  ctx.options.onDashboard?.(answer)
  return answer
}

/** Searches my pull requests merged lately and hands them to Home; apart from the dashboard search. */
export async function runMergedSearch(ctx: GithubContext) {
  const query = mergedQuery(Date.now())
  const raw = await ctx.api(ctx.noCheckoutCwd, {
    path: 'graphql',
    fields: { query },
    timeoutMs: 60_000,
  })
  const merged = parseMerged(JSON.parse(raw), await localRootsByRepo(ctx.options.listProjectRoots))
  ctx.options.onMerged?.(merged)
  return merged
}

export function dashboardChannels(ctx: GithubContext): ChannelSpec[] {
  return [
    defineChannel({
      channel: 'github:accessible-repos',
      schema: z.object({ refresh: z.boolean().optional() }).optional(),
      invalid: VALIDATION_ERROR,
      run: async (args) => ({ repos: await loadAccessibleRepos(ctx, !!args?.refresh) }),
      onError: catchError,
    }),
    defineChannel({
      channel: 'github:dashboard-search',
      schema: noPayload,
      invalid: VALIDATION_ERROR,
      run: () => runDashboardSearch(ctx),
      onError: catchError,
    }),
  ]
}
