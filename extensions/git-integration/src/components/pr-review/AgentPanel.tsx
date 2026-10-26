import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { Button, IconButton, SegmentedControl } from '@terminator/extension-ui'
import { useShallow } from 'zustand/react/shallow'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { reviewAgentAPI } from '../../api/review-agent'
import type { PrReviewDetail } from '../../schemas/pr-review.schema'
import type { AgentFinding, AgentRun, AgentScope } from '../../schemas/review-agent.schema'
import { RichContent } from './RichContent'
import { choose } from '../text'
import './agent-panel.css'

type AgentRequestKind = 'review' | 'explain' | 'ask'

const SEV_LABEL: Record<AgentFinding['severity'], string> = {
  'must-fix': 'must-fix',
  suggestion: 'suggestion',
  nit: 'nit',
  question: 'question',
}

const SEV_CLASS: Record<AgentFinding['severity'], string> = {
  'must-fix': 'ap-must',
  suggestion: 'ap-sug',
  nit: 'ap-nit',
  question: 'ap-q',
}

function fileName(path: string | null): string {
  if (!path) return ''
  const parts = path.split('/')
  return parts[parts.length - 1]
}

type ScopeKind = AgentScope['kind']

const SCOPE_LABEL: Record<ScopeKind, (scope: AgentScope) => string> = {
  lines: (scope) => `lines ${scope.startLine}–${scope.endLine}`,
  hunk: (scope) => `this hunk (lines ${scope.startLine}–${scope.endLine})`,
  file: (scope) => fileName(scope.path),
  chapter: (scope) => `chapter ${scope.chapter}`,
  pr: () => 'this PR',
}

function scopeLabel(scope: AgentScope): string {
  return SCOPE_LABEL[scope.kind]?.(scope) ?? ''
}

const SCOPE_DESCRIPTION: Record<ScopeKind, string> = {
  lines: 'selection',
  hunk: 'hunk',
  file: 'file',
  chapter: 'chapter',
  pr: 'whole PR',
}

function scopeDescription(scope: AgentScope): string {
  return SCOPE_DESCRIPTION[scope.kind] ?? ''
}

const SCOPE_FIELDS = ['kind', 'path', 'startLine', 'endLine', 'side', 'chapter'] as const

function scopesEqual(a: AgentScope, b: AgentScope): boolean {
  return SCOPE_FIELDS.every((field) => a[field] === b[field])
}

interface Props {
  repoRoot: string
  pr: PrReviewDetail
  /** The file open in the diff, which the ask form can narrow a run to. */
  currentFilePath: string | null
}

type Phase = 'ask' | 'running' | 'findings' | 'failed'

const RUN_PHASE: Record<AgentRun['status'], Phase> = {
  running: 'running',
  done: 'findings',
  failed: 'failed',
  cancelled: 'failed',
}

/** What the panel shows: the ask form when forced or there is no run, else the run's state. */
function phaseOf(forceAsk: boolean, run: AgentRun | undefined): Phase {
  if (forceAsk || !run) return 'ask'
  return RUN_PHASE[run.status] ?? 'ask'
}

const REQUEST_OPTIONS = [
  { value: 'review', label: 'Review' },
  { value: 'explain', label: 'Explain' },
  { value: 'ask', label: 'Ask…' },
] as const

const MODEL_OPTIONS = [
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
] as const

/** Activity lines plus the seconds since the run started, ticking once a second. */
function RunningNote({ activity, startedAt }: { activity: string[]; startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000))
  return (
    <p className="ap-note" style={{ margin: 0 }} key={now}>
      {[...activity, `${elapsedSeconds} s`].join(' · ')}
    </p>
  )
}

function usePanelStore() {
  return useReviewUiStore(
    useShallow((s) => ({
      agentPanelScope: s.agentPanelScope,
      agentPanelRequest: s.agentPanelRequest,
      agentPanelAutoStart: s.agentPanelAutoStart,
      agentRuns: s.agentRuns,
      openAgentPanel: s.openAgentPanel,
      upsertAgentRun: s.upsertAgentRun,
      requestComposer: s.requestComposer,
    }))
  )
}

type PanelStore = ReturnType<typeof usePanelStore>

