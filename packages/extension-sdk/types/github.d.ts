/**
 * GitHub pull requests through the gh CLI, which the core runs (since 2.1.0).
 * `api.github` holds the pull request verbs the way `api.issues` holds the
 * tracker verbs; `api` reaches the rest of the REST and GraphQL API.
 */

/** Where a gh command runs and as whom. */
export interface GithubTarget {
  /** Where gh runs; a checkout there names the repository. `shell.exec`'s shell roots apply
   * (outside them: 'CwdOutOfScopeError', since 4.0.0). With `repository` set no checkout is
   * needed: pass `api.paths.globalStorage`, after creating it. */
  cwd: string
  /** `owner/name`, for a repository with no checkout (gh's `GH_REPO`). */
  repository?: string
  /** Tried first; on an authentication failure the call is retried with gh's own login. */
  token?: string
}

export interface GithubApiRequest {
  /** A REST path such as `repos/{owner}/{repo}/pulls/1/files`, or `graphql`. */
  path: string
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** String parameters (gh's `-f`); for `graphql`, `query` and the string variables. */
  fields?: Record<string, string>
  /** Typed parameters (gh's `-F`): numbers and booleans keep their type. */
  typedFields?: Record<string, number | boolean>
  /** Sent as the JSON request body instead of parameters. */
  body?: unknown
  /** Follows every page and concatenates them. */
  paginate?: boolean
  /** A jq filter applied to the response; the result is then whatever it prints. */
  jq?: string
  /** The media type asked for, e.g. `application/vnd.github.raw+json` for file content. */
  accept?: string
  /** Default 30 000. */
  timeoutMs?: number
  maxBuffer?: number
}

export interface GithubPullRequestQuery {
  state: 'open' | 'closed' | 'merged' | 'all'
  /** GitHub search syntax. */
  search?: string
  limit: number
  /** `gh pr list --json` fields. */
  fields: readonly string[]
}

export interface NewPullRequest {
  title: string
  body: string
  base: string
  head: string
  draft?: boolean
}

/** What every `github` call rejects with when gh fails. */
export interface GithubCommandError extends Error {
  /** gh writes GitHub's JSON error body here; `message` holds gh's own line. */
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  exceededMaxBuffer: boolean
  /** gh had no usable credential. */
  authenticationFailed: boolean
}

export interface GithubAPI {
  /** `gh api`. Resolves the response body exactly as gh prints it. */
  api(target: GithubTarget, request: GithubApiRequest): Promise<string>
  pullRequests: {
    /** `gh pr view --json`: a number, branch or URL. */
    view(
      target: GithubTarget,
      pullRequest: number | string,
      fields: readonly string[]
    ): Promise<Record<string, unknown>>
    list(target: GithubTarget, query: GithubPullRequestQuery): Promise<Record<string, unknown>[]>
    /** Opens a pull request from `head`, which must already be pushed. */
    create(target: GithubTarget, input: NewPullRequest): Promise<{ number: number; url: string }>
    markReady(target: GithubTarget, pullRequest: number): Promise<void>
    /** Merges the base branch into the pull request's branch. */
    updateBranch(target: GithubTarget, pullRequest: number): Promise<void>
  }
  repositories: {
    /** `gh repo view --json` for the target's repository. */
    view(target: GithubTarget, fields: readonly string[]): Promise<Record<string, unknown>>
    /** Clones `owner/name` into `directory`, relative to `target.cwd`. */
    clone(target: GithubTarget, repository: string, directory: string): Promise<void>
  }
}
