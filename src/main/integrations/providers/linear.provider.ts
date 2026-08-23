import { LinearClient } from '@linear/sdk'
import type {
  Issue,
  IssueComment,
  IssueState,
  IssueStateType,
  IssueSummary,
  MineSelector,
  TrackerAccount,
} from '../../../shared/types/index.js'
import { TrackerError, toErrorMessage } from '../tracker-error.js'
import type { StoredCredential, TrackerProvider, VerifiedAccount } from './provider.js'

// Linear, through the official SDK.
//
// The SDK hands back relations lazily — `issue.state` and `issue.assignee` are
// promises and `issue.labels()` is a request — so everything below awaits what
// it reads. Returning an unawaited relation is the failure mode that passes
// every flat test and renders "[object Promise]" in the drawer.

/** Comments beyond this are read in Linear; the drawer and the agent context both bound. */
const MAX_COMMENTS = 5

interface LinearLike {
  viewer: Promise<{ name: string; email: string; assignedIssues?: (vars?: unknown) => unknown }>
  issues(vars?: unknown): unknown
  searchIssues(vars?: unknown): unknown
  issue(id: string): unknown
  createComment(input: { issueId: string; body: string }): unknown
}

export type LinearClientFactory = (apiKey: string) => LinearLike

const defaultFactory: LinearClientFactory = (apiKey) =>
  new LinearClient({ apiKey }) as unknown as LinearLike

function assertLinear(
  cred: StoredCredential
): asserts cred is Extract<StoredCredential, { tracker: 'linear' }> {
  if (cred.tracker !== 'linear') {
    throw new TrackerError('failed', `Expected a Linear credential, got ${cred.tracker}`)
  }
}

// Linear's own state categories map one-to-one onto ours; anything it adds
// later reads as backlog rather than crashing the mapping.
const STATE_TYPES: ReadonlyMap<string, IssueStateType> = new Map([
  ['backlog', 'backlog'],
  ['unstarted', 'unstarted'],
  ['started', 'started'],
  ['completed', 'completed'],
  ['canceled', 'canceled'],
])

function toState(raw: { name?: unknown; type?: unknown } | null | undefined): IssueState {
  const name = typeof raw?.name === 'string' ? raw.name : 'Unknown'
  const type = typeof raw?.type === 'string' ? (STATE_TYPES.get(raw.type) ?? 'backlog') : 'backlog'
  return { name, type }
}

function toAccount(
  raw: { name?: unknown; email?: unknown } | null | undefined
): TrackerAccount | null {
  if (raw === null || raw === undefined) return null
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    email: typeof raw.email === 'string' ? raw.email : '',
  }
}

/**
 * Anything the SDK throws, in our taxonomy.
 *
 * The rate-limit case is the one that must survive: it carries the period
 * Linear itself asked for, and guessing instead is how an integration gets
 * itself blocked for longer.
 */
function asTrackerError(error: unknown): TrackerError {
  if (error instanceof TrackerError) return error
  const message = toErrorMessage(error)
  const type = (error as { type?: unknown } | null)?.type
  const retryAfter = (error as { retryAfter?: unknown } | null)?.retryAfter
  if (type === 'Ratelimited' || /rate.?limit/i.test(message)) {
    return new TrackerError('rate-limited', message, {
      retryAfterMs: typeof retryAfter === 'number' ? retryAfter * 1000 : undefined,
    })
  }
  if (type === 'AuthenticationError' || /authenticat|unauthor|invalid api key/i.test(message)) {
    return new TrackerError('auth-failed', message)
  }
  if (type === 'FeatureNotAccessible' || /not found|entity not found/i.test(message)) {
    return new TrackerError('not-found', message)
  }
  if (type === 'NetworkError' || /fetch failed|network/i.test(message)) {
    return new TrackerError('unavailable', message)
  }
  return new TrackerError('failed', message, { cause: error })
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw asTrackerError(error)
  }
}

interface RawIssue {
  id: string
  identifier: string
  title: string
  url: string
  description?: string | null
  branchName?: string | null
  updatedAt?: unknown
  state: unknown
  assignee: unknown
  labels?: () => unknown
  comments?: () => unknown
}

async function toSummary(raw: RawIssue): Promise<IssueSummary> {
  const [state, assignee] = await Promise.all([
    Promise.resolve(raw.state) as Promise<{ name?: unknown; type?: unknown } | null>,
    Promise.resolve(raw.assignee) as Promise<{ name?: unknown; email?: unknown } | null>,
  ])
  return {
    tracker: 'linear',
    id: raw.id,
    key: raw.identifier,
    title: raw.title,
    url: raw.url,
    state: toState(state),
    assignee: toAccount(assignee),
    branchName: typeof raw.branchName === 'string' ? raw.branchName : null,
  }
}

