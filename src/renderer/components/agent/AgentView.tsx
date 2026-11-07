import React, { useEffect, useRef } from 'react'
import { Button, DiffView } from '@terminator/extension-ui'
import type { AgentPermissionAsk } from '@terminator/extension-sdk'
import { useSessionStore } from '../../stores/session.store'
import {
  diffLinesOf,
  inputSummary,
  relativeTo,
  splitTurns,
  type TranscriptEntry,
  type Turn,
  type ToolEntry,
  type Transcript,
  type Usage,
} from './fold-updates'
import { Composer } from './Composer'
import {
  FindBar,
  Highlighted,
  firstMatches,
  noFind,
  useFind,
  type FindControls,
  type FindState,
} from './find'
import { useAgentTranscript } from './use-agent-transcript'
import { recordUse } from '../../usage/record'
import './AgentView.css'

/** Context used as a percentage, and the cost when the agent reports one. */
function contextLabel({ used, size, cost }: Usage): string {
  const percent = size > 0 ? Math.round((used / size) * 100) : 0
  const spent = cost
    ? ` · ${cost.currency === 'USD' ? '$' : `${cost.currency} `}${cost.amount.toFixed(2)}`
    : ''
  return `${percent}% of context${spent}`
}

function AskBand({
  ask,
  onAnswer,
}: {
  ask: AgentPermissionAsk
  onAnswer: (optionId: string) => void
}) {
  const detail = inputSummary(ask.rawInput)
  return (
    <div role="group" aria-label={ask.title} className="agent-ask">
      <div className="agent-ask__what">
        <strong>{ask.title}</strong>
        {detail && <code className="agent-ask__detail">{detail}</code>}
      </div>
      <div className="agent-ask__options">
        {ask.options.map((option) => (
          <Button
            key={option.optionId}
            variant={option.kind.startsWith('allow') ? 'primary' : 'secondary'}
            onClick={() => onAnswer(option.optionId)}
          >
            {option.name}
          </Button>
        ))}
      </div>
    </div>
  )
}

function ToolCall({ tool, cwd }: { tool: ToolEntry; cwd: string }): React.JSX.Element {
  return (
    <div className="agent-tool">
      <div className="agent-tool__head">
        <span className="agent-tool__title">{tool.title}</span>
        {tool.status && <span className="agent-tool__status">{tool.status.replace('_', ' ')}</span>}
        {tool.detail && <code className="agent-tool__detail">{relativeTo(cwd, tool.detail)}</code>}
      </div>
      {tool.output.map((out, i) =>
        out.kind === 'diff' ? (
          <details key={i} className="agent-tool__output" open>
            <summary>
              <span className="agent-tool__summary">{relativeTo(cwd, out.path)}</span>
            </summary>
            <DiffView hunks={[{ header: '', lines: diffLinesOf(out) }]} />
          </details>
        ) : (
          <details key={i} className="agent-tool__output">
            <summary>Output</summary>
            <pre>{out.text}</pre>
          </details>
        )
      )}
    </div>
  )
}

function ChangesCard({ turn, cwd }: { turn: Turn; cwd: string }): React.JSX.Element {
  return (
    <div role="group" aria-label="Changed in this turn" className="agent-changes">
      <strong>Changed in this turn</strong>
      <ul>
        {turn.changes.map((file) => (
          <li key={file.path} className="agent-changes__file">
            <span className="agent-changes__path">{relativeTo(cwd, file.path)}</span>
            <span className="agent-changes__added">{`+${file.added}`}</span>
            <span className="agent-changes__removed">{`−${file.removed}`}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function PlanList({ plan }: { plan: NonNullable<Transcript['plan']> }): React.JSX.Element {
  return (
    <ul className="agent-plan" aria-label="Plan">
      {plan.map((item, i) => (
        <li key={i} className={`agent-plan__item agent-plan__item--${item.status}`}>
          {item.content}
        </li>
      ))}
    </ul>
  )
}

function TurnView(props: {
  turn: Turn
  cwd: string
  find: FindState
  firstMatch: Map<TranscriptEntry, number>
}): React.JSX.Element {
  const { turn, cwd, find } = props
  return (
    <>
      {turn.entries.map((entry, i) =>
        entry.kind === 'tool' ? (
          <ToolCall key={entry.toolCallId} tool={entry} cwd={cwd} />
        ) : (
          <p key={i} className={`agent-message agent-message--${entry.role}`}>
            <Highlighted
              text={entry.text}
              query={find.query}
              first={props.firstMatch.get(entry) ?? 0}
              current={find.current}
            />
          </p>
        )
      )}
      {turn.changes.length > 0 && <ChangesCard turn={turn} cwd={cwd} />}
    </>
  )
}

function TranscriptLog(props: {
  transcript: Transcript
  cwd: string
  find: FindState
}): React.JSX.Element {
  const { transcript, cwd, find } = props
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => {
    log.current?.querySelector('.agent-find__match--current')?.scrollIntoView?.({ block: 'center' })
  }, [find])
  const firstMatch = firstMatches(transcript.entries, find.query)
  return (
    <div
      ref={log}
      role="log"
      aria-live="polite"
      aria-label="Agent transcript"
      className="agent-view__log"
    >
      {splitTurns(transcript.entries).map((turn, i) => (
        <TurnView key={i} turn={turn} cwd={cwd} find={find} firstMatch={firstMatch} />
      ))}
      {transcript.plan && <PlanList plan={transcript.plan} />}
    </div>
  )
}

/** Cmd or Ctrl plus F, inside the agent tab only. */
function isFindKey(e: React.KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f'
}

/** A citation chip's click: the find bar opens on the quoted passage. */
const showSourceWith =
  (controls: FindControls) =>
  (quote: string): void => {
    controls.open()
    controls.setQuery(quote)
    recordUse('core.agent.cite-source', 'click')
  }

export function AgentView({ sessionId }: { sessionId: string }): React.JSX.Element {
  const { transcript, asks, exited } = useAgentTranscript(sessionId)
  const running = useSessionStore((s) => s.sessions.get(sessionId)?.agentTurn === true)
  const cwd = useSessionStore((s) => s.sessions.get(sessionId)?.cwd ?? '')
  const controls = useFind(transcript)
  useEffect(() => recordUse('core.agent.view', 'shown'), [sessionId])
  const composer = { sessionId, running, disabled: exited, onShowSource: showSourceWith(controls) }
  const answer = (requestId: string, optionId: string): void =>
    void window.electronAPI.agents.answer({ sessionId, requestId, optionId })
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!isFindKey(e)) return
    e.preventDefault()
    controls.open()
  }
  return (
    <section className="agent-view" aria-label="Agent session" onKeyDown={onKeyDown}>
      {controls.find && <FindBar find={controls.find} controls={controls} />}
      {asks.map((ask) => (
        <AskBand key={ask.requestId} ask={ask} onAnswer={(id) => answer(ask.requestId, id)} />
      ))}
      {transcript.usage && (
        <div className="agent-view__usage">{contextLabel(transcript.usage)}</div>
      )}
      <TranscriptLog transcript={transcript} cwd={cwd} find={controls.find ?? noFind} />
      {exited && <p className="agent-view__exited">The agent exited.</p>}
      <Composer {...composer} />
    </section>
  )
}
