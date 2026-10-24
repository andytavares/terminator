import type { ThreadFacet } from '../../shared/schemas/home-feed.schema'
import type { Task, TaskLane } from '../../shared/schemas/tasks.schema'
import type { SessionFacts } from '../sidebar/session-facts'

/** What is known about a lane, or about the work that sits on no branch. */
interface Members {
  sessions: SessionFacts[]
  facets: ThreadFacet[]
}

/** One repo and branch of a thread. */
export interface LaneDraft extends TaskLane, Members {}

/** The key one repo branch is joined under. */
export function laneKeyOf(repoRoot: string, branch: string): string {
  return `${repoRoot}#${branch}`
}

/** The key a stored task's thread is joined under. */
export function taskKeyOf(id: string): string {
  return `task:${id}`
}

/** The task holding each lane and each stored ticket ("linear:TAV-31"); a live task wins over an
 *  archived one, which still holds its sessions. */
export function taskKeysByLane(tasks: readonly Task[]): Map<string, string> {
  const byLane = new Map<string, string>()
  const archivedFirst = [...tasks].sort(
    (a, b) => Number(b.archivedAt !== null) - Number(a.archivedAt !== null)
  )
  for (const task of archivedFirst) {
    for (const lane of task.lanes)
      byLane.set(laneKeyOf(lane.repoRoot, lane.branch), taskKeyOf(task.id))
    if (task.ticket) byLane.set(`${task.ticket.tracker}:${task.ticket.key}`, taskKeyOf(task.id))
  }
  return byLane
}

// A lane per repo and branch the members touch, stored ones first even when empty. What sits
// on no branch (a scratch terminal, a ticket-keyed facet) comes back as `loose`.
export function groupIntoLanes(
  members: { sessions: readonly SessionFacts[]; facets: readonly ThreadFacet[] },
  stored: readonly TaskLane[],
  repoRootOf: (session: SessionFacts) => string | null
): { lanes: LaneDraft[]; loose: Members } {
  const lanes = new Map<string, LaneDraft>()
  const laneFor = (repoRoot: string, branch: string): LaneDraft => {
    const key = laneKeyOf(repoRoot, branch)
    const found = lanes.get(key) ?? { repoRoot, branch, sessions: [], facets: [] }
    lanes.set(key, found)
    return found
  }
  for (const lane of stored) laneFor(lane.repoRoot, lane.branch)
  const loose: Members = { sessions: [], facets: [] }
  for (const session of members.sessions) {
    const repoRoot = repoRootOf(session)
    if (repoRoot && session.branch) laneFor(repoRoot, session.branch).sessions.push(session)
    else loose.sessions.push(session)
  }
  for (const facet of members.facets) {
    if ('repoRoot' in facet.workKey)
      laneFor(facet.workKey.repoRoot, facet.workKey.branch).facets.push(facet)
    else loose.facets.push(facet)
  }
  return { lanes: [...lanes.values()], loose }
}
