import React from 'react'
import { CircleCheck, CircleX, Factory, GitBranch } from 'lucide-react'
import { Chip, StageBar, StatusDot } from '@terminator/extension-ui'
import { compactAge, stageCaption } from './thread-format'
import { useDeskSelection } from './desk-selection'
import type { WorkThread } from '../../home/work-threads'

interface InFlightRowProps {
  thread: WorkThread
  now: number
  selected: boolean
}

const isOrder = (thread: WorkThread): boolean => thread.facets.some((f) => f.kind === 'order')

/** The mono label before the title: the ticket key, "Order", or the repo. */
function keyLabelOf(thread: WorkThread): string {
  if (thread.ticketKey) return thread.ticketKey
  return isOrder(thread) ? 'Order' : (thread.repoName ?? '')
}

function WorkCell({ thread }: { thread: WorkThread }): JSX.Element {
  const Icon = isOrder(thread) ? Factory : GitBranch
  const where = isOrder(thread) ? thread.repoName : (thread.branch ?? thread.repoName)
  return (
    <div className="desk-tr__work">
      <b>
        <span className="desk-sw" style={{ background: thread.repoColor ?? undefined }} />
        <span className="desk-tr__key">{keyLabelOf(thread)}</span>
        <span className="desk-tr__title">{thread.title}</span>
      </b>
      <small>
        <Icon aria-hidden="true" />
        {where}
        {thread.nowLine && <span> · </span>}
        <span className="desk-tr__now">{thread.nowLine}</span>
      </small>
    </div>
  )
}

function AgentsCell({ thread }: { thread: WorkThread }): JSX.Element {
  const live = thread.sessions.filter((s) => s.state === 'working' || s.state === 'awaiting-input')
  return (
    <div className="desk-tr__agents">
      {live.map((s) => (
        <StatusDot
          key={s.sessionId}
          tone={s.state === 'working' ? 'working' : 'waiting'}
          pulse={s.state === 'working'}
        />
      ))}
      {thread.agentsLabel}
    </div>
  )
}

function PullRequestCell({ thread }: { thread: WorkThread }): JSX.Element {
  const chip = thread.prChip
  if (!chip) return <Chip>{isOrder(thread) ? 'none yet' : 'no pull request'}</Chip>
  const icon = { bad: <CircleX aria-hidden="true" />, good: <CircleCheck aria-hidden="true" /> }
  return (
    <Chip tone={chip.tone} icon={icon[chip.tone as 'bad' | 'good']}>
      {chip.text}
    </Chip>
  )
}

/** One piece of work on the Desk; pressing it, or Enter, opens its drawer. */
export function InFlightRow({ thread, now, selected }: InFlightRowProps): JSX.Element {
  const openThread = useDeskSelection((s) => s.openThread)
  const classes = selected ? 'desk-tr desk-tr--selected' : 'desk-tr'
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={thread.title}
      aria-current={selected || undefined}
      data-thread-key={thread.key}
      className={classes}
      onClick={() => openThread(thread.key)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) openThread(thread.key)
      }}
    >
      <WorkCell thread={thread} />
      <StageBar
        stage={thread.stage}
        yourMove={thread.whoseMove === 'you'}
        caption={stageCaption(thread, now)}
      />
      <AgentsCell thread={thread} />
      <div>
        <PullRequestCell thread={thread} />
      </div>
      <div className="desk-tr__age">{compactAge(now - thread.lastActivity)}</div>
    </div>
  )
}
