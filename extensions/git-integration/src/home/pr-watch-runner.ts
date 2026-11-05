import type { ExtensionAPI } from '@terminator/extension-sdk'
import type { DashboardPR } from '../schemas/pr-review.schema.js'
import { projectForCheckout } from '../review/terminal-project.js'
import { runGit } from '../shell/run-git.js'
import { worktreeFolderOf } from './actions.js'
import { pullRequestId } from './feed.js'
import {
  WAKE_LIMIT,
  becameConflicting,
  changesOf,
  endedWatches,
  latestSeen,
  newComments,
  newlyFailed,
  summaryOf,
  wakeMessage,
  type PrChange,
  type PrWatchReads,
  type PrWatchState,
  type WatchEvent,
  type WatchNote,
} from './pr-watch.js'

// Wakes the agent of a pull request of mine when its checks, reviews or merge state change (ADR 142).

const ENABLED_SETTING = 'terminator.git-integration.prWatch.enabled'

/** The per-pull-request state, kept between runs of the app. */
export interface WatchStore {
  get(key: string): Promise<PrWatchState | undefined>
  set(key: string, state: PrWatchState): Promise<void>
  delete(key: string): Promise<void>
}

interface WatchDeps {
  api: ExtensionAPI
  store: WatchStore
  /** Called with every note Home should show, after each change. */
  onNotes: (notes: WatchNote[]) => void
}

/** The running watch: its dependencies, its Home notes and the sessions it listens to. */
interface Watch extends WatchDeps {
  notes: Map<string, WatchNote>
  listening: Set<string>
}

/** One run over one pull request. */
interface Run {
  change: PrChange
  reads: PrWatchReads
  me: string
}

const freshState = (seenAt: string): PrWatchState => ({
  seenAt,
  wakes: 0,
  resumeUsed: false,
  stopped: false,
})

export function createPrWatch(deps: WatchDeps) {
  const watch: Watch = { ...deps, notes: new Map(), listening: new Set() }
  let previous: DashboardPR[] | undefined
  return {
    /** Compares the dashboard with the one before. The first dashboard after start only becomes the baseline. */
    async onDashboard(current: DashboardPR[], reads: PrWatchReads): Promise<void> {
      const before = previous
      previous = current
      if (!before || deps.api.settings.get<boolean>(ENABLED_SETTING) === false) return
      await Promise.all(endedWatches(before, current).map((pr) => endWatch(watch, pr)))
      const me = await reads.viewer()
      for (const change of changesOf(before, current)) {
        await watchOne(watch, { change, reads, me }).catch((error) =>
          deps.api.log.warn(`home: pull request watch failed for ${change.current.url}: ${error}`)
        )
      }
    },
  }
}

/** A pull request left my list: merged, closed, or out of the search for now. Its notes go;
 *  its counts stay, so a pull request that comes back does not get its limits again. */
async function endWatch(watch: Watch, pr: DashboardPR): Promise<void> {
  const key = pullRequestId(pr)
  const woken = watch.notes.delete(`woken:${key}`)
  const stopped = watch.notes.delete(`stopped:${key}`)
  if (woken || stopped) publish(watch)
}

function publish(watch: Watch): void {
  watch.onNotes([...watch.notes.values()])
}

async function watchOne(watch: Watch, run: Run): Promise<void> {
  const { change } = run
  const key = pullRequestId(change.current)
  const saved = (await watch.store.get(key)) ?? freshState(change.previous.updatedAt)
  const { events, seenAt } = await readEvents(run, saved.seenAt)
  const state = { ...saved, seenAt }
  if (events.length === 0 || state.stopped) return watch.store.set(key, state)
  return watch.store.set(key, await wake(watch, { pr: change.current, state, events }))
}

/** The events since `seenAt`. Comments are read only when GitHub says the pull request changed. */
async function readEvents(run: Run, seenAt: string) {
  const { change, reads, me } = run
  const moved = change.current.updatedAt !== change.previous.updatedAt
  const all = moved ? await reads.comments(change.current) : []
  const comments = newComments(all, { seenAt, me })
  const failed = newlyFailed(change)
  const logs: Record<string, string> = {}
  for (const check of failed) logs[check.name] = await reads.failedLog(change.current, check)
  const events: WatchEvent[] = [
    ...(failed.length > 0 ? [{ kind: 'check-failed' as const, checks: failed, logs }] : []),
    ...(comments.length > 0 ? [{ kind: 'comments' as const, comments }] : []),
    ...(becameConflicting(change) ? [{ kind: 'conflict' as const }] : []),
  ]
  return { events, seenAt: latestSeen(all, seenAt) }
}

interface Wake {
  pr: DashboardPR
  state: PrWatchState
  events: WatchEvent[]
}

/** Sends the events to the pull request's agent; returns the state to keep. */
async function wake(watch: Watch, { pr, state, events }: Wake): Promise<PrWatchState> {
  const summary = summaryOf(events)
  if (state.wakes >= WAKE_LIMIT) {
    note(watch, { kind: 'stopped', pr, summary, wake: state.wakes })
    return { ...state, stopped: true }
  }
  const target = await agentFor(watch, { pr, state })
  if (!target) return state
  const wakes = state.wakes + 1
  void watch.api.agents.prompt(target.sessionId, wakeMessage(pr, wakes, events))
  watch.api.usage.record('pr-watch-wake')
  note(watch, { kind: 'woken', pr, summary, wake: wakes })
  listenForEnd(watch, { key: pullRequestId(pr), sessionId: target.sessionId })
  return { ...state, wakes, resumeUsed: state.resumeUsed || target.resumed }
}

function note(watch: Watch, parts: Omit<WatchNote, 'since'>): void {
  const since = new Date().toISOString()
  const { kind, pr } = parts
  watch.notes.delete(`${kind === 'woken' ? 'stopped' : 'woken'}:${pullRequestId(pr)}`)
  watch.notes.set(`${kind}:${pullRequestId(pr)}`, { ...parts, since })
  publish(watch)
}

/** A live agent in the branch's worktree, else the last conversation resumed once. */
async function agentFor(watch: Watch, { pr, state }: Pick<Wake, 'pr' | 'state'>) {
  const { api } = watch
  const folder = await worktreeFolderOf(pr)
  if (!folder) return undefined
  const { live, resumable } = await api.agents.sessionsIn(folder)
  if (live[0]) return { sessionId: live[0], resumed: false }
  if (!resumable || state.resumeUsed) return undefined
  // An agent that is not running did not make these changes.
  if ((await runGit(folder, ['status', '--porcelain'])).length > 0) return undefined
  const projectId = projectForCheckout(api.workspace, folder)
  if (!projectId) return undefined
  const tab = { projectId, title: `Pull request #${pr.number}` }
  const started = await api.agents.start({ cwd: folder, resume: resumable, tab })
  return started ? { sessionId: started.sessionId, resumed: true } : undefined
}

/** An agent the watch woke that ends is the operator's Stop or an exit: the watch resumes no other. */
function listenForEnd(watch: Watch, { key, sessionId }: { key: string; sessionId: string }): void {
  if (watch.listening.has(sessionId)) return
  watch.listening.add(sessionId)
  watch.api.agents.onEnd(sessionId, () => {
    watch.listening.delete(sessionId)
    void watch.store.get(key).then((state) => {
      if (state) return watch.store.set(key, { ...state, resumeUsed: true })
    })
  })
}
