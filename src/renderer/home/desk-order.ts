import type { HomeAsk } from '../../shared/schemas/home-feed.schema'

/** What the operator did with an item; kept so a re-render does not bring it back. */
export type Dismissal =
  | { kind: 'done'; at: number }
  | { kind: 'snoozed'; at: number; until: number; signature: string }

export type Dismissals = Readonly<Record<string, Dismissal>>

const KIND_ORDER: readonly HomeAsk['kind'][] = [
  'answer',
  'fix',
  'review',
  'decide',
  'finished',
  'task',
]

const MINUTE_MS = 60_000
const HOT_AFTER_MINUTES = 2

/** What an ask says, so a snoozed one can wake when it says something new. */
export function askSignature(ask: Pick<HomeAsk, 'detail' | 'facts'>): string {
  return [ask.detail, ...ask.facts].join('\n')
}

function isHidden(ask: HomeAsk, dismissals: Dismissals, now: number): boolean {
  const entry = dismissals[ask.id]
  if (!entry) return false
  if (entry.kind === 'done') return true
  return entry.until > now && entry.signature === askSignature(ask)
}

/** Asks in the order the operator should meet them: by kind, then oldest first. */
export function orderAsks<A extends HomeAsk>(
  asks: readonly A[],
  dismissals: Dismissals,
  now: number
): A[] {
  return asks
    .filter((ask) => !isHidden(ask, dismissals, now))
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        Date.parse(a.since) - Date.parse(b.since)
    )
}

/** How long ago, as "4 min", "3 h" or "2 d". */
export function ageLabel(since: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / MINUTE_MS))
  if (minutes < 60) return `${Math.max(1, minutes)} min`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} d`
}

/** An answer left waiting more than two minutes. */
export function isHot(ask: HomeAsk, now: number): boolean {
  return ask.kind === 'answer' && now - Date.parse(ask.since) > HOT_AFTER_MINUTES * MINUTE_MS
}
