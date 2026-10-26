import React, { useState } from 'react'
import { Square } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import type { AgentPermissionAsk } from '@terminator/extension-sdk'
import { useSessionStore } from '../../stores/session.store'
import { inputSummary, type ToolEntry, type Transcript, type Usage } from './fold-updates'
import { useAgentTranscript } from './use-agent-transcript'
import './AgentView.css'

/** Context used as a percentage, and the cost when the agent reports one. */
export function usageLabel({ used, size, cost }: Usage): string {
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

function ToolCall({ tool }: { tool: ToolEntry }): JSX.Element {
  return (
    <div className="agent-tool">
      <div className="agent-tool__head">
        <span className="agent-tool__title">{tool.title}</span>
        {tool.status && <span className="agent-tool__status">{tool.status.replace('_', ' ')}</span>}
        {tool.detail && <code className="agent-tool__detail">{tool.detail}</code>}
      </div>
      {tool.output.map((out, i) => (
        <details key={i} className="agent-tool__output">
          <summary>{out.kind === 'diff' ? `Changes to ${out.path}` : 'Output'}</summary>
          <pre>{out.kind === 'diff' ? `${out.oldText}\n${out.newText}` : out.text}</pre>
        </details>
      ))}
    </div>
  )
}

function PlanList({ plan }: { plan: NonNullable<Transcript['plan']> }): JSX.Element {
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

function TranscriptLog({ transcript }: { transcript: Transcript }): JSX.Element {
  return (
    <div role="log" aria-live="polite" aria-label="Agent transcript" className="agent-view__log">
      {transcript.entries.map((entry, i) =>
        entry.kind === 'tool' ? (
          <ToolCall key={entry.toolCallId} tool={entry} />
        ) : (
          <p key={i} className={`agent-message agent-message--${entry.role}`}>
            {entry.text}
          </p>
        )
      )}
      {transcript.plan && <PlanList plan={transcript.plan} />}
    </div>
  )
}

interface ComposerProps {
  sessionId: string
  disabled: boolean
  running: boolean
}

/** Enter sends; Shift+Enter stays a newline. */
function sendOnEnter(e: React.KeyboardEvent, send: () => void): void {
  if (e.key !== 'Enter' || e.shiftKey) return
  e.preventDefault()
  send()
}

function Composer({ sessionId, disabled, running }: ComposerProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const send = (): void => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    void window.electronAPI.agents.prompt({ sessionId, text })
  }
  return (
    <div className="agent-composer">
      <textarea
        aria-label="Message the agent"
        className="agent-composer__input"
        rows={2}
        value={draft}
        disabled={disabled || running}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => sendOnEnter(e, send)}
      />
      {running && !disabled && (
        <Button icon={Square} onClick={() => void window.electronAPI.agents.cancel({ sessionId })}>
          Stop
        </Button>
      )}
    </div>
  )
}

export function AgentView({ sessionId }: { sessionId: string }): JSX.Element {
  const { transcript, asks, exited } = useAgentTranscript(sessionId)
  const running = useSessionStore((s) => s.sessions.get(sessionId)?.agentTurn === true)
  const answer = (requestId: string, optionId: string): void =>
    void window.electronAPI.agents.answer({ sessionId, requestId, optionId })
  return (
    <section className="agent-view" aria-label="Agent session">
      {asks.map((ask) => (
        <AskBand key={ask.requestId} ask={ask} onAnswer={(id) => answer(ask.requestId, id)} />
      ))}
      {transcript.usage && <div className="agent-view__usage">{usageLabel(transcript.usage)}</div>}
      <TranscriptLog transcript={transcript} />
      {exited && <p className="agent-view__exited">The agent exited.</p>}
      <Composer sessionId={sessionId} disabled={exited} running={running} />
    </section>
  )
}
