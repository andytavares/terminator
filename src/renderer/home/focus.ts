import type { HomeFocusCandidate, WorkKey } from '../../shared/schemas/home-feed.schema'
import { workKeyId, type WorkThread } from './work-threads'

export interface FocusItem {
  id: string
  title: string
  detail?: string
  workKey?: WorkKey
  doneByHand: boolean
}

export const FOCUS_LIMIT = 3

/** The local calendar day of `now`, as the key a day's focus is kept under. */
export function localDateKey(now: number): string {
  const day = new Date(now)
  const padDatePart = (n: number) => String(n).padStart(2, '0')
  return `${day.getFullYear()}-${padDatePart(day.getMonth() + 1)}-${padDatePart(day.getDate())}`
}

/** Done by hand, or the work it points at shipped, or the task source says it is done. */
export function focusDone(
  item: FocusItem,
  threads: readonly WorkThread[],
  candidates: readonly HomeFocusCandidate[]
): boolean {
  if (item.doneByHand) return true
  const id = item.workKey ? workKeyId(item.workKey) : null
  const shipped = threads.some(
    (t) =>
      t.stage === 'shipped' && (t.key === id || t.facets.some((f) => workKeyId(f.workKey) === id))
  )
  return shipped || candidates.some((c) => c.id === item.id && c.done)
}

/** What yesterday left undone, to offer again today. */
export function carriedOver(yesterday: readonly FocusItem[]): FocusItem[] {
  return yesterday.filter((item) => !item.doneByHand)
}
