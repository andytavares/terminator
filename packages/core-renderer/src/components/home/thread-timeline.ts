import type { Dismissals } from '../../home/desk-order'
import type { WorkThread } from '../../home/work-threads'
import type { StatusTone } from '@terminator/extension-ui'

export interface TimelineEntry {
  at: number
  tone: StatusTone
  text: string
  /** Shown bold after the text: the session, pull request or answer it is about. */
  strong?: string
}

const TIMELINE_LIMIT = 8
const ANSWER_ID_PREFIX = 'core:answer:'
const FACET_TONE: Record<WorkThread['facets'][number]['tone'], StatusTone> = {
  neutral: 'muted',
  good: 'good',
  bad: 'bad',
  waiting: 'waiting',
}

function sessionEntries(thread: WorkThread): TimelineEntry[] {
  return thread.sessions.flatMap((s) => [
    { at: Date.parse(s.startedAt), tone: 'muted' as const, text: 'Started', strong: s.name },
    ...(s.closedAt === null
      ? []
      : [{ at: Date.parse(s.closedAt), tone: 'good' as const, text: 'Finished', strong: s.name }]),
  ])
}

function answerEntries(thread: WorkThread, dismissals: Dismissals): TimelineEntry[] {
  return thread.sessions.flatMap((s) =>
    Object.entries(dismissals)
      .filter(
        ([id, entry]) =>
          entry.kind === 'done' && id.startsWith(`${ANSWER_ID_PREFIX}${s.sessionId}:`)
      )
      .map(([, entry]) => ({
        at: entry.at,
        tone: 'muted' as const,
        text: 'You answered',
        strong: s.name,
      }))
  )
}

function facetEntries(thread: WorkThread): TimelineEntry[] {
  return thread.facets.map((f) => ({
    at: Date.parse(f.updatedAt),
    tone: FACET_TONE[f.tone],
    text: f.kind === 'pull-request' ? 'Pull request' : 'Order',
    strong: f.line,
  }))
}

/** What happened to this work, newest first, from its sessions, your answers and its facets. */
export function buildTimeline(thread: WorkThread, dismissals: Dismissals): TimelineEntry[] {
  return [...sessionEntries(thread), ...answerEntries(thread, dismissals), ...facetEntries(thread)]
    .filter((entry) => !Number.isNaN(entry.at))
    .sort((a, b) => b.at - a.at)
    .slice(0, TIMELINE_LIMIT)
}

/** "10:39" for today, else "Oct 17". */
export function timelineTime(at: number, now: number): string {
  const when = new Date(at)
  if (when.toDateString() === new Date(now).toDateString()) {
    return when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  }
  return when.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
