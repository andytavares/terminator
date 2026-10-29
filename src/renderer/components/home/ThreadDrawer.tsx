import React, { useEffect } from 'react'
import { GitBranch } from 'lucide-react'
import { Button, Drawer, Kbd } from '@terminator/extension-ui'
import { SESSION_ACTIONS } from '../session/session-actions'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { useNow } from '../session/useNow'
import { recordUse } from '../../usage/record'
import { useDeskSelection } from './desk-selection'
import { useWorkThreads } from './useWorkThreads'
import { pullRequestOf, stateCaption } from './thread-format'
import { leadSessionOf, openLinkExternally, startAgentOnBranch } from './thread-actions'
import {
  AgentsSection,
  PullRequestSection,
  SummarySection,
  TerminalSection,
  TimelineSection,
} from './ThreadDrawerSections'
import { StateGlyph } from './StateGlyph'
import { LanesSection, TaskActions, taskCountsOf, taskSummaryOf } from './ThreadDrawerLanes'
import type { WorkThread } from '../../home/work-threads'
import './ThreadDrawer.css'

const MINUTE_MS = 60_000
const TRACKER_NAMES: Record<string, string> = { linear: 'Linear' }

function LinkButtons({ thread }: { thread: WorkThread }): JSX.Element {
  const pr = pullRequestOf(thread)
  const issue = useIntegrationsStore((s) => s.issuesByKey.get(thread.key))
  return (
    <>
      {pr?.url && (
        <Button size="sm" onClick={() => openLinkExternally(pr.url as string)}>
          {`Open pull request #${pr.number}`}
        </Button>
      )}
      {thread.links.map((link) => (
        <Button key={link.url} size="sm" onClick={() => openLinkExternally(link.url)}>
          {link.label}
        </Button>
      ))}
      {issue && (
        <Button size="sm" variant="ghost" onClick={() => openLinkExternally(issue.url)}>
          {`Open in ${TRACKER_NAMES[issue.tracker] ?? 'tracker'}`}
        </Button>
      )}
    </>
  )
}

function DrawerActions({ thread }: { thread: WorkThread }): JSX.Element {
  const lead = leadSessionOf(thread)
  return (
    <div className="desk-dr-h__acts">
      <Button
        size="sm"
        variant="primary"
        disabled={!lead}
        onClick={() => lead && SESSION_ACTIONS.onOpen(lead.sessionId)}
      >
        Open terminal
      </Button>
      <Button size="sm" disabled={!lead?.projectId} onClick={() => void startAgentOnBranch(thread)}>
        New agent on this branch
      </Button>
      <LinkButtons thread={thread} />
    </div>
  )
}

function ThreadDrawerHeader({ thread }: { thread: WorkThread }): JSX.Element {
  return (
    <div className="desk-dr-h">
      <div className="desk-dr-h__top">
        <span className="desk-sw" style={{ background: thread.lanes[0]?.repoColor ?? undefined }} />
        {thread.lanes[0]?.repoName}
        {thread.lanes[0] && (
          <>
            <span>·</span>
            <GitBranch aria-hidden="true" />
            <span className="desk-dr-h__branch">{thread.lanes[0].branch}</span>
          </>
        )}
        <span className="desk-dr-h__esc">
          <Kbd>Esc</Kbd>
        </span>
      </div>
      <h4>
        <StateGlyph state={thread.state} inferred={thread.inferred} />{' '}
        {thread.ticketKey && <span className="desk-dr-h__key">{thread.ticketKey}</span>}{' '}
        {thread.title}
      </h4>
      {thread.lanes.length > 0 && <p className="task-summary">{taskSummaryOf(thread)}</p>}
      <p className="task-summary task-summary--counts">{taskCountsOf(thread)}</p>
      <DrawerActions thread={thread} />
    </div>
  )
}

/** Escape and the shell's own focus return reach the row that was pressed; this covers a row that was not focused. */
function useReturnFocusToRow(key: string | undefined): void {
  useEffect(() => {
    if (key === undefined) return
    return () => {
      const rows = document.querySelectorAll<HTMLElement>('[data-thread-key]')
      Array.from(rows)
        .find((row) => row.dataset.threadKey === key)
        ?.focus()
    }
  }, [key])
}

/** The open work thread: what it is, what is happening, its agents, pull request and timeline. */
export function ThreadDrawer(): JSX.Element | null {
  const openKey = useDeskSelection((s) => s.openThreadKey)
  const closeThread = useDeskSelection((s) => s.closeThread)
  const { threads } = useWorkThreads()
  const now = useNow(MINUTE_MS)
  const thread = threads.find((t) => t.key === openKey)
  useReturnFocusToRow(thread?.key)
  const openedKey = thread?.key
  useEffect(() => {
    if (openedKey !== undefined) recordUse('core.home.thread-drawer', 'click')
  }, [openedKey])
  if (!thread) return null
  return (
    <Drawer label={thread.title} onDismiss={closeThread}>
      <ThreadDrawerHeader thread={thread} />
      <div className="desk-pipe">{stateCaption(thread, now)}</div>
      <div className="desk-dr-b">
        <LanesSection thread={thread} />
        <TerminalSection thread={thread} />
        <SummarySection thread={thread} />
        <AgentsSection thread={thread} now={now} />
        <PullRequestSection thread={thread} />
        <TimelineSection thread={thread} now={now} />
        <TaskActions thread={thread} />
      </div>
    </Drawer>
  )
}
