import type { Disposable, ExtensionAPI } from '@terminator/extension-sdk'
import type { DashboardPR } from '../schemas/pr-review.schema.js'
import type { ContributionCalendar } from '../review/contribution-calendar.js'
import { createHomeActionHandler } from './actions.js'
import { buildGitHomeFeed } from './feed.js'
import type { TicketIndex } from './work-key.js'

/** How often the dashboard refreshes while its view is open (FOCUS_REFRESH_MS in ReviewDashboard.tsx). */
export const HOME_REFRESH_MS = 2 * 60 * 1000

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
  const run = () =>
    refresh().catch((error) => api.log.warn(`home: dashboard refresh failed: ${error}`))
  void run()
  const timer = setInterval(run, HOME_REFRESH_MS)
  return { dispose: () => clearInterval(timer) }
}

/** Keeps the latest dashboard and calendar and publishes the feed whenever either changes. */
export function createHomePublisher(api: ExtensionAPI, storage: string) {
  let prs: DashboardPR[] = []
  let calendar: ContributionCalendar | null = null
  let tickets: TicketIndex = new Map()
  const publishGitHomeFeed = () =>
    api.home.publish(
      buildGitHomeFeed({ prs, tickets, calendar, updatedAt: new Date().toISOString() })
    )
  return {
    hooks: {
      // A section that failed leaves its pull requests out; keep the previous feed instead.
      // The issues arrive later and must not hold up the dashboard's own answer.
      onDashboard: (result: DashboardRefresh) => {
        if (result.failed.length > 0) return
        prs = result.prs
        publishGitHomeFeed()
        void ticketIndexOf(api).then((index) => {
          tickets = index
          publishGitHomeFeed()
        })
      },
      onContributions: (fetched: ContributionCalendar) => {
        calendar = fetched
        publishGitHomeFeed()
      },
    },
    actions: api.home.onAction(createHomeActionHandler({ api, storage, pullRequests: () => prs })),
    refreshEvery: (refresh: () => Promise<unknown>) => refreshDashboardEvery(api, refresh),
  }
}
