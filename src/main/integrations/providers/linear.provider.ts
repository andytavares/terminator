import { LinearClient, PaginationOrderBy, type LinearDocument } from '@linear/sdk'
import type {
  Issue,
  IssueComment,
  IssueState,
  IssueStateType,
  IssueSummary,
  MineSelector,
  TrackerAccount,
  TrackerErrorKind,
} from '../../../shared/types/index.js'
import { TrackerError, toErrorMessage } from '../tracker-error.js'
import {
  MAX_MINE_ISSUES,
  type NewIssueInput,
  type StoredCredential,
  type TrackerProvider,
  type TrackerTeam,
  type TrackerStateOption,
  type TransitionIntent,
  type VerifiedAccount,
} from './provider.js'

// Linear, through the official SDK.
//
// The SDK hands back relations lazily — `issue.state` and `issue.assignee` are
// promises and `issue.labels()` is a request — so everything below awaits what
// it reads. Returning an unawaited relation is the failure mode that passes
// every flat test and renders "[object Promise]" in the drawer.

/** Comments beyond this are read in Linear; the drawer and the agent context both bound. */
const MAX_COMMENTS = 5

/** Excludes the `completed` and `canceled` state types from listMine: finished work is not "mine
 * to do". Every other type is open and stays, including `triage` and `backlog`. Search does not
 * use this, so closed issues are still found by name. */
const OPEN_STATES_FILTER: LinearDocument.IssueFilter = {
  state: { type: { nin: ['completed', 'canceled'] } },
}

/** Linear's connection page size ceiling is 250; 100 keeps each request light. */
const MAX_PAGE_SIZE = 100

/** The part of the SDK client the provider calls; specs pass a fake of it. */
type LinearLike = Pick<
  LinearClient,
  'viewer' | 'issues' | 'searchIssues' | 'issue' | 'createComment' | 'updateIssue' | 'createIssue'
>

export type LinearClientFactory = (apiKey: string) => LinearLike

const defaultFactory: LinearClientFactory = (apiKey) => new LinearClient({ apiKey })

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
// Matched in order, by the SDK's error type or, failing that, its message.
const ERROR_KINDS: ReadonlyArray<{ type: string; message: RegExp; kind: TrackerErrorKind }> = [
  {
    type: 'AuthenticationError',
    message: /authenticat|unauthor|invalid api key/i,
    kind: 'auth-failed',
  },
  { type: 'FeatureNotAccessible', message: /not found|entity not found/i, kind: 'not-found' },
  { type: 'NetworkError', message: /fetch failed|network/i, kind: 'unavailable' },
]

function asTrackerError(error: unknown): TrackerError {
  if (error instanceof TrackerError) return error
  const message = toErrorMessage(error)
  const type = (error as { type?: unknown } | null)?.type
  if (type === 'Ratelimited' || /rate.?limit/i.test(message)) {
    const retryAfter = (error as { retryAfter?: unknown } | null)?.retryAfter
    return new TrackerError('rate-limited', message, {
      retryAfterMs: typeof retryAfter === 'number' ? retryAfter * 1000 : undefined,
    })
  }
  const known = ERROR_KINDS.find((entry) => type === entry.type || entry.message.test(message))
  return known === undefined
    ? new TrackerError('failed', message, { cause: error })
    : new TrackerError(known.kind, message)
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    throw asTrackerError(error)
  }
}

