import type {
  Issue,
  IssueComment,
  IssueState,
  IssueStateType,
  IssueSummary,
  MineSelector,
  TrackerAccount,
} from '../../../shared/types/index.js'
import { adfToMarkdown } from '../adf-to-markdown.js'
import { TrackerError, fromHttpStatus, toErrorKind, toErrorMessage } from '../tracker-error.js'
import type { StoredCredential, TrackerProvider, VerifiedAccount } from './provider.js'

// Jira Cloud REST v3, over fetch. No client library: the four endpoints this
// needs are plain HTTP, and Atlassian's own SDK is an editor-scale dependency.
//
// Two facts shape this file:
//
//   - `GET /rest/api/3/search` is documented as being deprecated and removed.
//     Enhanced search — `/search/jql`, paged by `nextPageToken` — is the
//     replacement, and is what is used here. The extension this feature
//     replaces still calls the old one.
//   - v3 stores descriptions and comments as Atlassian Document Format, a JSON
//     document. Every one of them is converted to markdown before it leaves,
//     because there is exactly one renderer downstream.

const MAX_COMMENTS = 5
const MAX_PAGES = 10

function assertJira(
  cred: StoredCredential
): asserts cred is Extract<StoredCredential, { tracker: 'jira' }> {
  if (cred.tracker !== 'jira') {
    throw new TrackerError('failed', `Expected a Jira credential, got ${cred.tracker}`)
  }
}

function authHeader(email: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`
}

function baseUrl(site: string): string {
  return `https://${site}/rest/api/3`
}

interface JiraErrorBody {
  errorMessages?: unknown
  errors?: Record<string, unknown>
}

function messageFrom(body: unknown, fallback: string): string {
  const errors = (body as JiraErrorBody | null)?.errorMessages
  if (Array.isArray(errors) && errors.length > 0) return errors.map(String).join('; ')
  const fieldErrors = (body as JiraErrorBody | null)?.errors
  if (fieldErrors !== undefined && fieldErrors !== null) {
    const parts = Object.entries(fieldErrors).map(([k, v]) => `${k}: ${String(v)}`)
    if (parts.length > 0) return parts.join('; ')
  }
  return fallback
}

async function request(
  cred: Extract<StoredCredential, { tracker: 'jira' }>,
  path: string,
  init: RequestInit = {}
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${baseUrl(cred.site)}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader(cred.email, cred.apiToken),
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(init.headers as Record<string, string> | undefined),
      },
    })
  } catch (error) {
    // A dead network must not read as a bad credential.
    throw new TrackerError(toErrorKind(error), toErrorMessage(error), { cause: error })
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const retryAfter = response.headers.get('Retry-After')
    throw fromHttpStatus(response.status, messageFrom(body, `Jira request failed`), {
      retryAfterSeconds: retryAfter === null ? undefined : Number(retryAfter),
    })
  }
  return response.json().catch(() => null)
}

// Jira's status categories, which are stable, rather than status names, which
// every project renames.
const CATEGORY_TYPES: ReadonlyMap<string, IssueStateType> = new Map([
  ['new', 'unstarted'],
  ['undefined', 'backlog'],
  ['indeterminate', 'started'],
  ['done', 'completed'],
])

interface JiraIssue {
  id?: unknown
  key?: unknown
  fields?: {
    summary?: unknown
    description?: unknown
    status?: { name?: unknown; statusCategory?: { key?: unknown } }
    assignee?: { displayName?: unknown; emailAddress?: unknown } | null
    labels?: unknown
    updated?: unknown
    resolutiondate?: unknown
  }
}

function toState(raw: JiraIssue['fields']): IssueState {
  const name = typeof raw?.status?.name === 'string' ? raw.status.name : 'Unknown'
  const categoryKey = raw?.status?.statusCategory?.key
  const type =
    typeof categoryKey === 'string' ? (CATEGORY_TYPES.get(categoryKey) ?? 'backlog') : 'backlog'
  return { name, type }
}

function toAccount(raw: JiraIssue['fields']): TrackerAccount | null {
  const assignee = raw?.assignee
  if (assignee === null || assignee === undefined) return null
  return {
    name: typeof assignee.displayName === 'string' ? assignee.displayName : '',
    email: typeof assignee.emailAddress === 'string' ? assignee.emailAddress : '',
  }
}

