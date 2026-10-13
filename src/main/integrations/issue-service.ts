import type {
  Issue,
  IssueListResult,
  IssueSummary,
  MineSelector,
  TrackerFailure,
  TrackerId,
} from '../../shared/types/index.js'
import type { ExtensionAPI } from '@terminator/extension-sdk'
import { TrackerError, toErrorKind, toErrorMessage } from './tracker-error.js'
import type {
  StoredCredential,
  TrackerProvider,
  TrackerStateOption,
  TrackerTeam,
} from './providers/provider.js'

// The one place that decides how fresh is fresh enough, how many requests one
// question costs, and what happens when a tracker says no.
//
// Providers are stateless functions over a credential; everything with memory
// or a policy lives here, so both trackers get the same answer and a third
// would too.

const DEFAULT_TTL_MS = 5 * 60 * 1000
const DEFAULT_LIMIT = 50
/** One retry. A tracker refusing twice is a tracker with a problem, not a queue. */
const MAX_RATE_LIMIT_RETRIES = 1
const DEFAULT_RATE_LIMIT_WAIT_MS = 5000

const TRACKERS: readonly TrackerId[] = ['linear', 'jira']

/** `TAV-42`, `ENG-7` — a term shaped like a key is almost always meant as one. */
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/

export interface IssueServiceDeps {
  providers: Record<TrackerId, TrackerProvider>
  getCredential(tracker: TrackerId): Promise<StoredCredential | null>
  getMine(tracker: TrackerId): Promise<MineSelector>
  /** Injected so a test can move time without waiting for it. */
  now?: () => number
  ttlMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Called when a tracker's credential starts or stops failing. */
  onTrackerError: (
    tracker: TrackerId,
    kind: ReturnType<typeof toErrorKind> | null
  ) => Promise<void> | void
}

/**
 * The SDK's `api.issues` (its declaration is the documentation), less
 * `connections`, which the integrations store answers.
 */
export interface IssueService extends Omit<ExtensionAPI['issues'], 'connections'> {
  /** Drops every cached copy. Used when a credential changes underneath us. */
  invalidate(tracker?: TrackerId): void
}

interface CacheEntry {
  issue: Issue | null
  at: number
}

function cacheKey(tracker: TrackerId, key: string): string {
  // (tracker, key) is the identity — two trackers may share a key.
  return `${tracker}:${key}`
}

type TransitionTarget =
  Parameters<IssueService['transition']> extends [TrackerId, string, ...infer Target]
    ? Target
    : never

/** What every method shares: the deps, the clock, the cache and one way to ask a tracker. */
interface ServiceContext {
  deps: IssueServiceDeps
  now: () => number
  ttlMs: number
  cache: Map<string, CacheEntry>
  /** Runs `work` with the tracker's credential, retrying a rate limit once. */
  call<T>(tracker: TrackerId, work: (cred: StoredCredential) => Promise<T>): Promise<T>
  get: IssueService['get']
}

async function credentialFor(
  deps: IssueServiceDeps,
  tracker: TrackerId
): Promise<StoredCredential> {
  const cred = await deps.getCredential(tracker)
  if (cred === null) {
    throw new TrackerError('not-connected', `${tracker} is not connected`)
  }
  return cred
}

interface RetryPolicy {
  onTrackerError: IssueServiceDeps['onTrackerError']
  sleep: (ms: number) => Promise<void>
}

function retryWaitMs(error: unknown): number {
  return error instanceof TrackerError && error.retryAfterMs !== undefined
    ? error.retryAfterMs
    : DEFAULT_RATE_LIMIT_WAIT_MS
}

/**
 * Run a provider call, honouring a rate-limit refusal by waiting exactly as
 * long as the tracker asked and trying once more.
 *
 * Only rate limits are retried: an auth failure will not fix itself, and
 * retrying it just spends the operator's remaining budget.
 */