async function toComments(raw: RawIssue): Promise<IssueComment[]> {
  if (typeof raw.comments !== 'function') return []
  const connection = (await raw.comments()) as { nodes?: unknown[] } | null
  const nodes = Array.isArray(connection?.nodes) ? connection.nodes : []
  const resolved = await Promise.all(
    nodes.map(async (node) => {
      const comment = node as { body?: unknown; createdAt?: unknown; user?: unknown }
      const user = (await Promise.resolve(comment.user)) as { name?: unknown } | null
      return {
        author: typeof user?.name === 'string' ? user.name : 'Unknown',
        body: typeof comment.body === 'string' ? comment.body : '',
        createdAt: String(comment.createdAt ?? ''),
      }
    })
  )
  // Newest first, bounded — the whole thread is read in Linear.
  return resolved.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_COMMENTS)
}

async function toIssue(raw: RawIssue): Promise<Issue> {
  const summary = await toSummary(raw)
  const [labelsConnection, comments] = await Promise.all([
    typeof raw.labels === 'function'
      ? (raw.labels() as Promise<{ nodes?: { name?: unknown }[] } | null>)
      : Promise.resolve(null),
    toComments(raw),
  ])
  const labels = Array.isArray(labelsConnection?.nodes)
    ? labelsConnection.nodes
        .map((node) => node?.name)
        .filter((name): name is string => typeof name === 'string')
    : []
  return {
    ...summary,
    description: typeof raw.description === 'string' ? raw.description : '',
    labels,
    completed: summary.state.type === 'completed',
    updatedAt: String(raw.updatedAt ?? ''),
    comments,
  }
}

export function createLinearProvider(
  makeClient: LinearClientFactory = defaultFactory
): TrackerProvider {
  function clientFor(cred: StoredCredential): LinearLike {
    assertLinear(cred)
    return makeClient(cred.apiKey)
  }

  return {
    id: 'linear',

    async verify(cred): Promise<VerifiedAccount> {
      const client = clientFor(cred)
      return run(async () => {
        const viewer = await client.viewer
        return { name: viewer.name, email: viewer.email }
      })
    },

    async listMine(cred, mine: MineSelector, limit): Promise<IssueSummary[]> {
      const client = clientFor(cred)
      return run(async () => {
        const email = mine.kind === 'assignee' ? mine.email : null
        const connection = (await (email === null
          ? // No email configured: the key's own viewer is the answer, and it
            // is one fewer round trip than looking the user up first.
            ((await client.viewer).assignedIssues?.({ first: limit }) ?? { nodes: [] })
          : client.issues({
              filter: { assignee: { email: { eq: email } } },
              first: limit,
              orderBy: 'updatedAt',
            }))) as { nodes?: RawIssue[] } | null
        return Promise.all((connection?.nodes ?? []).map(toSummary))
      })
    },

    async search(cred, term, limit): Promise<IssueSummary[]> {
      const client = clientFor(cred)
      return run(async () => {
        const connection = (await client.searchIssues({ term, first: limit })) as {
          nodes?: RawIssue[]
        } | null
        return Promise.all((connection?.nodes ?? []).map(toSummary))
      })
    },

    async get(cred, key): Promise<Issue | null> {
      const client = clientFor(cred)
      try {
        const raw = (await client.issue(key)) as RawIssue | null
        if (raw === null || raw === undefined) return null
        return await toIssue(raw)
      } catch (error) {
        const tracked = asTrackerError(error)
        // "Gone" is an answer, not a failure — the badge renders unavailable
        // and the operator can unlink or relink.
        if (tracked.kind === 'not-found') return null
        throw tracked
      }
    },

    async comment(cred, key, body): Promise<void> {
      const client = clientFor(cred)
      return run(async () => {
        // Linear issues are addressed by UUID, always — not by the human key,
        // even where Linear would accept one. One addressing mechanism means
        // one thing to be right about, and the UUID is the one Linear
        // documents as working for every operation including this one.
        const raw = (await client.issue(key)) as RawIssue | null
        if (raw === null || raw === undefined) {
          throw new TrackerError('not-found', `Issue ${key} not found`)
        }
        const result = (await client.createComment({ issueId: raw.id, body })) as {
          success?: boolean
        } | null
        if (result?.success !== true) {
          throw new TrackerError('failed', `Linear refused the comment on ${key}`)
        }
      })
    },
  }
}