/** The run model from the agent's settings; the control keeps its value when they cannot be read. */
function useDefaultModel(setModel: (m: 'sonnet' | 'opus') => void) {
  useEffect(() => {
    reviewAgentAPI
      .settings()
      .then((res) => {
        const m = (res as { model?: string } | undefined)?.model
        if (m === 'opus' || m === 'sonnet') setModel(m)
      })
      .catch(() => {
        // Settings are a convenience default; the seg keeps its current value.
      })
  }, [setModel])
}

/** The form's state, reset whenever the panel is pointed at another scope or request. */
function useAskForm(store: PanelStore) {
  const { agentPanelRequest } = store
  const [request, setRequest] = useState<AgentRequestKind>(agentPanelRequest)
  const [question, setQuestion] = useState('')
  const [model, setModel] = useState<'sonnet' | 'opus'>('sonnet')
  const [forceAsk, setForceAsk] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const panelTarget = `${scopeKeyOf(store.agentPanelScope)}\u0000${agentPanelRequest}`
  const [shownPanelTarget, setShownPanelTarget] = useState(panelTarget)
  if (shownPanelTarget !== panelTarget) {
    setShownPanelTarget(panelTarget)
    setRequest(agentPanelRequest)
    setForceAsk(false)
    setQuestion('')
    setDismissedIds(new Set())
  }
  useDefaultModel(setModel)
  return {
    request,
    setRequest,
    question,
    setQuestion,
    model,
    setModel,
    forceAsk,
    setForceAsk,
    dismissedIds,
    setDismissedIds,
  }
}

type AskForm = ReturnType<typeof useAskForm>

function scopeKeyOf(scope: AgentScope | null): string | null {
  if (!scope) return null
  return JSON.stringify(scope)
}

/** Starts a run for the panel's scope; a run started is stored and the form steps aside. */
function useStartRun(props: Props, store: PanelStore, form: AskForm) {
  const { repoRoot, pr } = props
  const { agentPanelScope, upsertAgentRun } = store
  const { question, model, setForceAsk } = form
  return useCallback(
    async (req: AgentRequestKind) => {
      if (!agentPanelScope) return
      const result = await reviewAgentAPI.start({
        repoRoot,
        prNumber: pr.number,
        headSHA: pr.headSHA,
        baseRefName: pr.baseRefName,
        title: pr.title,
        body: pr.body,
        scope: agentPanelScope,
        request: req,
        question: choose(req === 'ask', question, null),
        model,
      })
      const run = (result as { run?: AgentRun } | undefined)?.run
      if (!run) return
      upsertAgentRun(run)
      setForceAsk(false)
    },
    [agentPanelScope, repoRoot, pr, question, model, upsertAgentRun, setForceAsk]
  )
}

/** Starts the requested run once per scope when the panel was opened to run straight away. */
function useAutoStart(store: PanelStore, handleStart: (req: AgentRequestKind) => Promise<void>) {
  const autoStartedFor = useRef<string | null>(null)
  const { agentPanelAutoStart, agentPanelScope, agentPanelRequest } = store
  const scopeKey = scopeKeyOf(agentPanelScope)
  useEffect(() => {
    if (agentPanelAutoStart && agentPanelScope && autoStartedFor.current !== scopeKey) {
      autoStartedFor.current = scopeKey
      void handleStart(agentPanelRequest)
    }
  }, [agentPanelAutoStart, agentPanelScope, agentPanelRequest, scopeKey, handleStart])
}

function useCurrentRun(props: Props, store: PanelStore): AgentRun | undefined {
  const { agentRuns, agentPanelScope } = store
  const { repoRoot } = props
  const prNumber = props.pr.number
  return useMemo(() => {
    if (!agentPanelScope) return undefined
    return agentRuns.find(
      (r) =>
        r.repoRoot === repoRoot && r.prNumber === prNumber && scopesEqual(r.scope, agentPanelScope)
    )
  }, [agentRuns, agentPanelScope, repoRoot, prNumber])
}

interface FindingContext {
  props: Props
  store: PanelStore
  form: AskForm
  run: AgentRun
}

