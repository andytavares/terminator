import * as path from 'node:path'

// Where a card's artifacts actually are.
//
// `defaultArtifactPaths` records them against the main checkout — an absolute
// `<repo>/specs/<slug>/spec.md`, except the constitution, which is
// repository-relative. Neither is where they get written: a phase runs in the
// card's worktree, and `git worktree add` checks out a branch, so the card
// directory the board created (uncommitted, in the main checkout) is not there.
// The agent creates it inside the worktree and writes everything there.
//
// So a path recorded at plan time and a path read at review time are two
// different checkouts, and every reader has to rebase before touching the disk.

export interface ArtifactLocation {
  /** The card, always in the main checkout: `<repo>/specs/<slug>`. */
  readonly featureDir: string
  /** Where the run is working, when it has one. */
  readonly worktreePath?: string | null
}

/** The repository a card belongs to, from `<repo>/specs/<slug>`. */
export function repoRootOf(featureDir: string): string {
  return path.dirname(path.dirname(featureDir))
}

/**
 * The artifact as it exists right now.
 *
 * Against the worktree while the card has one, and against the main checkout
 * otherwise — a card that was never dispatched, or whose worktree has been
 * reclaimed, still has artifacts if a previous run's branch was merged.
 *
 * A path outside the repository is returned untouched: rebasing it would invent
 * a location, and reading nothing is better than reading the wrong file.
 */
export function resolveArtifactPath(location: ArtifactLocation, artifactPath: string): string {
  const repoRoot = repoRootOf(location.featureDir)
  const base = location.worktreePath ?? repoRoot
  const relative = path.isAbsolute(artifactPath)
    ? path.relative(repoRoot, artifactPath)
    : artifactPath
  if (relative.startsWith('..') || path.isAbsolute(relative)) return artifactPath
  return path.join(base, relative)
}

export function resolveArtifactPaths(
  location: ArtifactLocation,
  artifactPaths: readonly string[]
): string[] {
  return artifactPaths.map((artifactPath) => resolveArtifactPath(location, artifactPath))
}

/** An artifact's stable name, and where to read it right now. */
export interface ArtifactEntry {
  /**
   * Repository-relative, so it is the same whichever checkout the file is read
   * from. What a hash is taken over: a card acquires a worktree the moment its
   * next phase starts, and an absolute name would make every approval taken
   * before that look modified afterwards.
   */
  readonly name: string
  readonly path: string
}

export function artifactEntries(
  location: ArtifactLocation,
  artifactPaths: readonly string[]
): ArtifactEntry[] {
  const repoRoot = repoRootOf(location.featureDir)
  return artifactPaths.map((artifactPath) => ({
    name: path.isAbsolute(artifactPath) ? path.relative(repoRoot, artifactPath) : artifactPath,
    path: resolveArtifactPath(location, artifactPath),
  }))
}
