import React, { useEffect, useRef } from 'react'
import {
  Brain,
  FileText,
  FolderInput,
  Globe,
  Pencil,
  Search,
  SquareTerminal,
  ToggleLeft,
  Trash2,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Button, Chip, DiffView, ToolCard } from '@terminator/extension-ui'
import { plural } from '@terminator/extension-sdk/plain'
import type { AgentPermissionAsk } from '@terminator/extension-sdk'
import { useSessionStore } from '../../stores/session.store'
import {
  diffLinesOf,
  inputSummary,
  relativeTo,
  splitTurns,
  toolLabel,
  toolStatus,
  type TranscriptEntry,
  type Turn,
  type ToolEntry,
  type Transcript,
} from './fold-updates'
import { CitationChip, Composer, SessionChip } from './Composer'
import { CiteLayer } from './cite'
import { splitAttachedContext } from './attached-context'
import {
  FindBar,
  Highlighted,
  firstMatches,
  noFind,
  shownText,
  useFind,
  type FindControls,
  type FindState,
} from './find'
import { useAgentTranscript } from './use-agent-transcript'
import { AgentMarkdown } from './AgentMarkdown'
import { recordUse } from '../../usage/record'
import './AgentView.css'

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

type DiffEntry = Extract<ToolEntry['output'][number], { kind: 'diff' }>

/** One file's change, open, named by its path for assistive tech as the summary shows it. */
function DiffOutput({ diff, cwd }: { diff: DiffEntry; cwd: string }): React.JSX.Element {
  const path = relativeTo(cwd, diff.path)
  return (
    <details className="agent-diff" aria-label={path} open>
      <summary>
        <span className="agent-diff__path">{path}</span>
      </summary>
      <DiffView hunks={[{ header: '', lines: diffLinesOf(diff) }]} />
    </details>
  )
}

const KIND_ICON: Record<string, LucideIcon> = {
  execute: SquareTerminal,
  search: Search,
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: FolderInput,
  fetch: Globe,
  think: Brain,
  switch_mode: ToggleLeft,
}

/** Several one-line outputs, such as the tools a search found, read best as items. */
function OutputItems({ texts }: { texts: string[] }): React.JSX.Element {
  return (
    <ul className="agent-tool-items" aria-label="Output">
      {texts.map((text, i) => (
        <li key={i}>
          <Chip>{text}</Chip>
        </li>
      ))}
    </ul>
  )
}

/** A tool's text as a folding preview, or as items, and its diffs open under it. */
function toolOutput(tool: ToolEntry, cwd: string) {
  const texts = tool.output.flatMap((out) => (out.kind === 'text' ? [out.text] : []))
  const diffs = tool.output.filter((out) => out.kind === 'diff')
  const asItems = texts.length > 1 && texts.every((text) => !text.trim().includes('\n'))
  const preview = texts.length > 0 && !asItems ? texts.join('\n') : undefined
  if (!asItems && diffs.length === 0) return { preview }
  const children = (
    <>
      {asItems && <OutputItems texts={texts} />}
      {diffs.map((diff, i) => (
        <DiffOutput key={i} diff={diff} cwd={cwd} />
      ))}
    </>
  )
  return { preview, children }
}

function RailStep(props: { node?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="agent-rail__step">
      <span
        className={`agent-rail__node${props.node ? '' : ' agent-rail__node--dot'}`}
        aria-hidden="true"
      >
        {props.node}
      </span>
      {props.children}
    </div>
  )
}