/** Hides the finding at once, then records the dismissal with the run. */
function dismissFindingInPanel(ctx: FindingContext, finding: AgentFinding): void {
  const { props, run } = ctx
  ctx.form.setDismissedIds((prev) => new Set(prev).add(finding.id))
  const markDismissed = (f: AgentFinding) =>
    choose(f.id === finding.id, { ...f, dismissed: true }, f)
  reviewAgentAPI
    .dismiss({
      repoRoot: props.repoRoot,
      prNumber: props.pr.number,
      headSHA: props.pr.headSHA,
      runId: run.id,
      findingId: finding.id,
    })
    .then(() => ctx.store.upsertAgentRun({ ...run, findings: run.findings.map(markDismissed) }))
    .catch(() => {
      // Best-effort: the finding stays hidden locally even if the write fails.
    })
}

/** Opens the comment composer on the finding's lines, pre-filled with it. */
function postAsComment(store: PanelStore, finding: AgentFinding): void {
  store.requestComposer({
    path: finding.path,
    side: finding.side,
    line: finding.endLine,
    startLine: choose(finding.startLine !== finding.endLine, finding.startLine, null),
    body: `${finding.title}\n\n${finding.body}`,
    fromFindingId: finding.id,
  })
}

const SCOPE_CHOICES = [
  { value: 'file', label: 'This file' },
  { value: 'pr', label: 'Whole PR' },
] as const

/** Switches a PR or file scope between the open file and the whole PR; a selection has no choice. */
function ScopeChoice(props: { scope: AgentScope; currentFilePath: string | null; form: AskForm }) {
  const { scope, currentFilePath, form } = props
  const openAgentPanel = useReviewUiStore((s) => s.openAgentPanel)
  if ((scope.kind !== 'pr' && scope.kind !== 'file') || !currentFilePath) return null
  const selectScope = (kind: 'file' | 'pr') =>
    openAgentPanel({ ...scope, kind, path: kind === 'file' ? currentFilePath : null }, form.request)
  return (
    <SegmentedControl
      label="Scope"
      size="sm"
      options={[...SCOPE_CHOICES]}
      value={scope.kind}
      onChange={selectScope}
    />
  )
}

interface AskPhaseProps {
  scope: AgentScope
  currentFilePath: string | null
  form: AskForm
  onRun: () => void
}

function AskPhase(props: AskPhaseProps) {
  const { form } = props
  return (
    <div>
      <h5>Ask about {scopeLabel(props.scope)}</h5>
      <p className="ap-note" style={{ margin: '6px 0' }}>
        Scope: {scopeDescription(props.scope)} · reads the PR head in a private worktree
      </p>
      <ScopeChoice scope={props.scope} currentFilePath={props.currentFilePath} form={form} />
      <SegmentedControl
        label="Request"
        size="sm"
        options={[...REQUEST_OPTIONS]}
        value={form.request}
        onChange={form.setRequest}
      />
      {form.request === 'ask' && (
        <textarea
          className="ap-question"
          placeholder="Ask a question about this scope…"
          value={form.question}
          onChange={(e) => form.setQuestion(e.target.value)}
        />
      )}
      <ModelRow form={form} onRun={props.onRun} />
    </div>
  )
}

function ModelRow({ form, onRun }: { form: AskForm; onRun: () => void }) {
  return (
    <div className="ap-model-row">
      <span className="ap-note">Model</span>
      <SegmentedControl
        label="Model"
        size="sm"
        options={[...MODEL_OPTIONS]}
        value={form.model}
        onChange={form.setModel}
      />
      <span className="ap-sp" />
      <Button variant="primary" size="sm" onClick={onRun}>
        Run
      </Button>
    </div>
  )
}