interface RawState {
  id: string
  name: string
  type: string
  position: number
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
  team?: unknown
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

/**
 * Which intent each of a team's states satisfies.
 *
 * By `type`, never by name — that is Linear's own guidance and the reason it
 * matters is mundane: a team renames "In Progress" to "Building" and a
 * name-matching integration stops moving anything, silently.
 *
 * Linear has no review type, so `in_review` is the *later* of the started
 * states by position — Linear orders states within a type group by position,
 * so a second started state is a later stage of the same work. Where a team
 * has one started state there is no review position, and the intent resolves
 * to nothing rather than to something approximate. The operator can override
 * any of this; `transition` takes the option they chose.
 */
function withIntents(states: readonly RawState[]): TrackerStateOption[] {
  const ordered = [...states].sort((a, b) => a.position - b.position)
  const started = ordered.filter((state) => state.type === 'started')
  const startedId = started[0]?.id
  // Only when there is somewhere later to go; one started state is not a
  // review state wearing a different hat.
  const reviewId = started.length > 1 ? started[started.length - 1].id : undefined

  return ordered.map((state) => ({
    id: state.id,
    name: state.name,
    intent: intentFor(state, startedId, reviewId),
    // Linear accepts a move to any of a team's states from any other, so
    // there is no "not from here" to report.
    available: true,
  }))
}

function intentFor(
  state: RawState,
  startedId: string | undefined,
  reviewId: string | undefined
): TransitionIntent | null {
  if (state.id === reviewId) return 'in_review'
  if (state.id === startedId) return 'started'
  if (state.type === 'completed') return 'done'
  return null
}

function toRawStates(nodes: readonly unknown[]): RawState[] {
  return nodes.flatMap((node, index) => {
    const raw = node as { id?: unknown; name?: unknown; type?: unknown; position?: unknown }
    if (typeof raw.id !== 'string' || typeof raw.type !== 'string') return []
    return [
      {
        id: raw.id,
        name: typeof raw.name === 'string' ? raw.name : raw.id,
        type: raw.type,
        // Position is what orders the workflow; without it the fallback keeps
        // the tracker's own order rather than collapsing everything to zero.
        position: typeof raw.position === 'number' ? raw.position : index,
      },
    ]
  })
}

/** The issue behind `key`, or a not-found TrackerError. */
async function issueOrThrow(client: LinearLike, key: string): Promise<RawIssue> {
  const raw = (await client.issue(key)) as RawIssue | null
  if (raw === null || raw === undefined) {
    throw new TrackerError('not-found', `Issue ${key} not found`)
  }
  return raw
}

/** The workflow states of the issue's team, each with the intent it satisfies. */
async function stateOptionsOf(raw: RawIssue): Promise<TrackerStateOption[]> {
  const team = (await Promise.resolve(raw.team)) as { states?: () => unknown } | null
  if (team === null || team === undefined || typeof team.states !== 'function') return []
  const connection = (await team.states()) as { nodes?: unknown[] } | null
  return withIntents(toRawStates(connection?.nodes ?? []))
}

function verify(client: LinearLike): Promise<VerifiedAccount> {
  return run(async () => {
    const viewer = await client.viewer
    return { name: viewer.name, email: viewer.email }
  })
}

interface PageArgs {
  first: number
  after?: string
}

interface RawConnection {
  nodes?: RawIssue[]
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }
}

/** One page of the issues assigned to the configured email, or to the key's own viewer when
 * there is none. */
async function assignedPage(client: LinearLike, email: string | null, page: PageArgs) {
  if (email === null) {
    // No email configured: the key's own viewer is the answer, and it is one
    // fewer round trip than looking the user up first.
    const viewer = await client.viewer
    return viewer.assignedIssues?.({ filter: OPEN_STATES_FILTER, ...page }) ?? { nodes: [] }
  }
  return client.issues({
    filter: { ...OPEN_STATES_FILTER, assignee: { email: { eq: email } } },
    orderBy: PaginationOrderBy.UpdatedAt,
    ...page,
  })
}

/** Follows the connection's cursor until it ends or `limit` (never past the cap) is reached. */
async function allAssigned(client: LinearLike, email: string | null, limit: number) {
  const wanted = Math.min(limit, MAX_MINE_ISSUES)
  const nodes: RawIssue[] = []
  let after: string | undefined
  while (nodes.length < wanted) {
    const first = Math.min(wanted - nodes.length, MAX_PAGE_SIZE)
    const connection = (await assignedPage(
      client,
      email,
      after === undefined ? { first } : { first, after }
    )) as RawConnection | null
    nodes.push(...(connection?.nodes ?? []))
    const { hasNextPage, endCursor } = connection?.pageInfo ?? {}
    if (!hasNextPage || !endCursor) break
    after = endCursor
  }
  return nodes.slice(0, wanted)
}

function listMine(client: LinearLike, mine: MineSelector, limit: number): Promise<IssueSummary[]> {
  return run(async () => {
    const email = mine.kind === 'assignee' ? mine.email : null
    return Promise.all((await allAssigned(client, email, limit)).map(toSummary))
  })
}

function search(client: LinearLike, term: string, limit: number): Promise<IssueSummary[]> {
  return run(async () => {
    const connection = (await client.searchIssues(term, { first: limit })) as {
      nodes?: RawIssue[]
    } | null
    return Promise.all((connection?.nodes ?? []).map(toSummary))
  })
}

async function linearIssueByKey(client: LinearLike, key: string): Promise<Issue | null> {
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
}