async function withRetry<T>(
  policy: RetryPolicy,
  tracker: TrackerId,
  work: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await work()
      await policy.onTrackerError(tracker, null)
      return result
    } catch (error) {
      const kind = toErrorKind(error)
      if (kind === 'rate-limited' && attempt < MAX_RATE_LIMIT_RETRIES) {
        await policy.sleep(retryWaitMs(error))
        continue
      }
      if (kind === 'auth-failed') await policy.onTrackerError(tracker, kind)
      throw error instanceof TrackerError
        ? error
        : new TrackerError(kind, toErrorMessage(error), { cause: error })
    }
  }
}

/**
 * A capability this tracker does not have, said in a way a caller can act
 * on. Its own kind rather than 'failed', because the two are handled
 * differently: a failure is retried, an unsupported capability is recorded
 * once and never asked about again.
 */
function unsupported(tracker: TrackerId, what = 'move an issue'): TrackerError {
  return new TrackerError('unsupported', `${tracker} cannot be asked to ${what}`)
}

/** `get` through the cache, with concurrent asks for one issue sharing one request. */
function cachedGet(context: Omit<ServiceContext, 'get'>): IssueService['get'] {
  // Without single flight, opening a project with a badge, a drawer and a
  // board row costs three requests.
  const inFlight = new Map<string, Promise<Issue | null>>()
  const { cache, now, deps } = context
  return async (tracker, key, opts = {}) => {
    const id = cacheKey(tracker, key)
    if (opts.refresh !== true) {
      const hit = cache.get(id)
      if (hit !== undefined && now() - hit.at < context.ttlMs) return hit.issue
      const pending = inFlight.get(id)
      if (pending !== undefined) return pending
    }
    const request = context
      .call(tracker, (cred) => deps.providers[tracker].get(cred, key))
      .then((issue) => {
        cache.set(id, { issue, at: now() })
        return issue
      })
      // Cleared on failure too, or one dropped connection would poison this
      // key for the life of the process.
      .finally(() => inFlight.delete(id))
    inFlight.set(id, request)
    return request
  }
}

/**
 * Ask every connected tracker and keep what comes back.
 *
 * A tracker that fails does not fail the call — the operator sees the issues
 * that arrived and is told which tracker is missing and why. A partial list
 * presented as complete is the failure this shape exists to prevent.
 */
async function gather(
  context: ServiceContext,
  trackers: readonly TrackerId[],
  work: (tracker: TrackerId, cred: StoredCredential) => Promise<IssueSummary[]>
): Promise<IssueListResult> {
  const settled = await Promise.all(
    trackers.map(async (tracker): Promise<TrackerFailure | IssueSummary[]> => {
      try {
        return await context.call(tracker, (cred) => work(tracker, cred))
      } catch (error) {
        return { tracker, error: toErrorKind(error) }
      }
    })
  )
  const issues: IssueSummary[] = []
  const failures: TrackerFailure[] = []
  for (const result of settled) {
    if (Array.isArray(result)) issues.push(...result)
    else failures.push(result)
  }
  return { issues, failures }
}

/** The exact matches first, then the text results that are not one of them. */
function exactMatchesFirst(found: Issue[], result: IssueListResult): IssueListResult {
  const foundIds = new Set(found.map((i) => cacheKey(i.tracker, i.key)))
  return {
    issues: [...found, ...result.issues.filter((i) => !foundIds.has(cacheKey(i.tracker, i.key)))],
    failures: result.failures,
  }
}

function trackersFor(opts: { tracker?: TrackerId }): readonly TrackerId[] {
  return opts.tracker === undefined ? TRACKERS : [opts.tracker]
}