function ToolStep({ tool, cwd }: { tool: ToolEntry; cwd: string }): React.JSX.Element {
  const Icon = KIND_ICON[tool.toolKind ?? ''] ?? Wrench
  const { title, detail } = toolLabel(tool, cwd)
  return (
    <RailStep node={<Icon />}>
      <ToolCard
        title={title}
        detail={detail}
        status={toolStatus(tool.status)}
        {...toolOutput(tool, cwd)}
      />
    </RailStep>
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

type MessageEntry = Extract<TranscriptEntry, { kind: 'message' }>

interface TranscriptMarks {
  find: FindState
  firstMatch: Map<TranscriptEntry, number>
  /** Each entry's index in the whole transcript, which a citation names. */
  entryIndex: Map<TranscriptEntry, number>
  onShowSource: (quote: string) => void
}

/** What a sent message carried besides its text, as read-only chips. */
function SentContext({ message, marks }: { message: MessageEntry; marks: TranscriptMarks }) {
  const { attached } = splitAttachedContext(message.text)
  if (attached.sessions.length + attached.citations.length === 0) return null
  return (
    <ul className="agent-message-context" aria-label="Sent with this message">
      {attached.sessions.map((context) => (
        <SessionChip key={context.sessionId} context={context} />
      ))}
      {attached.citations.map((citation, i) => (
        <CitationChip key={i} citation={citation} onShowSource={marks.onShowSource} />
      ))}
    </ul>
  )
}

function Message({ entry, marks }: { entry: MessageEntry; marks: TranscriptMarks }) {
  const text = shownText(entry)
  const className = `agent-message agent-message--${entry.role}`
  const entryIndex = entry.role === 'agent' ? marks.entryIndex.get(entry) : undefined
  if (text && entry.role !== 'user' && !marks.find.query)
    return (
      <div className={className} data-entry-index={entryIndex}>
        <AgentMarkdown text={text} />
      </div>
    )
  // While finding, the plain text shows so every match can be marked.
  const bubble = text && (
    <p className={className} data-entry-index={entryIndex}>
      <Highlighted
        text={text}
        query={marks.find.query}
        first={marks.firstMatch.get(entry) ?? 0}
        current={marks.find.current}
      />
    </p>
  )
  if (entry.role !== 'user') return bubble
  return (
    <>
      {bubble}
      <SentContext message={entry} marks={marks} />
    </>
  )
}

/** "Turn 2 · 3 tool calls": where a turn starts, and how much it did. */
function TurnDivider({ turn, number }: { turn: Turn; number: number }): React.JSX.Element {
  const toolCalls = turn.entries.filter((entry) => entry.kind === 'tool').length
  const count = toolCalls > 0 ? ` · ${toolCalls} ${plural(toolCalls, 'tool call')}` : ''
  return <p className="agent-turn__divider">{`Turn ${number}${count}`}</p>
}

const isPrompt = (entry: TranscriptEntry | undefined): entry is MessageEntry =>
  entry?.kind === 'message' && entry.role === 'user'

/** Everything the agent did in a turn, one step per node on the rail. */
function TurnRail(props: {
  turn: Turn
  steps: TranscriptEntry[]
  cwd: string
  marks: TranscriptMarks
}) {
  const { turn, cwd } = props
  if (props.steps.length === 0 && turn.changes.length === 0) return null
  return (
    <div className="agent-rail">
      {props.steps.map((entry, i) =>
        entry.kind === 'tool' ? (
          <ToolStep key={entry.toolCallId} tool={entry} cwd={cwd} />
        ) : (
          <RailStep key={i}>
            <Message entry={entry} marks={props.marks} />
          </RailStep>
        )
      )}
      {turn.changes.length > 0 && (
        <RailStep>
          <ChangesCard turn={turn} cwd={cwd} />
        </RailStep>
      )}
    </div>
  )
}

/** A turn opens with its divider and the sent prompt; entries before any prompt have neither. */
function TurnView(props: { turn: Turn; number: number; cwd: string; marks: TranscriptMarks }) {
  const { turn } = props
  const [first, ...rest] = turn.entries
  const prompt = isPrompt(first) ? first : null
  return (
    <div className="agent-turn">
      {prompt && <TurnDivider turn={turn} number={props.number} />}
      {prompt && <Message entry={prompt} marks={props.marks} />}
      <TurnRail
        turn={turn}
        steps={prompt ? rest : turn.entries}
        cwd={props.cwd}
        marks={props.marks}
      />
    </div>
  )
}

/** The plan is the agent's, not one turn's, so it closes the log as a step of its own. */
function PlanStep({ plan }: { plan: NonNullable<Transcript['plan']> }): React.JSX.Element {
  return (
    <div className="agent-rail">
      <RailStep>
        <PlanList plan={plan} />
      </RailStep>
    </div>
  )
}

function useScrollToCurrentMatch(log: React.RefObject<HTMLDivElement | null>, find: FindState) {
  useEffect(() => {
    log.current?.querySelector('.agent-find__match--current')?.scrollIntoView?.({ block: 'center' })
  }, [log, find])
}

function TranscriptLog(props: {
  transcript: Transcript
  cwd: string
  marks: Omit<TranscriptMarks, 'firstMatch' | 'entryIndex'>
  log: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element {
  const { transcript, cwd, log } = props
  useScrollToCurrentMatch(log, props.marks.find)
  const marks = {
    ...props.marks,
    firstMatch: firstMatches(transcript.entries, props.marks.find.query),
    entryIndex: new Map(transcript.entries.map((entry, i) => [entry, i])),
  }
  // Entries before the first prompt are not a turn, so numbering starts after them.
  const firstNumber = isPrompt(transcript.entries[0]) ? 1 : 0
  return (
    <div
      ref={log}
      role="log"
      aria-live="polite"
      aria-label="Agent transcript"
      className="agent-view__log"
    >
      {splitTurns(transcript.entries).map((turn, i) => (
        <TurnView key={i} turn={turn} number={i + firstNumber} cwd={cwd} marks={marks} />
      ))}
      {transcript.plan && <PlanStep plan={transcript.plan} />}
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

const openFindOnKey =
  (controls: FindControls) =>
  (e: React.KeyboardEvent): void => {
    if (!isFindKey(e)) return
    e.preventDefault()
    controls.open()
  }

export function AgentView({ sessionId }: { sessionId: string }): React.JSX.Element {
  const { transcript, asks, exited } = useAgentTranscript(sessionId)
  const running = useSessionStore((s) => s.sessions.get(sessionId)?.agentTurn === true)
  const cwd = useSessionStore((s) => s.sessions.get(sessionId)?.cwd ?? '')
  const controls = useFind(transcript)
  useEffect(() => recordUse('core.agent.view', 'shown'), [sessionId])
  const log = useRef<HTMLDivElement>(null)
  const onShowSource = showSourceWith(controls)
  const marks = { find: controls.find ?? noFind, onShowSource }
  const composer = { sessionId, running, disabled: exited, onShowSource }
  const answer = (requestId: string, optionId: string): void =>
    void window.electronAPI.agents.answer({ sessionId, requestId, optionId })
  return (
    <section className="agent-view" aria-label="Agent session" onKeyDown={openFindOnKey(controls)}>
      {controls.find && <FindBar find={controls.find} controls={controls} />}
      {asks.map((ask) => (
        <AskBand key={ask.requestId} ask={ask} onAnswer={(id) => answer(ask.requestId, id)} />
      ))}
      <TranscriptLog {...{ transcript, cwd, log, marks }} />
      <CiteLayer log={log} tabId={sessionId} />
      {exited && <p className="agent-view__exited">The agent exited.</p>}
      <Composer {...composer} usage={transcript.usage ?? undefined} />
    </section>
  )
}