function comment(client: LinearLike, key: string, body: string): Promise<void> {
  return run(async () => {
    // Linear issues are addressed by UUID, always — not by the human key, even where Linear would
    // accept one. One addressing mechanism means one thing to be right about, and the UUID is the
    // one Linear documents as working for every operation including this one.
    const raw = await issueOrThrow(client, key)
    const result = (await client.createComment({ issueId: raw.id, body })) as {
      success?: boolean
    } | null
    if (result?.success !== true) {
      throw new TrackerError('failed', `Linear refused the comment on ${key}`)
    }
  })
}

function states(client: LinearLike, key: string): Promise<TrackerStateOption[]> {
  return run(async () => stateOptionsOf(await issueOrThrow(client, key)))
}

interface MoveTarget {
  intent: TransitionIntent
  optionId?: string
}

/** The state a move goes to: the operator's own mapping wins over the type rule. An override
 * naming a state this workflow lacks is refused, not fallen back on: moving somewhere they did
 * not choose is worse than not moving. */
function chosenState(
  options: TrackerStateOption[],
  key: string,
  { intent, optionId }: MoveTarget
): TrackerStateOption {
  const chosen =
    optionId === undefined
      ? options.find((option) => option.intent === intent && option.available)
      : options.find((option) => option.id === optionId && option.available)
  if (chosen === undefined) {
    throw new TrackerError(
      'not-found',
      optionId === undefined
        ? `No available Linear state on ${key} satisfies "${intent}"`
        : `Linear state ${optionId} is not available on ${key}`
    )
  }
  return chosen
}

function transition(client: LinearLike, key: string, target: MoveTarget): Promise<void> {
  return run(async () => {
    const raw = await issueOrThrow(client, key)
    const chosen = chosenState(await stateOptionsOf(raw), key, target)
    const result = (await client.updateIssue(raw.id, { stateId: chosen.id })) as {
      success?: boolean
    } | null
    if (result?.success !== true) {
      throw new TrackerError('failed', `Linear refused the move of ${key} to ${chosen.name}`)
    }
  })
}

function toTeam(node: unknown): TrackerTeam[] {
  const raw = node as { id?: unknown; key?: unknown; name?: unknown }
  if (typeof raw.id !== 'string') return []
  return [
    {
      id: raw.id,
      key: typeof raw.key === 'string' ? raw.key : '',
      name: typeof raw.name === 'string' ? raw.name : raw.id,
    },
  ]
}

function teams(client: LinearLike): Promise<TrackerTeam[]> {
  return run(async () => {
    const viewer = await client.viewer
    const connection = (await viewer.teams?.()) as { nodes?: unknown[] } | null | undefined
    return (connection?.nodes ?? []).flatMap(toTeam)
  })
}

function create(client: LinearLike, input: NewIssueInput): Promise<Issue> {
  return run(async () => {
    const payload = (await client.createIssue({
      teamId: input.teamId,
      title: input.title,
      description: input.description,
    })) as { success?: boolean; issue?: unknown } | null
    if (payload?.success !== true) {
      throw new TrackerError('failed', `Linear refused to create "${input.title}"`)
    }
    const raw = (await Promise.resolve(payload.issue)) as RawIssue | null | undefined
    if (raw === null || raw === undefined) {
      throw new TrackerError('failed', `Linear created "${input.title}" but returned no issue`)
    }
    return toIssue(raw)
  })
}

export function createLinearProvider(
  makeClient: LinearClientFactory = defaultFactory
): TrackerProvider {
  function clientFor(cred: StoredCredential): LinearLike {
    assertLinear(cred)
    return makeClient(cred.apiKey)
  }

  // Async throughout, so a credential for another tracker rejects rather than throws.
  return {
    id: 'linear',
    verify: async (cred) => verify(clientFor(cred)),
    listMine: async (cred, mine, limit) => listMine(clientFor(cred), mine, limit),
    search: async (cred, term, limit) => search(clientFor(cred), term, limit),
    get: async (cred, key) => linearIssueByKey(clientFor(cred), key),
    comment: async (cred, key, body) => comment(clientFor(cred), key, body),
    states: async (cred, key) => states(clientFor(cred), key),
    // The provider interface's (intent, optionId) pair, carried as one target.
    transition: async (cred, key, ...[intent, optionId]) =>
      transition(clientFor(cred), key, { intent, optionId }),
    teams: async (cred) => teams(clientFor(cred)),
    create: async (cred, input) => create(clientFor(cred), input),
  }
}
