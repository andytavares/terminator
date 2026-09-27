import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useReviewUiStore } from '../../stores/review-ui.store'
import { reviewAgentAPI } from '../../api/review-agent'
import type { PrReviewDetail } from '../../schemas/pr-review.schema'
import type { AgentFinding, AgentRun, AgentScope } from '../../schemas/review-agent.schema'
import { RichContent } from './RichContent'
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

function scopeLabel(scope: AgentScope): string {
  switch (scope.kind) {
    case 'lines':
      return `lines ${scope.startLine}–${scope.endLine}`
    case 'hunk':
      return `this hunk (lines ${scope.startLine}–${scope.endLine})`
    case 'file':
      return fileName(scope.path)
    case 'chapter':
      return `chapter ${scope.chapter}`
    case 'pr':
      return 'this PR'
    default:
      return ''
  }
}

function scopeDescription(scope: AgentScope): string {
  switch (scope.kind) {
    case 'lines':
      return 'selection'
    case 'hunk':
      return 'hunk'
    case 'file':
      return 'file'
    case 'chapter':
      return 'chapter'
    case 'pr':
      return 'whole PR'
    default:
      return ''
  }
}

function scopesEqual(a: AgentScope, b: AgentScope): boolean {
  return (
    a.kind === b.kind &&
    a.path === b.path &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.side === b.side &&
    a.chapter === b.chapter
  )
}

interface Props {
  repoRoot: string
  pr: PrReviewDetail
}

