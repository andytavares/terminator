import type { Disposable, ExtensionAPI } from '@terminator/extension-sdk'
import type { DashboardPR } from '../schemas/pr-review.schema.js'
import type { MergedPullRequest } from '../github/merged-search.js'
import type { ContributionCalendar } from '../review/contribution-calendar.js'
import { autoPullDefault } from '../git/auto-pull.js'
import { runGit } from '../shell/run-git.js'
import { createHomeActionHandler } from './actions.js'
import { buildGitHomeFeed, type FeedInputs } from './feed.js'
import type { PrWatchReads, PrWatchState } from './pr-watch.js'
import { createPrWatch } from './pr-watch-runner.js'
import { namedStore } from '../storage-directory.js'
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

/** Fast-forwards each local repository's default branch when "Keep the default branch up to date" is on. */
async function pullDefaultBranches(api: ExtensionAPI, repoRoots: () => string[]): Promise<void> {
  if (api.settings.get<boolean>('terminator.git-integration.git.autoPullDefault') !== true) return
  for (const root of new Set(repoRoots())) {
    await autoPullDefault((cwd, args) => runGit(cwd, args), root).catch((error) =>
      api.log.warn(`home: could not update the default branch of ${root}: ${error}`)
    )
  }
}

/** Runs `refresh` now and every HOME_REFRESH_MS: the dashboard only refreshes while its view is open.
 *  Each run also pulls the default branches, apart from the dashboard so a slow fetch holds nothing up. */
function refreshDashboardEvery(
  api: ExtensionAPI,
  refresh: () => Promise<unknown>,
  repoRoots: () => string[]
): Disposable {
  const refreshAndPull = () => {
    void pullDefaultBranches(api, repoRoots)
    return refresh()
  }
  return runEvery({ api, refresh: refreshAndPull, everyMs: HOME_REFRESH_MS, what: 'dashboard' })
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
function refreshersOf(api: ExtensionAPI, repoRoots: () => string[]) {
  return {
    refreshEvery: (refresh: () => Promise<unknown>) =>
      refreshDashboardEvery(api, refresh, repoRoots),
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

/** The pull request watch's state, one entry per pull request, in the extension's own store. */
const watchStore = {
  get: async (key: string) => (await namedStore<PrWatchState>('pr-watch')).get(key),
  set: async (key: string, state: PrWatchState) =>
    void (await namedStore<PrWatchState>('pr-watch')).set(key, state),
  delete: async (key: string) => void (await namedStore<PrWatchState>('pr-watch')).delete(key),
}

/** The pull request watch; its notes join the next feed. */
function prWatchOf(api: ExtensionAPI, feed: ReturnType<typeof latestFeedOf>) {
  return createPrWatch({
    api,
    store: watchStore,
    onNotes: (notes) => {
      feed.latest.watchNotes = notes
      feed.publishGitHomeFeed()
    },
  })
}

/** What the GitHub handlers call when a dashboard, merged search or contributions fetch lands. */
function feedHooks(api: ExtensionAPI, feed: ReturnType<typeof latestFeedOf>) {
  const { latest, publishGitHomeFeed } = feed
  const watch = prWatchOf(api, feed)
  return {
    // A section that failed leaves its pull requests out; keep the previous feed instead.
    // The issues arrive later and must not hold up the dashboard's own answer.
    onDashboard: (result: DashboardRefresh, reads?: PrWatchReads) => {
      if (result.failed.length > 0) return
      latest.prs = result.prs
      publishGitHomeFeed()
      if (reads) {
        void watch
          .onDashboard(result.prs, reads)
          .catch((error) => api.log.warn(`home: pull request watch failed: ${error}`))
      }
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
  }
}

/** Keeps the latest dashboard, calendar and merged pull requests and publishes the feed whenever one changes. */
export function createHomePublisher(
  api: ExtensionAPI,
  storage: string,
  repoRoots: () => string[] = () => []
) {
  const feedOf = latestFeedOf(api)
  const { latest } = feedOf
  return {
    hooks: feedHooks(api, feedOf),
    actions: api.home.onAction(
      createHomeActionHandler({ api, storage, pullRequests: () => latest.prs })
    ),
    /** Head branches of my merged pull requests in `repoRoot`; the Worktrees cleanup reads them. */
    mergedHeads: (repoRoot: string) =>
      latest.merged.filter((pr) => pr.localRepoRoot === repoRoot).map((pr) => pr.headRefName),
    ...refreshersOf(api, repoRoots),
  }
}

export type HomePublisher = ReturnType<typeof createHomePublisher>
