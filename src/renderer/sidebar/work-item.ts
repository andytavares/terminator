import type { IssueLink, WorkItemRef } from '../../shared/types/index'

/** The ticket a session is working on, and whose link put it there. */
export interface WorkItem {
  source: 'session' | 'project'
  ref: WorkItemRef
}

/**
 * A session's own link wins; otherwise it inherits its project's.
 *
 * Two sessions in one project can serve different tickets, but most do not, so
 * the project link is the default and the session link the exception.
 */
export function resolveWorkItem(
  ownLink: WorkItemRef | null,
  projectLink: IssueLink | null
): WorkItem | null {
  if (ownLink !== null) return { source: 'session', ref: ownLink }
  if (projectLink !== null) {
    return { source: 'project', ref: { tracker: projectLink.tracker, key: projectLink.key } }
  }
  return null
}
