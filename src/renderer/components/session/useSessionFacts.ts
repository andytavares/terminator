import { useEffect, useMemo } from 'react'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useSessionRecordsStore } from '../../stores/session-records.store'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { buildSessionFacts, type SessionFacts } from '../../sidebar/session-facts'
import type { Issue, WorkItemRef } from '../../../shared/types/index'

/** Every session Home and the wall draw: the open ones, then the closed ones still kept. */
export function useSessionFacts(): SessionFacts[] {
  const sessions = useSessionStore((s) => s.sessions)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const projectsByWorkspaceId = useWorkspaceStore((s) => s.projectsByWorkspaceId)
  const records = useSessionRecordsStore((s) => s.records)
  const projectLinks = useIntegrationsStore((s) => s.links)

  // Whether a conversation can still be resumed is only true as of the moment
  // the main process looked, and the transcript belongs to the agent — it can
  // be deleted while the app is open. Asking again whenever a surface that
  // draws Resume appears is what stops it offering a button that would fail.
  useEffect(() => {
    void useSessionRecordsStore.getState().load()
  }, [])

  return useMemo(
    () =>
      buildSessionFacts({
        sessions: [...sessions.values()],
        records: [...records.values()],
        projects: [...projectsByWorkspaceId.values()].flat(),
        workspaces,
        projectLinks,
      }),
    [sessions, records, projectsByWorkspaceId, workspaces, projectLinks]
  )
}

/** The ticket behind a work item: undefined while it loads, null when it cannot be read. */
export function useIssue(ref: WorkItemRef | null | undefined): Issue | null | undefined {
  const tracker = ref?.tracker
  const key = ref?.key
  const issue = useIntegrationsStore((s) =>
    tracker === undefined || key === undefined ? undefined : s.issueByKey(tracker, key)
  )
  const loadIssue = useIntegrationsStore((s) => s.loadIssue)

  useEffect(() => {
    if (tracker !== undefined && key !== undefined) void loadIssue(tracker, key)
  }, [tracker, key, loadIssue])

  return issue
}

/** Ticket titles read so far, keyed `tracker:key`, so a text filter can match a ticket by its title. */
export function useIssueTitles(): Map<string, string> {
  const issuesByKey = useIntegrationsStore((s) => s.issuesByKey)
  return useMemo(() => {
    const titles = new Map<string, string>()
    for (const [id, issue] of issuesByKey) if (issue !== null) titles.set(id, issue.title)
    return titles
  }, [issuesByKey])
}
