import { ownedPaths } from '../../review/codeowners.js'
import type { GithubContext } from './context.js'

/** Where GitHub looks for CODEOWNERS, in the order it looks. */
const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']

/** A monorepo's CODEOWNERS runs past 1 MiB, the shell's default output cap. */
const CODEOWNERS_MAX_BUFFER = 16 * 1024 * 1024

interface OwnerLookup {
  repoRoot: string
  repoPath: string
  baseRefName: string
}

/** The base branch's CODEOWNERS, or '' when it has none; the base decides, as it does on GitHub. */
async function codeownersOf(ctx: GithubContext, at: OwnerLookup): Promise<string> {
  for (const location of CODEOWNERS_LOCATIONS) {
    try {
      return await ctx.api(at.repoRoot, {
        path: `${at.repoPath}/contents/${location}`,
        // gh sends a POST once it has fields, unless told to GET.
        method: 'GET',
        fields: { ref: at.baseRefName },
        maxBuffer: CODEOWNERS_MAX_BUFFER,
        accept: 'application/vnd.github.raw+json',
      })
    } catch {
      // Not at this location.
    }
  }
  return ''
}

/** The `org/slug` of each team the signed-in user is on; none when gh cannot list them. */
async function teamsOf(ctx: GithubContext, repoRoot: string): Promise<string[]> {
  try {
    const raw = await ctx.api(repoRoot, {
      path: 'user/teams',
      paginate: true,
      jq: '.[] | .organization.login + "/" + .slug',
    })
    return raw.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/** The changed files the viewer owns, directly or through a team. Best-effort: no CODEOWNERS, no
 *  login or an unreadable team list means fewer or no files, never a failed PR load. */
export async function ownedFilesOf(
  ctx: GithubContext,
  at: OwnerLookup & { paths: string[] }
): Promise<string[]> {
  try {
    const [codeowners, login, teams] = await Promise.all([
      codeownersOf(ctx, at),
      ctx.viewer(at.repoRoot),
      teamsOf(ctx, at.repoRoot),
    ])
    return ownedPaths(codeowners, at.paths, { login, teams })
  } catch {
    return []
  }
}
