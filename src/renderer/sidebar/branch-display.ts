import type { Project } from '../../shared/types/index'

// How a branch names itself in the sidebar. Pure, like the rest of this
// directory — no store, no clock, no I/O.

export interface BranchName {
  /** What the row leads with. */
  primary: string
  /** The branch, shown only when the label is not already the branch name. */
  secondary?: string
}

/**
 * The branch is the identity; a stored name is a label on top of it.
 *
 * Most branches created by the app are named after their branch, so they render
 * as just the branch and nothing changes for them. A branch created from a
 * ticket carries a human label — "TAV-14 Make all text red" — and gains its
 * branch name as secondary information rather than losing it.
 */
export function displayName(branch: Project): BranchName {
  const { name, gitBranch } = branch
  if (!gitBranch) return { primary: name, secondary: undefined }
  if (name === gitBranch) return { primary: gitBranch, secondary: undefined }
  return { primary: name, secondary: gitBranch }
}

/**
 * A repo path as a human reads it: home-relative, so `/Users/you/repos/app`
 * reads as `~/repos/app`. Anything outside home is left alone — an absolute
 * path is the honest answer there.
 */
export function abbreviatePath(path: string, home: string | undefined): string {
  if (!home || !path.startsWith(home)) return path
  const rest = path.slice(home.length)
  if (rest !== '' && !rest.startsWith('/')) return path
  return `~${rest}`
}
