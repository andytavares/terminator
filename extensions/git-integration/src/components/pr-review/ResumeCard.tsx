import React from 'react'
import { Button, formatRelativeTime } from '@terminator/extension-ui'
import { ArrowRight } from 'lucide-react'
import { useReviewUiStore } from '../../stores/review-ui.store'
import type { PrReviewDetail, ReviewNote, DraftComment } from '../../schemas/pr-review.schema'
import type { AgentRun } from '../../schemas/review-agent.schema'
import { plural } from '../text'

interface Props {
  pr: PrReviewDetail
  lastAccessedAt: string
  viewedCount: number
  totalFiles: number
  currentChapterId: string | null
  currentFilePath: string | null
  lastLine: number | null
  notes: ReviewNote[]
  drafts: DraftComment[]
  agentRuns: AgentRun[]
  changedSinceCount: number
  onContinue: () => void
  /** Opens the drafts not yet submitted, in the submit dialog. */
  onReviewDrafts: () => void
}

const SEVERITY_RANK: Record<string, number> = { 'must-fix': 3, suggestion: 2, question: 1, nit: 0 }

/** "Yesterday 17:42" / "Today 09:10", or how long before, for the resume card (S2). */
function formatResumeTime(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const now = new Date()
  const time = then.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const oneDay = 24 * 60 * 60 * 1000
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()
  const diffDays = Math.round((startOfToday - startOfThen) / oneDay)
  if (diffDays === 0) return `Today ${time}`
  if (diffDays === 1) return `Yesterday ${time}`
  return formatRelativeTime(then, now)
}

type Finding = AgentRun['findings'][number]

/** Findings from finished runs that were not dismissed. */
function unopenedFindingsOf(agentRuns: AgentRun[]): Finding[] {
  return agentRuns
    .filter((r) => r.status === 'done')
    .flatMap((r) => r.findings)
    .filter((f) => !f.dismissed)
}

function highestSeverity(findings: Finding[]): string | null {
  let top: string | null = null
  for (const f of findings) {
    if (!top || SEVERITY_RANK[f.severity] > SEVERITY_RANK[top]) top = f.severity
  }
  return top
}

/** A note holding "??" is one the reviewer meant as a question. */
function questionNoteOf(notes: ReviewNote[]): ReviewNote | undefined {
  return notes.find((n) => n.body.includes('??'))
}

function lineSuffix(lastLine: number | null): string {
  if (lastLine == null) return ''
  return ` line ${lastLine}`
}

function questionSuffix(note: ReviewNote | undefined): string {
  if (!note) return ''
  return `, 1 is a question: "${note.body}"`
}

function ResumeHead({ card: props }: { card: Props }) {
  return (
    <div className="rc-resume-head">
      <b>Where you left off · #{props.pr.number}</b>
      <span className="rc-note">
        {formatResumeTime(props.lastAccessedAt)} · {props.viewedCount} of {props.totalFiles} files
        viewed
      </span>
      <span className="rc-sp" style={{ flex: 1 }} />
      <Button variant="primary" size="sm" onClick={props.onContinue}>
        Continue <kbd className="tmui-kbd">↵</kbd>
      </Button>
    </div>
  )
}

function PositionItem({ card: props }: { card: Props }) {
  const chapterIndex = props.pr.chapters.findIndex((c) => c.id === props.currentChapterId)
  return (
    <li>
      <span>
        <ArrowRight aria-hidden="true" />
      </span>
      <span>
        Chapter {chapterIndex + 1} · <code>{props.currentFilePath}</code>
        {lineSuffix(props.lastLine)}
      </span>
      <span className="rc-note">last position</span>
    </li>
  )
}

/** The agent scope for a note: its line, on the new side. */
function noteScope(note: ReviewNote) {
  return {
    kind: 'lines' as const,
    path: note.path,
    startLine: note.line,
    endLine: note.line,
    side: 'RIGHT' as const,
    chapter: null,
  }
}

function NotesItem({ notes }: { notes: ReviewNote[] }) {
  const openAgentPanel = useReviewUiStore((s) => s.openAgentPanel)
  const questionNote = questionNoteOf(notes)
  const askAgent = (note: ReviewNote) => openAgentPanel(noteScope(note), 'ask')
  return (
    <li>
      <span className="rc-pip">{notes.length}</span>
      <span>
        {notes.length} {plural(notes.length, 'note')}
        {questionSuffix(questionNote)}
      </span>
      {questionNote && (
        <Button size="sm" onClick={() => askAgent(questionNote)}>
          Ask agent
        </Button>
      )}
    </li>
  )
}

function FindingsItem({ findings }: { findings: Finding[] }) {
  return (
    <li>
      <span className="rc-pip rc-ag">{findings.length}</span>
      <span>
        {findings.length} agent {plural(findings.length, 'finding')} you haven&apos;t opened
      </span>
      <span className="rc-note">{highestSeverity(findings)}</span>
    </li>
  )
}

function DraftsItem(props: { count: number; onReviewDrafts: () => void }) {
  return (
    <li>
      <span className="rc-pip">{props.count}</span>
      <span>{props.count} draft comments not yet submitted</span>
      <Button size="sm" onClick={props.onReviewDrafts}>
        Review drafts
      </Button>
    </li>
  )
}

function ChangedSinceItem({ count }: { count: number }) {
  return (
    <li>
      <span style={{ color: 'var(--tm-warning)' }}>●</span>
      <span>1 push since · {count} viewed files changed</span>
      <span className="rc-note">S1</span>
    </li>
  )
}

/** S2: shown over the diff area when a stored session's lastAccessedAt is over 15 minutes old, so
 *  the reviewer sees where they left off before anything else renders. */
export function ResumeCard(props: Props) {
  const findings = unopenedFindingsOf(props.agentRuns)
  const { notes, drafts, changedSinceCount } = props
  return (
    <div className="rc-resume">
      <ResumeHead card={props} />
      <ul>
        {props.currentFilePath && <PositionItem card={props} />}
        {notes.length > 0 && <NotesItem notes={notes} />}
        {findings.length > 0 && <FindingsItem findings={findings} />}
        {drafts.length > 0 && (
          <DraftsItem count={drafts.length} onReviewDrafts={props.onReviewDrafts} />
        )}
        {changedSinceCount > 0 && <ChangedSinceItem count={changedSinceCount} />}
      </ul>
    </div>
  )
}
