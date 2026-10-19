import React, { useState } from 'react'
import { CircleCheck, CircleX, Clock } from 'lucide-react'
import { Button, StatusDot, type StatusTone } from '@terminator/extension-ui'
import { SESSION_ACTIONS } from '../session/session-actions'
import { LivePreview } from '../session/LivePreview'
import { useDismissalsStore } from '../../home/dismissals'
import { ageLabel } from '../../home/desk-order'
import { useThreadSummary } from './useThreadSummary'
import { usageLabel, useSessionUsage } from './useSessionUsage'
import { pullRequestOf } from './thread-format'
import { leadSessionOf, useSendToAgent } from './thread-actions'
import { buildTimeline, timelineTime } from './thread-timeline'
import { planResume } from '../../sidebar/resume'
import type { SessionFacts } from '../../sidebar/session-facts'
import type { WorkThread } from '../../home/work-threads'

interface SectionProps {
  thread: WorkThread
  now: number
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="desk-dr-s">
      <h6>{title}</h6>
      {children}
    </section>
  )
}

function terminalName(lead: SessionFacts): string {
  if (lead.agent) return lead.agent.provider
  return lead.shell?.split('/').pop() ?? 'terminal'
}

/** The lead session's live terminal, opened full size on click. Only for a thread with an open session. */
export function TerminalSection({ thread }: { thread: WorkThread }): JSX.Element | null {
  const lead = leadSessionOf(thread)
  if (!lead) return null
  const open = (): void => SESSION_ACTIONS.onOpen(lead.sessionId)
  return (
    <Section title={`LIVE TERMINAL · ${terminalName(lead)}`}>
      <div
        className="desk-dr__terminal"
        role="button"
        tabIndex={0}
        aria-label="Open terminal"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
      >
        <LivePreview sessionId={lead.sessionId} className="desk-dr__terminal-view" />
        <span className="desk-dr__live">
          <StatusDot tone="good" /> live
        </span>
      </div>
      <p className="desk-dr-hint">Click the terminal to open it full size.</p>
    </Section>
  )
}

/** The model's account of the work, with the operator's own note under it when there is one. */
export function SummarySection({ thread }: { thread: WorkThread }): JSX.Element {
  const { summary, retry } = useThreadSummary(thread)
  const note = thread.sessions.find((s) => s.description)?.description
  return (
    <Section title="WHAT IS HAPPENING">
      {summary.status === 'loading' && <p className="desk-dr-text">Writing a summary…</p>}
      {summary.status === 'error' && (
        <p className="desk-dr-text">
          Could not write a summary just now.{' '}
          <Button size="sm" variant="ghost" onClick={retry}>
            Retry
          </Button>
        </p>
      )}
      {summary.status === 'ready' && (
        <p className="desk-dr-text">
          {summary.text}{' '}
          <span className="desk-dr-muted">
            From the agents&apos; latest messages and the pull request.
          </span>
        </p>
      )}
      {note && <p className="desk-dr-text desk-dr-note">{note}</p>}
    </Section>
  )
}

const STATE_TONE: Partial<Record<SessionFacts['state'], StatusTone>> = {
  working: 'working',
  'awaiting-input': 'waiting',
}

const sessionDotTone = (s: SessionFacts): StatusTone =>
  STATE_TONE[s.state] ?? (s.agent ? 'good' : 'muted')

function sessionDetails(s: SessionFacts, props: SectionProps, usage: string | undefined) {
  const lead = props.thread.sessions[0] === s
  const changes = props.thread.changes
  return [
    s.agent ? 'Claude' : (s.shell?.split('/').pop() ?? 'terminal'),
    s.isClosed ? 'ended' : ageLabel(s.startedAt, props.now),
    lead && changes && (changes.added || changes.removed)
      ? `+${changes.added} −${changes.removed}`
      : '',
    usage ?? '',
  ].filter(Boolean)
}

function SessionRow(props: SectionProps & { session: SessionFacts; usage?: string }): JSX.Element {
  const { session: s } = props
  const what = s.latestLine || s.description?.split('\n')[0] || s.name
  const canResume = planResume(s) !== null
  return (
    <div className="desk-lr">
      <StatusDot tone={sessionDotTone(s)} pulse={s.state === 'working'} />
      <span>
        {what} <small>· {sessionDetails(s, props, props.usage).join(' · ')}</small>
      </span>
      <span className="desk-lr__actions">
        {canResume && (
          <Button size="sm" variant="ghost" onClick={() => SESSION_ACTIONS.onResume?.(s)}>
            Resume
          </Button>
        )}
        {!s.isClosed && (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Open ${what}`}
            onClick={() => SESSION_ACTIONS.onOpen(s.sessionId)}
          >
            Open
          </Button>
        )}
      </span>
    </div>
  )
}

export function AgentsSection(props: SectionProps): JSX.Element {
  const { sessions } = props.thread
  const usage = useSessionUsage(sessions.map((s) => s.sessionId))
  return (
    <Section title={`AGENTS AND TERMINALS · ${sessions.length}`}>
      {sessions.map((s) => {
        const used = usage.get(s.sessionId)
        return (
          <SessionRow key={s.sessionId} {...props} session={s} usage={used && usageLabel(used)} />
        )
      })}
    </Section>
  )
}

type Check = NonNullable<WorkThread['facets'][number]['checks']>[number]

const CHECK_ICON = {
  failed: <CircleX aria-label="Failed" className="desk-lr__icon desk-lr__icon--bad" />,
  passed: <CircleCheck aria-label="Passed" className="desk-lr__icon desk-lr__icon--good" />,
  running: <Clock aria-label="Running" className="desk-lr__icon" />,
}

function CheckRow({ check, thread }: { check: Check; thread: WorkThread }): JSX.Element {
  const sendToAgent = useSendToAgent(thread)
  const [failed, setFailed] = useState(false)
  const send = async (): Promise<void> => setFailed(!(await sendToAgent?.()))
  return (
    <div className="desk-lr">
      {CHECK_ICON[check.state]}
      <span>
        {check.name} {check.detail && <small>· {check.detail}</small>}
        {failed && <small> · Could not send this to an agent.</small>}
      </span>
      {check.state === 'failed' && sendToAgent ? (
        <Button size="sm" onClick={() => void send()}>
          Send to agent
        </Button>
      ) : (
        <span />
      )}
    </div>
  )
}

export function PullRequestSection({ thread }: { thread: WorkThread }): JSX.Element | null {
  const pr = pullRequestOf(thread)
  if (!pr) return null
  return (
    <Section title={`PULL REQUEST #${pr.number}${pr.isDraft ? ' · DRAFT' : ''}`}>
      {pr.checks.map((check) => (
        <CheckRow key={`${check.state}:${check.name}`} check={check} thread={thread} />
      ))}
    </Section>
  )
}

export function TimelineSection({ thread, now }: SectionProps): JSX.Element {
  const dismissals = useDismissalsStore((s) => s.entries)
  return (
    <Section title="TIMELINE">
      <ul className="desk-tl">
        {buildTimeline(thread, dismissals).map((entry) => (
          <li key={`${entry.at}:${entry.text}:${entry.strong}`}>
            <time>{timelineTime(entry.at, now)}</time>
            <StatusDot tone={entry.tone} />
            <span>
              {entry.text} {entry.strong && <b>{entry.strong}</b>}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  )
}