export function AgentPanel({ repoRoot, pr }: Props) {
  const agentPanelScope = useReviewUiStore((s) => s.agentPanelScope)
  const agentPanelRequest = useReviewUiStore((s) => s.agentPanelRequest)
  const agentPanelAutoStart = useReviewUiStore((s) => s.agentPanelAutoStart)
  const agentRuns = useReviewUiStore((s) => s.agentRuns)
  const openAgentPanel = useReviewUiStore((s) => s.openAgentPanel)
  const upsertAgentRun = useReviewUiStore((s) => s.upsertAgentRun)
  const requestComposer = useReviewUiStore((s) => s.requestComposer)

  const scopeKey = agentPanelScope ? JSON.stringify(agentPanelScope) : null

  const [request, setRequest] = useState<AgentRequestKind>(agentPanelRequest)
  const [question, setQuestion] = useState('')
  const [model, setModel] = useState<'sonnet' | 'opus'>('sonnet')
  const [forceAsk, setForceAsk] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [elapsedTick, setElapsedTick] = useState(0)

  const autoStartedFor = useRef<string | null>(null)

  useEffect(() => {
    setRequest(agentPanelRequest)
    setForceAsk(false)
    setQuestion('')
    setDismissedIds(new Set())
  }, [scopeKey, agentPanelRequest])

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
  }, [])

  const currentRun = useMemo(() => {
    if (!agentPanelScope) return undefined
    return agentRuns.find(
      (r) =>
        r.repoRoot === repoRoot && r.prNumber === pr.number && scopesEqual(r.scope, agentPanelScope)
    )
  }, [agentRuns, agentPanelScope, repoRoot, pr.number])

  useEffect(() => {
    if (currentRun?.status !== 'running') return
    const id = setInterval(() => setElapsedTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [currentRun?.status, currentRun?.id])

  const handleStart = useCallback(
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
        question: req === 'ask' ? question : null,
        model,
      })
      const run = (result as { run?: AgentRun } | undefined)?.run
      if (run) {
        upsertAgentRun(run)
        setForceAsk(false)
      }
    },
    [
      agentPanelScope,
      repoRoot,
      pr.number,
      pr.headSHA,
      pr.baseRefName,
      pr.title,
      pr.body,
      question,
      model,
      upsertAgentRun,
    ]
  )

  useEffect(() => {
    if (agentPanelAutoStart && agentPanelScope && autoStartedFor.current !== scopeKey) {
      autoStartedFor.current = scopeKey
      void handleStart(agentPanelRequest)
    }
  }, [agentPanelAutoStart, agentPanelScope, agentPanelRequest, scopeKey, handleStart])

  if (!agentPanelScope) return null

  const label = scopeLabel(agentPanelScope)

  const phase: 'ask' | 'running' | 'findings' | 'failed' = forceAsk
    ? 'ask'
    : currentRun?.status === 'running'
      ? 'running'
      : currentRun?.status === 'done'
        ? 'findings'
        : currentRun?.status === 'failed' || currentRun?.status === 'cancelled'
          ? 'failed'
          : 'ask'

  const close = () => openAgentPanel(null)

  const handleDismiss = (finding: AgentFinding) => {
    if (!currentRun) return
    setDismissedIds((prev) => new Set(prev).add(finding.id))
    reviewAgentAPI
      .dismiss({
        repoRoot,
        prNumber: pr.number,
        headSHA: pr.headSHA,
        runId: currentRun.id,
        findingId: finding.id,
      })
      .then(() => {
        upsertAgentRun({
          ...currentRun,
          findings: currentRun.findings.map((f) =>
            f.id === finding.id ? { ...f, dismissed: true } : f
          ),
        })
      })
      .catch(() => {
        // Best-effort: the finding stays hidden locally even if the write fails.
      })
  }

  const handlePostAsComment = (finding: AgentFinding) => {
    requestComposer({
      path: finding.path,
      side: finding.side,
      line: finding.endLine,
      startLine: finding.startLine !== finding.endLine ? finding.startLine : null,
      body: `${finding.title}\n\n${finding.body}`,
      fromFindingId: finding.id,
    })
  }

  return (
    <aside className="ap-panel" aria-label="Agent panel">
      <div className="ap-header">
        <span className="ap-header-title">Agent</span>
        <button type="button" className="ap-close" aria-label="Close agent panel" onClick={close}>
          <X />
        </button>
      </div>

      {phase === 'ask' && (
        <div>
          <h5>Ask about {label}</h5>
          <p className="ap-note" style={{ margin: '6px 0' }}>
            Scope: {scopeDescription(agentPanelScope)} · reads the PR head in a private worktree
          </p>
          <div className="ap-seg" role="group" aria-label="Request">
            <button
              type="button"
              aria-pressed={request === 'review'}
              onClick={() => setRequest('review')}
            >
              Review
            </button>
            <button
              type="button"
              aria-pressed={request === 'explain'}
              onClick={() => setRequest('explain')}
            >
              Explain
            </button>
            <button
              type="button"
              aria-pressed={request === 'ask'}
              onClick={() => setRequest('ask')}
            >
              Ask…
            </button>
          </div>
          {request === 'ask' && (
            <textarea
              className="ap-question"
              placeholder="Ask a question about this scope…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          )}
          <div className="ap-model-row">
            <span className="ap-note">Model</span>
            <div className="ap-seg" role="group" aria-label="Model">
              <button
                type="button"
                aria-pressed={model === 'sonnet'}
                onClick={() => setModel('sonnet')}
              >
                Sonnet
              </button>
              <button
                type="button"
                aria-pressed={model === 'opus'}
                onClick={() => setModel('opus')}
              >
                Opus
              </button>
            </div>
            <span className="ap-sp" />
            <button
              type="button"
              className="ap-btn ap-ag"
              onClick={() => void handleStart(request)}
            >
              Run
            </button>
          </div>
        </div>
      )}

      {phase === 'running' && currentRun && (
        <div>
          <h5>
            <span className="ap-spin-wrap" aria-hidden="true">
              <Loader2 />
            </span>
            {currentRun.request === 'explain' ? 'Explaining ' : 'Reviewing '}
            {label}
          </h5>
          <p className="ap-note" style={{ margin: 0 }} key={elapsedTick}>
            {[
              ...currentRun.activity,
              `${Math.max(
                0,
                Math.floor((Date.now() - Date.parse(currentRun.startedAt)) / 1000)
              )} s`,
            ].join(' · ')}
          </p>
          <div className="ap-actions-row">
            <button
              type="button"
              className="ap-btn"
              onClick={() => void reviewAgentAPI.cancel(currentRun.id)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="ap-btn"
              onClick={() => void reviewAgentAPI.openTerminal(currentRun.id)}
            >
              Continue in terminal
            </button>
          </div>
        </div>
      )}

      {phase === 'findings' && currentRun && (
        <div>
          <h5>
            {currentRun.request === 'explain'
              ? `Explanation · ${label}`
              : `${currentRun.findings.filter((f) => !f.dismissed && !dismissedIds.has(f.id)).length} findings · ${label}`}
          </h5>
          {currentRun.summary && <RichContent>{currentRun.summary}</RichContent>}
          {agentPanelScope.kind === 'pr' && currentRun.walkthrough.length > 0 && (
            <div className="ap-walkthrough">
              {currentRun.walkthrough.map((w) => (
                <p key={w.chapter} className="ap-note">
                  <b>{w.chapter}</b> {w.text}
                </p>
              ))}
            </div>
          )}
          {currentRun.findings
            .filter((f) => !f.dismissed && !dismissedIds.has(f.id))
            .map((finding) => (
              <div className="ap-fnd" key={finding.id}>
                <div>
                  <span className={`ap-sev ${SEV_CLASS[finding.severity]}`}>
                    {SEV_LABEL[finding.severity]}
                  </span>{' '}
                  <b>{finding.title}</b>
                </div>
                <div className="ap-note">
                  {fileName(finding.path)}:{finding.startLine}
                </div>
                <div className="ap-fnd-body">{finding.body}</div>
                <div className="ap-acts">
                  <button
                    type="button"
                    className="ap-btn"
                    onClick={() => handlePostAsComment(finding)}
                  >
                    Post as comment
                  </button>
                  <button type="button" className="ap-btn" onClick={() => handleDismiss(finding)}>
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="ap-btn"
                    onClick={() => void reviewAgentAPI.openTerminal(currentRun.id)}
                  >
                    Ask follow-up
                  </button>
                </div>
              </div>
            ))}
          <p className="ap-note" style={{ margin: 0 }}>
            Private to you. Saved with this PR; marked stale if the lines change.
          </p>
          <button type="button" className="ap-btn" onClick={() => setForceAsk(true)}>
            Ask again
          </button>
        </div>
      )}

      {phase === 'failed' && currentRun && (
        <div>
          <p className="ap-note ap-error">{currentRun.error ?? 'The agent could not finish.'}</p>
          <button type="button" className="ap-btn" onClick={() => setForceAsk(true)}>
            Try again
          </button>
        </div>
      )}
    </aside>
  )
}