function toSummary(site: string, raw: JiraIssue): IssueSummary {
  const key = String(raw.key ?? '')
  return {
    tracker: 'jira',
    id: String(raw.id ?? ''),
    key,
    title: typeof raw.fields?.summary === 'string' ? raw.fields.summary : '',
    url: `https://${site}/browse/${key}`,
    state: toState(raw.fields),
    assignee: toAccount(raw.fields),
    // Jira offers no suggested branch name. Never synthesised here — the
    // caller derives one from key and title instead.
    branchName: null,
  }
}

/** JQL string literals are double-quoted, so an embedded quote must escape. */
function quoteJql(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function adfParagraph(text: string): unknown {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

async function searchJql(
  cred: Extract<StoredCredential, { tracker: 'jira' }>,
  jql: string,
  limit: number
): Promise<IssueSummary[]> {
  const collected: IssueSummary[] = []
  let token: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      jql,
      maxResults: String(Math.min(limit - collected.length, 100)),
      fields: 'summary,status,assignee,labels,updated,resolutiondate',
    })
    if (token !== undefined) params.set('nextPageToken', token)

    const body = (await request(cred, `/search/jql?${params.toString()}`)) as {
      issues?: JiraIssue[]
      nextPageToken?: unknown
      isLast?: unknown
    } | null

    for (const raw of body?.issues ?? []) collected.push(toSummary(cred.site, raw))
    if (collected.length >= limit) return collected.slice(0, limit)

    const next = body?.nextPageToken
    if (body?.isLast === true || typeof next !== 'string' || next.length === 0) break
    token = next
  }
  return collected.slice(0, limit)
}

export function createJiraProvider(): TrackerProvider {
  return {
    id: 'jira',

    async verify(cred): Promise<VerifiedAccount> {
      assertJira(cred)
      const me = (await request(cred, '/myself')) as {
        displayName?: unknown
        emailAddress?: unknown
      } | null
      return {
        name: typeof me?.displayName === 'string' ? me.displayName : '',
        email: typeof me?.emailAddress === 'string' ? me.emailAddress : cred.email,
        site: cred.site,
      }
    },

    async listMine(cred, mine: MineSelector, limit): Promise<IssueSummary[]> {
      assertJira(cred)
      // Jira expresses "mine" as a saved query; there is no assignee field to
      // read it from, which is why MineSelector is tracker-shaped.
      const jql =
        mine.kind === 'query' ? mine.jql : 'assignee = currentUser() ORDER BY updated DESC'
      return searchJql(cred, jql, limit)
    },

    async search(cred, term, limit): Promise<IssueSummary[]> {
      assertJira(cred)
      return searchJql(cred, `text ~ "${quoteJql(term)}" ORDER BY updated DESC`, limit)
    },

    async get(cred, key): Promise<Issue | null> {
      assertJira(cred)
      try {
        const raw = (await request(
          cred,
          `/issue/${encodeURIComponent(key)}?fields=summary,description,status,assignee,labels,updated,resolutiondate`
        )) as JiraIssue | null
        if (raw === null) return null

        const commentBody = (await request(
          cred,
          `/issue/${encodeURIComponent(key)}/comment?maxResults=${MAX_COMMENTS}&orderBy=-created`
        ).catch(() => null)) as { comments?: unknown[] } | null

        const comments: IssueComment[] = (commentBody?.comments ?? [])
          .map((entry) => {
            const comment = entry as {
              author?: { displayName?: unknown }
              created?: unknown
              body?: unknown
            }
            return {
              author:
                typeof comment.author?.displayName === 'string'
                  ? comment.author.displayName
                  : 'Unknown',
              body: adfToMarkdown(comment.body),
              createdAt: String(comment.created ?? ''),
            }
          })
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, MAX_COMMENTS)

        const summary = toSummary(cred.site, raw)
        const labels = Array.isArray(raw.fields?.labels)
          ? raw.fields.labels.filter((l): l is string => typeof l === 'string')
          : []

        return {
          ...summary,
          description: adfToMarkdown(raw.fields?.description),
          labels,
          completed: summary.state.type === 'completed',
          updatedAt: String(raw.fields?.updated ?? ''),
          comments,
        }
      } catch (error) {
        if (error instanceof TrackerError && error.kind === 'not-found') return null
        throw error
      }
    },

    async comment(cred, key, body): Promise<void> {
      assertJira(cred)
      // The key is accepted in the path — unlike Linear, no id resolution.
      await request(cred, `/issue/${encodeURIComponent(key)}/comment`, {
        method: 'POST',
        body: JSON.stringify({ body: adfParagraph(body) }),
      })
    },
  }
}
