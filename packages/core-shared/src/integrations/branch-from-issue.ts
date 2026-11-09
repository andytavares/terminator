import type { IssueSummary } from '../types/index.js'

// Turning an issue into a branch name.
//
// Pure, and deliberately conservative: whatever comes out of here is going to
// be handed to git, and a ref git refuses fails at worktree creation, which is
// several steps after the operator chose the issue and stopped watching. It is
// also what the card will be called, because a branch is named by its branch
// (ADR-034).
//
// In `shared/` rather than `main/` because the renderer is what needs it — the
// new-project dialog prefills from it — and a pure string function does not
// warrant an IPC round trip to reach the process that has no use for it.

/** Long enough to be recognisable, short enough not to wrap a terminal. */
const MAX_BRANCH_LENGTH = 60
/** What an issue carries, plus the branch name only some trackers suggest. */
type IssueLike = IssueSummary & { branchName?: string | null }

/**
 * Strip a title down to something git will accept in a ref.
 *
 * git's rules (`git check-ref-format`) forbid a good deal more than most
 * people expect: spaces, `~^:?*[`, backslashes, a leading or trailing dot or
 * slash, consecutive dots, and a `.lock` suffix. Accents are folded rather
 * than dropped so "Café" stays readable as "cafe".
 */
function slugify(value: string): string {
  return (
    value
      .normalize('NFD')
      // Combining marks, left behind by NFD. Removing them is what turns é into e.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  )
}

/**
 * The branch a project for this issue should sit on.
 *
 * A tracker that suggests one wins outright — Linear's is what its own UI, its
 * git integration and its automations all expect, and second-guessing it would
 * put the operator on a branch Linear does not recognise as belonging to the
 * issue.
 */
export function branchFromIssue(issue: IssueLike): string {
  const suggested = issue.branchName
  if (typeof suggested === 'string' && suggested.trim().length > 0) return suggested.trim()

  const key = slugify(issue.key)
  const title = slugify(issue.title)
  if (title.length === 0) return key

  const combined = `${key}-${title}`
  if (combined.length <= MAX_BRANCH_LENGTH) return stripLock(combined)
  // Cut at a separator so the branch ends on a whole word.
  const cut = combined.slice(0, MAX_BRANCH_LENGTH)
  const lastSeparator = cut.lastIndexOf('-')
  return stripLock(
    (lastSeparator > key.length ? cut.slice(0, lastSeparator) : cut).replace(/-$/, '')
  )
}

/** git refuses a ref ending in `.lock`, and the slug can produce one. */
function stripLock(value: string): string {
  return value.replace(/\.lock$/, '-lock')
}
