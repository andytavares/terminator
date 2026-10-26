import { plural } from '@terminator/extension-sdk/plain'
import type { WorkThread } from '../../home/work-threads'
import { STATE_LABELS } from '../../home/task-state'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** "now", "4 m", "2 h" or "1 d": the Last column. */
export function compactAge(elapsedMs: number): string {
  if (elapsedMs < MINUTE_MS) return 'now'
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)} m`
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)} h`
  return `${Math.floor(elapsedMs / DAY_MS)} d`
}

/** "20 minutes", "3 hours" or "1 day": how long a thread has waited, in words.
 * @internal */
export function ageInWords(elapsedMs: number): string {
  const [count, unit]: [number, string] =
    elapsedMs < HOUR_MS
      ? [Math.max(1, Math.floor(elapsedMs / MINUTE_MS)), 'minute']
      : elapsedMs < DAY_MS
        ? [Math.floor(elapsedMs / HOUR_MS), 'hour']
        : [Math.floor(elapsedMs / DAY_MS), 'day']
  return `${count} ${plural(count, unit)}`
}

/** The state in words: "Running", "Waiting on others · 1 day". */
export function stateCaption(thread: WorkThread, now: number): string {
  const label = STATE_LABELS[thread.state]
  if (thread.state === 'waiting') return `${label} · ${ageInWords(now - thread.lastActivity)}`
  return label
}

export interface PullRequestSummary {
  number: number
  isDraft: boolean
  url: string | undefined
  checks: NonNullable<WorkThread['facets'][number]['checks']>
}

const PULL_REQUEST_NUMBER = /#(\d+)/

/** The thread's pull request, read from the facet an extension published for it. */
export function pullRequestOf(thread: WorkThread): PullRequestSummary | null {
  const facet = thread.facets.find((f) => f.kind === 'pull-request')
  const number = facet ? PULL_REQUEST_NUMBER.exec(facet.line)?.[1] : undefined
  if (!facet || number === undefined) return null
  return {
    number: Number(number),
    isDraft: /\bdraft\b/i.test(facet.line),
    url: facet.url,
    checks: facet.checks ?? [],
  }
}
