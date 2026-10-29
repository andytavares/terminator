import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk/plain'
import { SESSION_ACTIONS } from '../session/session-actions'
import { SessionLinkDialog } from '../session/SessionLinkDialog'
import { useChangeStatsStore } from '../../stores/change-stats.store'
import { StateGlyph } from './StateGlyph'
import { AddLaneControls } from './ThreadDrawerAddLane'
import { leadSessionOf, toggleArchived } from './thread-actions'
import { openAllLanes, renameThread, toggleDone } from './task-actions'
import { laneNowLineOf, pullRequestLineOf, sessionsOfLane, type ThreadLane } from './lane-details'
import type { WorkThread } from '../../home/work-threads'

/** "1 repo · 2 branches · started Thursday": where the task lives and since when. */
export function taskSummaryOf(thread: WorkThread): string {
  const repos = new Set(thread.lanes.map((l) => l.repoName)).size
  const branches = [...new Set(thread.lanes.map((l) => l.branch))]
  const where =
    branches.length === 1
      ? `branch ${branches[0]}${repos > 1 ? ' in each' : ''}`
      : `${branches.length} branches`
  const started = new Date(thread.startedAt).toLocaleDateString(undefined, { weekday: 'long' })
  return `${repos} ${plural(repos, 'repo')} · ${where} · started ${started}`
}

/** "1 asking · 2 running · 1 pull request": only what is happening, zeros left out. */
export function taskCountsOf(thread: WorkThread): string {
  const count = (state: string) => thread.sessions.filter((s) => s.state === state).length
  const pullRequests = thread.facets.filter((f) => f.kind === 'pull-request').length
  return [
    [count('awaiting-input'), 'asking'],
    [count('working'), 'running'],
    [pullRequests, plural(pullRequests, 'pull request')],
  ]
    .filter(([n]) => n !== 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(' · ')
}

/** The lane's uncommitted change, as "+184 −22"; empty when nothing is known or changed. */
function useLaneChanges(thread: WorkThread, lane: ThreadLane): string {
  const entries = useChangeStatsStore((s) => s.entries)
  const ids = sessionsOfLane(thread, lane).flatMap((s) => (s.projectId ? [s.projectId] : []))
  const stats = ids.map((id) => entries.get(id)?.stats).find((found) => found)
  return stats && (stats.added || stats.removed) ? `+${stats.added} −${stats.removed}` : ''
}

/** What the lane's agents are doing, its change size and its pull request, each only when known. */
function LaneDetails({
  thread,
  lane,
}: {
  thread: WorkThread
  lane: ThreadLane
}): React.JSX.Element | null {
  const changes = useLaneChanges(thread, lane)
  const parts = [
    laneNowLineOf(thread, lane),
    changes,
    pullRequestLineOf(thread, lane) ?? '',
  ].filter(Boolean)
  if (parts.length === 0) return null
  return (
    <div className="task-lane-row__details">
      {parts.map((part, index) => (
        <React.Fragment key={part}>
          {index > 0 && ' · '}
          <span>{part}</span>
        </React.Fragment>
      ))}
    </div>
  )
}

function LaneRow({ thread, lane }: { thread: WorkThread; lane: ThreadLane }): React.JSX.Element {
  const open = leadSessionOf({ ...thread, sessions: sessionsOfLane(thread, lane) })
  return (
    <li className="task-lane-row" aria-label={`${lane.branch} lane`}>
      <StateGlyph state={lane.state} />
      <div>
        <div className="task-lane-row__name">
          <span className="task-lane">
            <i className="task-lane__colour" style={{ background: lane.repoColor ?? undefined }} />
            {lane.repoName}
          </span>{' '}
          {lane.branch}
        </div>
        <LaneDetails thread={thread} lane={lane} />
      </div>
      {open && (
        <Button size="sm" variant="ghost" onClick={() => SESSION_ACTIONS.onOpen(open.sessionId)}>
          {lane.state === 'needs-you' ? 'Answer' : 'Open'}
        </Button>
      )}
    </li>
  )
}

/** One row per repo and branch the task touches. */
export function LanesSection({ thread }: { thread: WorkThread }): React.JSX.Element | null {
  if (thread.lanes.length === 0) return null
  return (
    <section className="desk-dr-s">
      <h6>Lanes</h6>
      <ul className="task-lane-rows" aria-label="Lanes">
        {thread.lanes.map((lane) => (
          <LaneRow key={`${lane.repoRoot}#${lane.branch}`} thread={thread} lane={lane} />
        ))}
      </ul>
      <AddLaneControls thread={thread} />
    </section>
  )
}

function RenameTask({ thread, onDone }: { thread: WorkThread; onDone: () => void }) {
  return (
    <input
      className="desk-tr__rename"
      aria-label="Rename task"
      defaultValue={thread.title}
      autoFocus
      onKeyDown={(e) => {
        if (e.key === 'Enter') renameThread(thread, e.currentTarget.value)
        if (e.key === 'Enter' || e.key === 'Escape') onDone()
      }}
    />
  )
}

interface ActionButtonsProps {
  thread: WorkThread
  onRename: () => void
  onLink: (() => void) | null
}

function TaskActionButtons({ thread, onRename, onLink }: ActionButtonsProps): React.JSX.Element {
  return (
    <div className="desk-dr-h__acts">
      <Button size="sm" onClick={() => openAllLanes(thread)}>
        Open all lanes
      </Button>
      {onLink && (
        <Button size="sm" onClick={onLink}>
          Link a ticket
        </Button>
      )}
      <Button size="sm" onClick={onRename}>
        Rename
      </Button>
      <Button size="sm" onClick={() => void toggleDone(thread)}>
        {thread.doneAt === null ? 'Mark done' : 'Undo done'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => toggleArchived(thread)}>
        {thread.archived ? 'Restore' : 'Archive'}
      </Button>
    </div>
  )
}

/** Open all lanes, link a ticket, rename, mark done and archive. */
export function TaskActions({ thread }: { thread: WorkThread }): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const [linking, setLinking] = useState(false)
  const lead = leadSessionOf(thread)
  return (
    <section className="desk-dr-s">
      <h6>Task</h6>
      <TaskActionButtons
        thread={thread}
        onRename={() => setRenaming(true)}
        onLink={lead ? () => setLinking(true) : null}
      />
      {renaming && <RenameTask thread={thread} onDone={() => setRenaming(false)} />}
      {linking && lead && <SessionLinkDialog facts={lead} onClose={() => setLinking(false)} />}
    </section>
  )
}
