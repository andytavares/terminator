import { plural } from '@terminator/extension-sdk/plain'
import type { HomeAsk, HomeFocusCandidate } from '../../shared/schemas/home-feed.schema'
import { localDateKey, type FocusItem } from './focus'
import type { WorkThread } from './work-threads'

// What the morning band says, as functions of the data it is given.

/** The day before the local day of `now`, as the key a day's focus is kept under. */
export function yesterdayKey(now: number): string {
  const day = new Date(now)
  day.setDate(day.getDate() - 1)
  return localDateKey(day.getTime())
}

export interface PlanFacts {
  /** Yesterday's focus items, and how many of them got done. */
  focusTotal: number
  focusDone: number
  /** The agents finished and the reviews waiting on the operator right now. */
  waiting: { agents: number; reviews: number }
}

/** "Yesterday you finished 2 of 3 focus items. Waiting on you: 2 agents finished and 1 review." */
export function planSentence({ focusTotal, focusDone, waiting }: PlanFacts): string {
  const { agents, reviews } = waiting
  const yesterday =
    focusTotal === 0
      ? ''
      : `Yesterday you finished ${focusDone} of ${focusTotal} ${plural(focusTotal, 'focus item')}. `
  const waitingText =
    agents + reviews === 0
      ? 'Nothing is waiting on you.'
      : `Waiting on you: ${agents} ${plural(agents, 'agent')} finished and ${reviews} ${plural(reviews, 'review')}.`
  return yesterday + waitingText
}

const REVIEW_MINUTES = /about (\d+) min/

/** The sum of the "about N min" facts of the reviews you owe. */
export function estimatedReviewMinutes(asks: readonly HomeAsk[]): number {
  return asks
    .filter((ask) => ask.kind === 'review')
    .reduce((total, ask) => {
      const minutes = ask.facts.map((fact) => REVIEW_MINUTES.exec(fact)?.[1]).find(Boolean)
      return total + Number(minutes ?? 0)
    }, 0)
}

export interface PlanRow {
  id: string
  title: string
  detail?: string
  /** What Add puts in a focus slot. */
  item: Omit<FocusItem, 'doneByHand'>
}

function leftOverRow(item: FocusItem): PlanRow {
  const { id, title, workKey } = item
  return { id, title, detail: 'focus yesterday, not done', item: { id, title, workKey } }
}

function dueRow(candidate: HomeFocusCandidate): PlanRow {
  const { id, title, detail, workKey } = candidate
  return { id, title, detail, item: { id, title, detail, workKey: workKey ?? undefined } }
}

/** What yesterday left undone, then the tasks still open; nothing already picked, none twice. */
export function carriedOverRows(
  left: readonly FocusItem[],
  candidates: readonly HomeFocusCandidate[],
  picked: readonly FocusItem[]
): PlanRow[] {
  const seen = new Set(picked.map((item) => item.id))
  const rows = [...left.map(leftOverRow), ...candidates.filter((c) => !c.done).map(dueRow)]
  return rows.filter((row) => !seen.has(row.id) && seen.add(row.id))
}

/** The bar under the estimate: an hour of review fills it. */
const FULL_BAR_MINUTES = 60

export const reviewLoadShare = (minutes: number): number =>
  Math.min(100, Math.round((minutes / FULL_BAR_MINUTES) * 100))

/** "Already running: 5 agents across 3 tasks."; null when no agent is working. */
export function runningSentence(threads: readonly WorkThread[]): string | null {
  const working = threads.map((t) => t.sessions.filter((s) => s.state === 'working').length)
  const agents = working.reduce((sum, count) => sum + count, 0)
  if (agents === 0) return null
  const tasks = working.filter((count) => count > 0).length
  return `Already running: ${agents} ${plural(agents, 'agent')} across ${tasks} ${plural(tasks, 'task')}.`
}
