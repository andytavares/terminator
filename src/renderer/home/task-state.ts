import type { ThreadFacet } from '../../shared/schemas/home-feed.schema'
import type { SessionFacts } from '../sidebar/session-facts'

export type TaskState = 'needs-you' | 'running' | 'waiting' | 'quiet' | 'done'

/** The five states, most urgent first: the order a list of tasks is read in. */
export const TASK_STATES: readonly TaskState[] = [
  'needs-you',
  'running',
  'waiting',
  'quiet',
  'done',
]

export const STATE_LABELS: Record<TaskState, string> = {
  'needs-you': 'Needs you',
  running: 'Running',
  waiting: 'Waiting on others',
  quiet: 'Quiet',
  done: 'Done',
}

/** What is known about one repo and branch of a task. */
export interface LaneFacts {
  sessions: readonly SessionFacts[]
  facets: readonly ThreadFacet[]
}

const isAsking = (s: SessionFacts) => s.state === 'awaiting-input'
const isOpen = (f: ThreadFacet) => f.closedAt === null

function isLaneDone({ sessions, facets }: LaneFacts): boolean {
  const pullRequests = facets.filter((f) => f.kind === 'pull-request')
  return (
    pullRequests.length > 0 &&
    pullRequests.every((f) => !isOpen(f)) &&
    sessions.every((s) => s.isClosed)
  )
}

/** One lane's state from its live facts; a branch with nothing happening is quiet. */
export function laneStateOf(lane: LaneFacts): TaskState {
  if (isLaneDone(lane)) return 'done'
  if (lane.sessions.some(isAsking) || lane.facets.some((f) => f.whoseMove === 'you')) {
    return 'needs-you'
  }
  if (lane.sessions.some((s) => s.state === 'working')) return 'running'
  if (lane.facets.some((f) => f.whoseMove === 'others' && isOpen(f))) return 'waiting'
  return 'quiet'
}

/** Done when marked so or when every lane is; otherwise the most urgent lane's state. */
export function taskStateOf(lanes: readonly LaneFacts[], doneAt: string | null): TaskState {
  const states = lanes.map(laneStateOf)
  if (doneAt !== null || (states.length > 0 && states.every((s) => s === 'done'))) return 'done'
  const ranks = states.map((s) => TASK_STATES.indexOf(s))
  return TASK_STATES[Math.min(...ranks, TASK_STATES.indexOf('quiet'))]
}

/** True when the ask comes only from a bell or a screen choice, with no hook or facet ask beside it. */
export function needsYouInferred(lanes: readonly LaneFacts[]): boolean {
  const asking = lanes.flatMap((l) => l.sessions).filter(isAsking)
  const factAsked =
    asking.some((s) => !s.askInferred) ||
    lanes.some((l) => l.facets.some((f) => f.whoseMove === 'you'))
  return asking.length > 0 && !factAsked
}
