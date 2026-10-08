import type { Branch } from '../../shared/types/index.js'

/**
 * Whether a branch name matches one of Settings → Git → Branch Exclude Patterns.
 *
 * `*` matches anything, slashes included: GitHub's merge queue names its
 * branches `gh-readonly-queue/<base>/pr-<n>-<sha>`, and a pattern that stopped
 * at the first slash would not hide the one example the setting gives.
 */
export function matchesBranchPattern(pattern: string, name: string): boolean {
  const trimmed = pattern.trim()
  if (trimmed === '') return false
  const source = trimmed
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`).test(name)
}

/** The branches a picker offers: every match removed, except the checked-out one. */
export function excludeBranches(branches: Branch[], patterns: readonly string[]): Branch[] {
  if (patterns.length === 0) return branches
  return branches.filter(
    (branch) => branch.isCurrent || !patterns.some((p) => matchesBranchPattern(p, branch.name))
  )
}
