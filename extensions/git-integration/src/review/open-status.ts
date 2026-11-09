/** Where opening a pull request stands: loading its detail, or failed with a message for people. */
export type OpenStatus =
  | { prNumber: number; state: 'opening' }
  | { prNumber: number; state: 'failed'; message: string }
  | null

export const NO_REPOSITORY = 'No repository given'

/** The pull request's page on GitHub. Only a `gh:owner/name` root names its repository. */
export function pullRequestUrl(repoRoot: string | null, prNumber: number): string | null {
  const match = /^gh:([^/]+)\/([^/]+)$/.exec(repoRoot ?? '')
  if (!match) return null
  return `https://github.com/${match[1]}/${match[2]}/pull/${prNumber}`
}