function searchMethods(context: ServiceContext): Pick<IssueService, 'listMine' | 'search'> {
  const { deps } = context
  return {
    async listMine(opts = {}): Promise<IssueListResult> {
      const limit = opts.limit ?? DEFAULT_LIMIT
      return gather(context, trackersFor(opts), async (tracker, cred) =>
        deps.providers[tracker].listMine(cred, await deps.getMine(tracker), limit)
      )
    },

    async search(term, opts = {}): Promise<IssueListResult> {
      const trackers = trackersFor(opts)
      const limit = opts.limit ?? DEFAULT_LIMIT
      const result = await gather(context, trackers, (tracker, cred) =>
        deps.providers[tracker].search(cred, term, limit)
      )
      // Typing a key exactly means that issue, and it may not be in the
      // operator's own search scope at all.
      if (!ISSUE_KEY.test(term)) return result
      const exact = await Promise.all(
        trackers.map((tracker) => context.get(tracker, term).catch(() => null))
      )
      const found = exact.filter((issue): issue is Issue => issue !== null)
      return found.length === 0 ? result : exactMatchesFirst(found, result)
    },
  }
}

function workflowMethods(
  context: ServiceContext
): Pick<IssueService, 'comment' | 'supportsTransitions' | 'states' | 'transition'> {
  const { deps, cache } = context
  return {
    async comment(tracker, key, body): Promise<void> {
      await context.call(tracker, (cred) => deps.providers[tracker].comment(cred, key, body))
      // The cached copy no longer has every comment on it.
      cache.delete(cacheKey(tracker, key))
    },
    supportsTransitions(tracker): boolean {
      const provider = deps.providers[tracker]
      return typeof provider?.states === 'function' && typeof provider.transition === 'function'
    },
    async states(tracker, key): Promise<TrackerStateOption[]> {
      const states = deps.providers[tracker]?.states
      if (states === undefined) throw unsupported(tracker)
      return context.call(tracker, (cred) => states(cred, key))
    },
    async transition(tracker, key, ...target: TransitionTarget): Promise<void> {
      const move = deps.providers[tracker]?.transition
      if (move === undefined) throw unsupported(tracker)
      await context.call(tracker, (cred) => move(cred, key, ...target))
      // Its state is exactly what just changed.
      cache.delete(cacheKey(tracker, key))
    },
  }
}

function createMethods(
  context: ServiceContext
): Pick<IssueService, 'supportsCreate' | 'teams' | 'create'> {
  const { deps, cache, now } = context
  return {
    supportsCreate(tracker): boolean {
      const provider = deps.providers[tracker]
      return typeof provider?.teams === 'function' && typeof provider.create === 'function'
    },
    async teams(tracker): Promise<TrackerTeam[]> {
      const list = deps.providers[tracker]?.teams
      if (list === undefined) throw unsupported(tracker, 'create an issue')
      return context.call(tracker, (cred) => list(cred))
    },
    async create(tracker, input): Promise<Issue> {
      const file = deps.providers[tracker]?.create
      if (file === undefined) throw unsupported(tracker, 'create an issue')
      const issue = await context.call(tracker, (cred) => file(cred, input))
      cache.set(cacheKey(tracker, issue.key), { issue, at: now() })
      return issue
    },
  }
}

function invalidator(cache: Map<string, CacheEntry>): IssueService['invalidate'] {
  return (tracker) => {
    if (tracker === undefined) {
      cache.clear()
      return
    }
    for (const key of cache.keys()) {
      if (key.startsWith(`${tracker}:`)) cache.delete(key)
    }
  }
}

function serviceContext(deps: IssueServiceDeps): ServiceContext {
  const policy: RetryPolicy = {
    onTrackerError: deps.onTrackerError,
    sleep: deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
  }
  const base = {
    deps,
    now: deps.now ?? Date.now,
    ttlMs: deps.ttlMs ?? DEFAULT_TTL_MS,
    cache: new Map<string, CacheEntry>(),
    async call<T>(tracker: TrackerId, work: (cred: StoredCredential) => Promise<T>): Promise<T> {
      const cred = await credentialFor(deps, tracker)
      return withRetry(policy, tracker, () => work(cred))
    },
  }
  return { ...base, get: cachedGet(base) }
}

export function createIssueService(deps: IssueServiceDeps): IssueService {
  const context = serviceContext(deps)
  return {
    ...searchMethods(context),
    get: context.get,
    ...workflowMethods(context),
    ...createMethods(context),
    invalidate: invalidator(context.cache),
  }
}
