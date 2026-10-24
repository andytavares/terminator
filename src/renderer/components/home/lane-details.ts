import { sessionLineOf, type WorkThread } from '../../home/work-threads'
import type { ThreadFacet } from '../../../shared/schemas/home-feed.schema'
import type { SessionFacts } from '../../sidebar/session-facts'

export type ThreadLane = WorkThread['lanes'][number]

const folderName = (path: string): string => path.split('/').pop() ?? path

/** The sessions on one lane: the same branch in the same repo, which a session names by its workspace. */
export function sessionsOfLane(thread: WorkThread, lane: ThreadLane): SessionFacts[] {
  return thread.sessions.filter(
    (s) =>
      s.branch === lane.branch && (s.workspaceName ?? folderName(lane.repoRoot)) === lane.repoName
  )
}

/** The facets published for one lane's repo and branch. */
export function facetsOfLane(thread: WorkThread, lane: ThreadLane): ThreadFacet[] {
  return thread.facets.filter(
    (f) =>
      'repoRoot' in f.workKey &&
      f.workKey.repoRoot === lane.repoRoot &&
      f.workKey.branch === lane.branch
  )
}

/** The lane's pull request line, e.g. "#275 checks failing"; null when the lane has none. */
export function pullRequestLineOf(thread: WorkThread, lane: ThreadLane): string | null {
  return facetsOfLane(thread, lane).find((f) => f.kind === 'pull-request')?.line ?? null
}

/** What the lane's agents are doing now; empty when none is asking or working. */
export function laneNowLineOf(thread: WorkThread, lane: ThreadLane): string {
  return sessionLineOf(sessionsOfLane(thread, lane))
}
