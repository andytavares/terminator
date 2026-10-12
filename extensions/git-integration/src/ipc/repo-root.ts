import { realpathSync } from 'fs'
import { isAbsolute, relative, resolve, sep } from 'path'
import { z } from 'zod'

// The directories a channel may run git or gh in: the workspace folders, the
// project roots and the review clone folder, bound once in activate().
let listWorkspaceRoots: () => string[] = () => []

export function bindWorkspaceRoots(list: () => string[]): void {
  listWorkspaceRoots = list
}

// A repoRoot of the form `gh:owner/name` means "no local checkout" — every PR
// action still goes through the gh CLI (via GH_REPO), it just never touches git.
export function parseRemoteRepo(root: string): { owner: string; name: string } | null {
  if (!root.startsWith('gh:')) return null
  const rest = root.slice('gh:'.length)
  const parts = rest.split('/')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { owner: parts[0], name: parts[1] }
}

/** The path with symlinks resolved, so a link inside a project cannot lead out of it. */
export function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (fromRoot.split(sep)[0] !== '..' && !isAbsolute(fromRoot))
}

/** True for a `gh:owner/name` root, or a directory that is or lies inside a workspace root. */
export function isWorkspaceRepoRoot(repoRoot: string): boolean {
  if (parseRemoteRepo(repoRoot)) return true
  const path = canonical(repoRoot)
  return listWorkspaceRoots()
    .filter((root) => root !== '')
    .some((root) => isInside(canonical(root), path))
}

/**
 * The checkout a channel works in. The remote browser chooses it, so it must
 * name a workspace root (or a directory inside one, such as a merge worktree).
 */
export const RepoRoot = z
  .string()
  .min(1)
  .refine(isWorkspaceRepoRoot, { message: 'repoRoot is outside the workspace' })