function RunningPhase({ run, label }: { run: AgentRun; label: string }) {
  return (
    <div>
      <h5>
        <span className="ap-spin-wrap" aria-hidden="true">
          <Loader2 />
        </span>
        {choose(run.request === 'explain', 'Explaining ', 'Reviewing ')}
        {label}
      </h5>
      <RunningNote key={run.id} activity={run.activity} startedAt={run.startedAt} />
      <div className="ap-actions-row">
        <Button size="sm" onClick={() => void reviewAgentAPI.cancel(run.id)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function SeverityTag({ severity }: { severity: AgentFinding['severity'] }) {
  return <span className={`ap-sev ${SEV_CLASS[severity]}`}>{SEV_LABEL[severity]}</span>
}

function FindingCard({ ctx, finding }: { ctx: FindingContext; finding: AgentFinding }) {
  return (
    <div className="ap-fnd">
      <div>
        <SeverityTag severity={finding.severity} /> <b>{finding.title}</b>
      </div>
      <div className="ap-note">
        {fileName(finding.path)}:{finding.startLine}
      </div>
      <div className="ap-fnd-body">
        <RichContent>{finding.body}</RichContent>
      </div>
      <div className="ap-acts">
        <Button size="sm" onClick={() => postAsComment(ctx.store, finding)}>
          Post as comment
        </Button>
        <Button size="sm" onClick={() => dismissFindingInPanel(ctx, finding)}>
          Dismiss
        </Button>
        <Button size="sm" onClick={() => void reviewAgentAPI.openTerminal(ctx.run.id)}>
          Ask follow-up
        </Button>
      </div>
    </div>
  )
}

function findingsHeading(run: AgentRun, shownCount: number, label: string): string {
  if (run.request === 'explain') return `Explanation · ${label}`
  return `${shownCount} findings · ${label}`
}

function Walkthrough({ run }: { run: AgentRun }) {
  if (run.walkthrough.length === 0) return null
  return (
    <div className="ap-walkthrough">
      {run.walkthrough.map((w) => (
        <p key={w.chapter} className="ap-note">
          <b>{w.chapter}</b> {w.text}
        </p>
      ))}
    </div>
  )
}

function FindingsPhase({ ctx, label }: { ctx: FindingContext; label: string }) {
  const { run, form } = ctx
  const shown = run.findings.filter((f) => !f.dismissed && !form.dismissedIds.has(f.id))
  return (
    <div>
      <h5>{findingsHeading(run, shown.length, label)}</h5>
      {run.summary && <RichContent>{run.summary}</RichContent>}
      {ctx.store.agentPanelScope?.kind === 'pr' && <Walkthrough run={run} />}
      {shown.map((finding) => (
        <FindingCard key={finding.id} ctx={ctx} finding={finding} />
      ))}
      <p className="ap-note" style={{ margin: 0 }}>
        Private to you. Saved with this PR; marked stale if the lines change.
      </p>
      <Button size="sm" onClick={() => form.setForceAsk(true)}>
        Ask again
      </Button>
    </div>
  )
}

function FailedPhase({ run, onRetry }: { run: AgentRun; onRetry: () => void }) {
  return (
    <div>
      <p className="ap-note ap-error">{run.error ?? 'The agent could not finish.'}</p>
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

interface PhaseViewProps {
  phase: Phase
  scope: AgentScope
  currentFilePath: string | null
  form: AskForm
  ctx: FindingContext | null
  onRun: () => void
}

function PhaseView(props: PhaseViewProps) {
  const { phase, scope, form, ctx } = props
  const label = scopeLabel(scope)
  if (phase === 'ask') return <AskPhase {...props} />
  if (!ctx) return null
  if (phase === 'running') return <RunningPhase run={ctx.run} label={label} />
  if (phase === 'findings') return <FindingsPhase ctx={ctx} label={label} />
  return <FailedPhase run={ctx.run} onRetry={() => form.setForceAsk(true)} />
}

function PanelHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="ap-header">
      <span className="ap-header-title">Agent</span>
      <IconButton icon={X} size="sm" label="Close agent panel" onClick={onClose} />
    </div>
  )
}

export function AgentPanel(props: Props) {
  const store = usePanelStore()
  const form = useAskForm(store)
  const handleStart = useStartRun(props, store, form)
  useAutoStart(store, handleStart)
  const run = useCurrentRun(props, store)
  const scope = store.agentPanelScope
  if (!scope) return null
  const ctx = choose(run, { props, store, form, run: run as AgentRun }, null)
  return (
    <aside className="ap-panel" aria-label="Agent panel">
      <PanelHeader onClose={() => store.openAgentPanel(null)} />
      <PhaseView
        phase={phaseOf(form.forceAsk, run)}
        scope={scope}
        currentFilePath={props.currentFilePath}
        form={form}
        ctx={ctx}
        onRun={() => void handleStart(form.request)}
      />
    </aside>
  )
}
