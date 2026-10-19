import { plural } from '@terminator/extension-sdk/plain'
import type { HomeAsk, HomeFocusCandidate } from '../../shared/schemas/home-feed.schema'
import { localDateKey, type FocusItem } from './focus'
import type { SinceEvent } from './since-you-left'

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
  events: readonly SinceEvent[]
}

/** "Yesterday you finished 2 of 3 focus items. Overnight, 2 agents finished and 1 review came in." */
export function planSentence({ focusTotal, focusDone, events }: PlanFacts): string {
  const agents = events.filter((e) => e.kind === 'agent-finished').length
  const reviews = events.filter((e) => e.kind === 'review-requested').length
  const yesterday =
    focusTotal === 0
      ? ''
      : `Yesterday you finished ${focusDone} of ${focusTotal} ${plural(focusTotal, 'focus item')}. `
  const overnight =
    agents + reviews === 0
      ? 'Nothing new came in overnight.'
      : `Overnight, ${agents} ${plural(agents, 'agent')} finished and ${reviews} ${plural(reviews, 'review')} came in.`
  return yesterday + overnight
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

export type EventTone = 'good' | 'bad' | 'working'

const EVENT_TONE: Record<SinceEvent['kind'], EventTone> = {
  'agent-finished': 'good',
  'pull-request-approved': 'good',
  'pull-request-merged': 'good',
  'review-requested': 'working',
  'checks-failed': 'bad',
}

export const eventTone = (kind: SinceEvent['kind']): EventTone => EVENT_TONE[kind]

/** The bar under the estimate: an hour of review fills it. */
const FULL_BAR_MINUTES = 60

export const reviewLoadShare = (minutes: number): number =>
  Math.min(100, Math.round((minutes / FULL_BAR_MINUTES) * 100))
