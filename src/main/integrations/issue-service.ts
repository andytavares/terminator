import type {
  Issue,
  IssueListResult,
  IssueSummary,
  MineSelector,
  TrackerFailure,
  TrackerId,
} from '../../shared/types/index.js'
import { TrackerError, toErrorKind, toErrorMessage } from './tracker-error.js'
import type { StoredCredential, TrackerProvider } from './providers/provider.js'

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
  onTrackerError?: (tracker: TrackerId, kind: ReturnType<typeof toErrorKind> | null) => void
}

export interface IssueService {
  listMine(opts?: { tracker?: TrackerId; limit?: number }): Promise<IssueListResult>
  search(term: string, opts?: { tracker?: TrackerId; limit?: number }): Promise<IssueListResult>
  get(tracker: TrackerId, key: string, opts?: { refresh?: boolean }): Promise<Issue | null>
  comment(tracker: TrackerId, key: string, body: string): Promise<void>
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

export function createIssueService(deps: IssueServiceDeps): IssueService {
  const now = deps.now ?? Date.now
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  const cache = new Map<string, CacheEntry>()
  // Concurrent asks for one issue share one request. Without this, opening a
  // project with a badge, a drawer and a board row costs three.
  const inFlight = new Map<string, Promise<Issue | null>>()

  async function credentialFor(tracker: TrackerId): Promise<StoredCredential> {
    const cred = await deps.getCredential(tracker)
    if (cred === null) {
      throw new TrackerError('not-connected', `${tracker} is not connected`)
    }
    return cred
  }

  /**
   * Run a provider call, honouring a rate-limit refusal by waiting exactly as
   * long as the tracker asked and trying once more.
   *
   * Only rate limits are retried: an auth failure will not fix itself, and
   * retrying it just spends the operator's remaining budget.
   */
  async function withRetry<T>(tracker: TrackerId, work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await work()
        deps.onTrackerError?.(tracker, null)
        return result
      } catch (error) {
        const kind = toErrorKind(error)
        if (kind === 'rate-limited' && attempt < MAX_RATE_LIMIT_RETRIES) {
          const wait =
            error instanceof TrackerError && error.retryAfterMs !== undefined
              ? error.retryAfterMs
              : DEFAULT_RATE_LIMIT_WAIT_MS
          await sleep(wait)
          continue
        }
        if (kind === 'auth-failed') deps.onTrackerError?.(tracker, kind)
        throw error instanceof TrackerError
          ? error
          : new TrackerError(kind, toErrorMessage(error), { cause: error })
      }
    }
  }

  async function fetchIssue(tracker: TrackerId, key: string): Promise<Issue | null> {
    const cred = await credentialFor(tracker)
    return withRetry(tracker, () => deps.providers[tracker].get(cred, key))
  }

  async function get(
    tracker: TrackerId,
    key: string,
    opts: { refresh?: boolean } = {}
  ): Promise<Issue | null> {
    const id = cacheKey(tracker, key)

    if (opts.refresh !== true) {
      const hit = cache.get(id)
      if (hit !== undefined && now() - hit.at < ttlMs) return hit.issue
      const pending = inFlight.get(id)
      if (pending !== undefined) return pending
    }

    const request = fetchIssue(tracker, key)
      .then((issue) => {
        cache.set(id, { issue, at: now() })
        return issue
      })
      .finally(() => {
        // Cleared on failure too, or one dropped connection would poison this
        // key for the life of the process.
        inFlight.delete(id)
      })

    inFlight.set(id, request)
    return request
  }

  /**
   * Ask every connected tracker and keep what comes back.
   *
   * A tracker that fails does not fail the call — the operator sees the issues
   * that arrived and is told which tracker is missing and why. A partial list
   * presented as complete is the failure this shape exists to prevent.
   */
  async function gather(
    trackers: readonly TrackerId[],
    work: (tracker: TrackerId, cred: StoredCredential) => Promise<IssueSummary[]>
  ): Promise<IssueListResult> {
    const issues: IssueSummary[] = []
    const failures: TrackerFailure[] = []

    const settled = await Promise.all(
      trackers.map(async (tracker): Promise<TrackerFailure | IssueSummary[]> => {
        try {
          const cred = await credentialFor(tracker)
          return await withRetry(tracker, () => work(tracker, cred))
        } catch (error) {
          return { tracker, error: toErrorKind(error) }
        }
      })
    )

    for (const result of settled) {
      if (Array.isArray(result)) issues.push(...result)
      else failures.push(result)
    }
    return { issues, failures }
  }

  return {
    async listMine(opts = {}): Promise<IssueListResult> {
      const trackers = opts.tracker === undefined ? TRACKERS : [opts.tracker]
      const limit = opts.limit ?? DEFAULT_LIMIT
      return gather(trackers, async (tracker, cred) =>
        deps.providers[tracker].listMine(cred, await deps.getMine(tracker), limit)
      )
    },

    async search(term, opts = {}): Promise<IssueListResult> {
      const trackers = opts.tracker === undefined ? TRACKERS : [opts.tracker]
      const limit = opts.limit ?? DEFAULT_LIMIT
      const result = await gather(trackers, (tracker, cred) =>
        deps.providers[tracker].search(cred, term, limit)
      )

      // Typing a key exactly means that issue, and it may not be in the
      // operator's own search scope at all.
      if (!ISSUE_KEY.test(term)) return result

      const exact = await Promise.all(
        trackers.map((tracker) => get(tracker, term).catch(() => null))
      )
      const found = exact.filter((issue): issue is Issue => issue !== null)
      if (found.length === 0) return result

      const foundIds = new Set(found.map((i) => cacheKey(i.tracker, i.key)))
      return {
        issues: [
          ...found,
          ...result.issues.filter((i) => !foundIds.has(cacheKey(i.tracker, i.key))),
        ],
        failures: result.failures,
      }
    },

    get,

    async comment(tracker, key, body): Promise<void> {
      const cred = await credentialFor(tracker)
      await withRetry(tracker, () => deps.providers[tracker].comment(cred, key, body))
      // The cached copy no longer has every comment on it.
      cache.delete(cacheKey(tracker, key))
    },

    invalidate(tracker): void {
      if (tracker === undefined) {
        cache.clear()
        return
      }
      for (const key of cache.keys()) {
        if (key.startsWith(`${tracker}:`)) cache.delete(key)
      }
    },
  }
}
