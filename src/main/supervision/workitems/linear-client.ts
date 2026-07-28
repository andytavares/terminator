// Pulling your own issues out of Linear.
//
// Read-only and one-directional: the console never writes back. An issue
// becomes a queued intake stub and nothing else — no branch, no worktree, no
// agent. Auto-starting on intake is what produces the backlog nobody can
// review, and pulling twenty issues at once would produce it twenty times
// faster.

export interface LinearIssue {
  /** The human identifier, e.g. FLU-220 — what the operator calls it. */
  readonly identifier: string
  readonly title: string
  readonly url: string
  readonly createdAt: string
  readonly state: string
}

export type LinearResult = { ok: true; issues: LinearIssue[] } | { ok: false; reason: string }

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const ENDPOINT = 'https://api.linear.app/graphql'

/**
 * Issues assigned to whoever the key belongs to, newest first, excluding the
 * ones already finished — a done issue is not work to pick up.
 */
const QUERY = `
  query AssignedIssues($first: Int!) {
    viewer {
      assignedIssues(
        first: $first
        orderBy: updatedAt
        filter: { state: { type: { nin: ["completed", "canceled"] } } }
      ) {
        nodes {
          identifier
          title
          url
          createdAt
          state { name }
        }
      }
    }
  }
`

function parse(payload: unknown): LinearResult {
  if (typeof payload !== 'object' || payload === null) {
    return { ok: false, reason: 'Linear returned something that was not a response' }
  }
  const body = payload as Record<string, unknown>

  // GraphQL reports failure in the body with a 200, so the status alone never
  // tells you whether it worked.
  const errors = body.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as Record<string, unknown>
    const message = typeof first.message === 'string' ? first.message : 'unknown error'
    return { ok: false, reason: `Linear refused the query: ${message}` }
  }

  const nodes = (
    (body.data as Record<string, unknown> | undefined)?.viewer as
      | Record<string, unknown>
      | undefined
  )?.assignedIssues as Record<string, unknown> | undefined
  const list = nodes?.nodes

  if (!Array.isArray(list)) {
    return { ok: false, reason: 'Linear returned no issue list' }
  }

  const issues = list.flatMap((node): LinearIssue[] => {
    const issue = node as Record<string, unknown>
    const identifier = issue.identifier
    const title = issue.title
    if (typeof identifier !== 'string' || typeof title !== 'string') return []
    const state = issue.state as Record<string, unknown> | undefined
    return [
      {
        identifier,
        title,
        url: typeof issue.url === 'string' ? issue.url : '',
        createdAt: typeof issue.createdAt === 'string' ? issue.createdAt : '',
        state: typeof state?.name === 'string' ? state.name : 'unknown',
      },
    ]
  })

  return { ok: true, issues }
}

export async function fetchAssignedIssues(
  apiKey: string,
  fetchImpl: FetchLike,
  limit = 50
): Promise<LinearResult> {
  if (apiKey.trim() === '') {
    return { ok: false, reason: 'no Linear API key is configured' }
  }

  let response
  try {
    response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        // A personal API key is sent as the header value itself; only OAuth
        // tokens are bearer tokens.
        Authorization: apiKey.trim(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: QUERY, variables: { first: limit } }),
    })
  } catch (error) {
    // Offline, or a proxy in the way. Stated, because a silently empty list
    // reads as "you have no issues".
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason:
        response.status === 401 || response.status === 403
          ? 'Linear rejected the API key'
          : `Linear replied ${response.status}`,
    }
  }

  try {
    return parse(await response.json())
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}
