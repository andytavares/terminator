import type { Disposable, ExtensionAPI } from '@terminator/extension-sdk'
import type { DashboardPR } from '../schemas/pr-review.schema.js'
import type { MergedPullRequest } from '../github/merged-search.js'
import type { ContributionCalendar } from '../review/contribution-calendar.js'
import { createHomeActionHandler } from './actions.js'
import { buildGitHomeFeed, type FeedInputs } from './feed.js'
import type { TicketIndex } from './work-key.js'

/** How often the dashboard refreshes while its view is open (FOCUS_REFRESH_MS in ReviewDashboard.tsx).
 * @internal */
export const HOME_REFRESH_MS = 2 * 60 * 1000

/** How often the merged pull requests are searched again: they change only when one merges.
 * @internal */
export const MERGED_REFRESH_MS = 15 * 60 * 1000

/** A dashboard search's answer, as far as Home reads it. */
interface DashboardRefresh {
  prs: DashboardPR[]
  failed: unknown[]
}

/** The user's open issues by key, refreshed with each dashboard; empty when no tracker answers. */
async function ticketIndexOf(api: ExtensionAPI): Promise<TicketIndex> {
  try {
    const { issues } = (await api.issues?.listMine()) ?? { issues: [] }
    return new Map(issues.map((issue) => [issue.key.toUpperCase(), issue.tracker]))
  } catch (error) {
    api.log.warn(`home: could not list the user's issues: ${error}`)
    return new Map()
  }
}

/** Runs `refresh` now and every HOME_REFRESH_MS: the dashboard only refreshes while its view is open. */
function refreshDashboardEvery(api: ExtensionAPI, refresh: () => Promise<unknown>): Disposable {
  return runEvery({ api, refresh, everyMs: HOME_REFRESH_MS, what: 'dashboard' })
}

interface RefreshLoop {
  api: ExtensionAPI
  refresh: () => Promise<unknown>
  everyMs: number
  what: string
}

function runEvery(loop: RefreshLoop): Disposable {
  const { api, refresh, everyMs, what } = loop
  const run = () =>
    refresh().catch((error) => api.log.warn(`home: ${what} refresh failed: ${error}`))
  void run()
  const timer = setInterval(run, everyMs)
  return { dispose: () => clearInterval(timer) }
}

/** The two background searches, each on its own interval. */
function refreshersOf(api: ExtensionAPI) {
  return {
    refreshEvery: (refresh: () => Promise<unknown>) => refreshDashboardEvery(api, refresh),
    refreshMergedEvery: (refresh: () => Promise<unknown>) =>
      runEvery({ api, refresh, everyMs: MERGED_REFRESH_MS, what: 'merged search' }),
  }
}

/** What has been read so far, and the way to publish it. */
function latestFeedOf(api: ExtensionAPI) {
  const latest: FeedInputs = {
    prs: [],
    tickets: new Map(),
    calendar: null,
    merged: [],
  }
  const publishGitHomeFeed = () => api.home.publish(buildGitHomeFeed(latest))
  return { latest, publishGitHomeFeed }
}

/** Keeps the latest dashboard, calendar and merged pull requests and publishes the feed whenever one changes. */
export function createHomePublisher(api: ExtensionAPI, storage: string) {
  const { latest, publishGitHomeFeed } = latestFeedOf(api)
  return {
    hooks: {
      // A section that failed leaves its pull requests out; keep the previous feed instead.
      // The issues arrive later and must not hold up the dashboard's own answer.
      onDashboard: (result: DashboardRefresh) => {
        if (result.failed.length > 0) return
        latest.prs = result.prs
        publishGitHomeFeed()
        void ticketIndexOf(api).then((index) => {
          latest.tickets = index
          publishGitHomeFeed()
        })
      },
      onMerged: (found: MergedPullRequest[]) => {
        latest.merged = found
        publishGitHomeFeed()
      },
      onContributions: (fetched: ContributionCalendar) => {
        latest.calendar = fetched
        publishGitHomeFeed()
      },
    },
    actions: api.home.onAction(
      createHomeActionHandler({ api, storage, pullRequests: () => latest.prs })
    ),
    ...refreshersOf(api),
  }
}
