import type { Project } from '../../shared/types/index'

// How a branch names itself in the sidebar. Pure, like the rest of this
// directory — no store, no clock, no I/O.

/**
 * A branch is named by its branch.
 *
 * The stored `name` is not a second identity to be shown beside it: a card
 * labelled `TAV-14 Make all text red` sitting on
 * `andrew/tav-14-make-text-red` gave the operator two names for one thing and
 * no way to tell which one the terminal in it was on. The branch is the thing
 * that is true — `useBranchSync` keeps it following the working tree — so the
 * branch is what the card says.
 *
 * `name` still answers for a branch that has none: a workspace whose folder is
 * not a git repository has projects with no branch at all, and there the
 * stored name is the only name there is.
 */
export function branchLabel(branch: Project): string {
  return branch.gitBranch ?? branch.name
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

/**
 * How a branch is named outside its own repo group — in the command palette, a
 * dialog, a registered command. Every repo's default branch is called `main`,
 * so a bare branch name identifies nothing on its own.
 */
export function qualifiedBranchLabel(branch: Project, repoName: string | undefined): string {
  const name = branchLabel(branch)
  return repoName ? `${repoName} · ${name}` : name
}
