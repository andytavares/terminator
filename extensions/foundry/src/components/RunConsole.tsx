import React, { useEffect, useRef, useState } from 'react'
import { X, Check, RotateCcw, ChevronRight, AlertCircle } from 'lucide-react'
import './foundry.css'
import type { Run, FileChange, RunLogEntry, RunLogKind, SensorResult } from '../types/foundry.types'
import { CopilotView } from './CopilotView'
import { OrchestrationView } from './OrchestrationView'
import { DiffViewer } from './DiffViewer'

interface Props {
  repoRoot: string | null
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  running: 'Running',
  gate: 'Awaiting review',
  'paused-error': 'Provider error',
  done: 'Done',
  rejected: 'Rejected',
  aborted: 'Aborted',
}

const STATUS_DOT: Record<string, string> = {
  running: 'fnd-dot--green',
  gate: 'fnd-dot--amber',
  'paused-error': 'fnd-dot--red',
  done: 'fnd-dot--green',
  rejected: 'fnd-dot--red',
  aborted: 'fnd-dot--red',
}

// ─── Log line ─────────────────────────────────────────────────────────────────

function LogKindIcon({ kind }: { kind: RunLogKind }) {
  if (kind === 'ok') return <Check size={10} />
  if (kind === 'error') return <AlertCircle size={10} />
  if (kind === 'agent') return <ChevronRight size={10} />
  return <span style={{ fontSize: 8, lineHeight: 1 }}>●</span>
}

function LogLine({ entry }: { entry: RunLogEntry }) {
  const time = new Date(entry.ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  // Tool call lines (agent kind, starting with →) get a distinct block style
  if (entry.kind === 'agent' && entry.message.startsWith('→ ')) {
    const body = entry.message.slice(2)
    const parenIdx = body.indexOf('(')
    const name = parenIdx >= 0 ? body.slice(0, parenIdx) : body
    const args = parenIdx >= 0 ? body.slice(parenIdx) : ''
    return (
      <div style={{ display: 'flex', gap: 8, padding: '1px 0', alignItems: 'baseline' }}>
        <span className="fnd-log-ts">{time}</span>
        <div className="fnd-tool-call" style={{ flex: 1, margin: 0 }}>
          <span className="fnd-tool-call__arrow">→</span>
          <span className="fnd-tool-call__name">{name}</span>
          {args && <span className="fnd-tool-call__args">{args}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className={`fnd-log-line fnd-log-line--${entry.kind}`}>
      <span className="fnd-log-ts">{time}</span>
      <span
        style={{
          width: 14,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <LogKindIcon kind={entry.kind} />
      </span>
      <span className="fnd-log-msg">{entry.message}</span>
    </div>
  )
}

// ─── Diff viewer ──────────────────────────────────────────────────────────────

// DiffViewer is imported from ./DiffViewer (shared component with syntax highlighting)

// ─── File row ─────────────────────────────────────────────────────────────────

function FileRow({
  fc,
  selected,
  onClick,
}: {
  fc: FileChange
  selected: boolean
  onClick: () => void
}) {
  const badge = fc.status === 'new' ? '+' : fc.status === 'deleted' ? '−' : '~'
  const badgeColor =
    fc.status === 'new'
      ? 'var(--tm-success)'
      : fc.status === 'deleted'
        ? 'var(--tm-danger)'
        : 'var(--tm-warning)'
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 10px',
        cursor: 'pointer',
        background: selected ? 'var(--tm-bg-card)' : 'transparent',
        borderLeft: `2px solid ${selected ? 'var(--tm-accent)' : 'transparent'}`,
        fontSize: 11,
      }}
    >
      <span style={{ color: badgeColor, fontWeight: 700, width: 10, flexShrink: 0 }}>{badge}</span>
      <span
        style={{
          flex: 1,
          color: 'var(--tm-text-primary)',
          fontFamily: 'monospace',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {fc.filePath.split('/').pop()}
      </span>
      <span style={{ color: 'var(--tm-text-muted)', flexShrink: 0 }}>
        {fc.linesAdded > 0 && <span style={{ color: 'var(--tm-success)' }}>+{fc.linesAdded}</span>}
        {fc.linesAdded > 0 && fc.linesRemoved > 0 && ' '}
        {fc.linesRemoved > 0 && (
          <span style={{ color: 'var(--tm-danger)' }}>-{fc.linesRemoved}</span>
        )}
      </span>
    </div>
  )
}

// ─── Sensor result row ────────────────────────────────────────────────────────

function SensorRow({ r }: { r: SensorResult }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetail = !r.pass && (r.stderrExcerpt || r.stdoutExcerpt)
  const detail = [r.stderrExcerpt, r.stdoutExcerpt].filter(Boolean).join('\n').trim()

  return (
    <div style={{ borderTop: '1px solid var(--tm-border)' }}>
      <div
        onClick={() => hasDetail && setExpanded((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 10px',
          fontSize: 11,
          cursor: hasDetail ? 'pointer' : 'default',
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex' }}>
          {r.pass ? <Check size={12} /> : <X size={12} />}
        </span>
        <span style={{ color: 'var(--tm-text-secondary)', flex: 1 }}>{r.sensorName}</span>
        <span style={{ color: 'var(--tm-text-muted)' }}>{r.durationMs}ms</span>
        {hasDetail && (
          <>
            <span
              style={{
                color: 'var(--tm-danger)',
                fontFamily: 'monospace',
                maxWidth: 180,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {detail.split('\n')[0]}
            </span>
            <span style={{ color: 'var(--tm-text-muted)', flexShrink: 0, fontSize: 10 }}>
              {expanded ? '▲' : '▼'}
            </span>
          </>
        )}
      </div>
      {expanded && hasDetail && (
        <pre
          style={{
            margin: 0,
            padding: '6px 10px 6px 28px',
            fontSize: 10,
            fontFamily: 'monospace',
            color: 'var(--tm-danger)',
            background: 'var(--tm-bg-subtle)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            borderTop: '1px solid var(--tm-border)',
          }}
        >
          {detail}
        </pre>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RunConsole({ repoRoot }: Props) {
  const params = new URLSearchParams(window.location.search)
  const runId = params.get('runId') ?? ''
  const workspaceRoot = repoRoot ?? params.get('repoRoot') ?? ''

  const [run, setRun] = useState<Run | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<RunLogEntry[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [gateNote, setGateNote] = useState('')
  const [decidingWith, setDecidingWith] = useState<string | null>(null)
  const [runningChecks, setRunningChecks] = useState(false)
  const [mergeInfo, setMergeInfo] = useState<{
    defaultBranch: string
    remoteUrl: string | null
    ghCommand?: string
  } | null>(null)
  const [showMergePanel, setShowMergePanel] = useState(false)
  const [merging, setMerging] = useState<'merge' | 'pr' | null>(null)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [removeWorktreeAfterMerge, setRemoveWorktreeAfterMerge] = useState(false)
  const logEndRef = useRef<HTMLDivElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadRun() {
    if (!workspaceRoot || !runId) {
      setLoading(false)
      return
    }
    try {
      const result = await invoke('foundry:run-list', { workspaceRoot })
      const runs = (result.runs as Run[]) ?? []
      const found = runs.find((r) => r.id === runId) ?? null
      setRun(found)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRun()
    pollRef.current = setInterval(() => void loadRun(), 3000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [workspaceRoot, runId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on(
      'foundry:run-status-changed',
      () => void loadRun()
    )
    return () => unsub()
  }, [workspaceRoot, runId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!runId) return
    void (
      invoke('foundry:run-logs', { runId, workspaceRoot }) as Promise<{ entries?: RunLogEntry[] }>
    ).then((r) => {
      if (r.entries) setLogs(r.entries)
    })
    const unsub = window.electronAPI.extensionBridge.on('foundry:run-log', (data) => {
      const { runId: id, entry } = data as { runId: string; entry: RunLogEntry }
      if (id === runId) setLogs((prev) => [...prev, entry])
    })
    return () => unsub()
  }, [runId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (logEndRef.current && typeof logEndRef.current.scrollIntoView === 'function') {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // Auto-select first file when gate opens
  useEffect(() => {
    if (run?.status === 'gate' && run.fileChanges.length > 0 && !selectedFile) {
      void selectFile(run.fileChanges[0].filePath)
    }
  }, [run?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function selectFile(filePath: string) {
    setSelectedFile(filePath)
    setLoadingDiff(true)
    try {
      const result = await invoke('foundry:git-diff-file', { workspaceRoot, filePath })
      setDiffContent((result.unifiedDiff as string) ?? '')
    } catch {
      setDiffContent('')
    } finally {
      setLoadingDiff(false)
    }
  }

  async function decide(decision: 'approve' | 'request-changes' | 'reject') {
    if (decision === 'request-changes' && !gateNote.trim()) return
    if (decision === 'approve' && run?.worktreePath) {
      // Approve with worktree — show merge/PR panel before finalizing
      setDecidingWith('approve')
      try {
        const info = await invoke('foundry:run-get-merge-info', { workspaceRoot })
        setMergeInfo({
          defaultBranch: (info.defaultBranch as string) ?? 'main',
          remoteUrl: (info.remoteUrl as string | null) ?? null,
        })
        setShowMergePanel(true)
      } catch {
        // Fall through to simple approve if merge info unavailable
        await finishApprove()
      } finally {
        setDecidingWith(null)
      }
      return
    }
    setDecidingWith(decision)
    try {
      await invoke('foundry:run-gate-decide', {
        runId,
        workspaceRoot,
        decision,
        note: gateNote.trim() || undefined,
      })
      setGateNote('')
      void loadRun()
    } catch (err) {
      setError(String(err))
    } finally {
      setDecidingWith(null)
    }
  }

  async function finishApprove() {
    setDecidingWith('approve')
    try {
      await invoke('foundry:run-gate-decide', {
        runId,
        workspaceRoot,
        decision: 'approve',
        removeWorktree: removeWorktreeAfterMerge,
      })
      setGateNote('')
      setShowMergePanel(false)
      void loadRun()
    } catch (err) {
      setError(String(err))
    } finally {
      setDecidingWith(null)
    }
  }

  async function mergeToMain() {
    setMerging('merge')
    setMergeError(null)
    try {
      const res = await invoke('foundry:run-merge', { runId, workspaceRoot })
      if ('error' in res) {
        setMergeError(res.error as string)
        return
      }
      setShowMergePanel(false)
      void loadRun()
    } finally {
      setMerging(null)
    }
  }

  async function createPR() {
    setMerging('pr')
    setMergeError(null)
    try {
      const res = await invoke('foundry:run-create-pr', { runId, workspaceRoot })
      if ('error' in res) {
        setMergeError(res.error as string)
        return
      }
      // Open gh pr create in a terminal or copy command to clipboard
      const branch = res.branch as string
      const defaultBranch = res.defaultBranch as string
      const prTitle = res.prTitle as string
      // Open gh pr create via shell — pass as a command the user can run
      await invoke('foundry:open-run-console', {
        runId,
        workspaceRoot,
        action: 'open-terminal',
        command: `gh pr create --base ${defaultBranch} --head ${branch} --title "${prTitle.replace(/"/g, '\\"')}"`,
      }).catch(() => {})
      // Fallback: just mark approved and show the gh command
      setMergeInfo((prev) =>
        prev
          ? {
              ...prev,
              ghCommand: `gh pr create --base ${defaultBranch} --head ${branch} --title "${prTitle.replace(/"/g, '\\"')}"`,
            }
          : prev
      )
      // Mark the run as done
      await invoke('foundry:run-gate-decide', { runId, workspaceRoot, decision: 'approve' })
      setShowMergePanel(false)
      void loadRun()
    } finally {
      setMerging(null)
    }
  }

  async function abort() {
    setDecidingWith('abort')
    try {
      await invoke('foundry:run-abort', { runId, workspaceRoot })
      void loadRun()
    } catch (err) {
      setError(String(err))
    } finally {
      setDecidingWith(null)
    }
  }

  if (loading)
    return (
      <div className="fnd-panel">
        <div className="fnd-header">
          <span className="fnd-title">Run Console</span>
        </div>
        <div className="fnd-empty">Loading…</div>
      </div>
    )

  if (!run)
    return (
      <div className="fnd-panel">
        <div className="fnd-header">
          <span className="fnd-title">Run Console</span>
        </div>
        <div className="fnd-empty">
          <span>Run not found.</span>
          <span style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>{runId}</span>
        </div>
      </div>
    )

  // Route to mode-specific views
  if (run.mode === 'co-pilot') {
    return (
      <div
        className="fnd-panel"
        style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="fnd-header">
          <span className="fnd-badge fnd-badge--running" style={{ marginRight: 8, fontSize: 10 }}>
            co-pilot
          </span>
          <span
            className="fnd-title"
            style={{ textTransform: 'none', fontSize: 12, letterSpacing: 0 }}
          >
            {workspaceRoot.split('/').pop()} — co-pilot session
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tm-text-muted)' }}>
            {run.providerId} · {run.model}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <CopilotView run={run} workspaceRoot={workspaceRoot} />
        </div>
      </div>
    )
  }

  if (run.mode === 'orchestrate') {
    return (
      <div
        className="fnd-panel"
        style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        <OrchestrationView
          run={run}
          workspaceRoot={workspaceRoot}
          onRetried={() => void loadRun()}
        />
      </div>
    )
  }

  const dotClass = STATUS_DOT[run.status] ?? 'fnd-dot--amber'
  const label = STATUS_LABEL[run.status] ?? run.status
  const runName = run.specPath
    ? (run.specPath.split('/').pop() ?? run.id)
    : (run.prompt ?? '').slice(0, 40) || run.id
  const isTerminal = run.status === 'done' || run.status === 'rejected' || run.status === 'aborted'
  const isGate = run.status === 'gate'
  const isPausedError = run.status === 'paused-error'

  return (
    <div className="fnd-panel" style={{ height: '100vh' }}>
      {/* ── Title bar ── */}
      <div className="fnd-header">
        <span
          className="fnd-title"
          style={{ textTransform: 'none', fontSize: 12, letterSpacing: 0 }}
        >
          {isGate && (
            <span className="fnd-badge fnd-badge--gate" style={{ marginRight: 8, fontSize: 10 }}>
              gate — iter {run.currentIteration}/{run.iterationLimit}
            </span>
          )}
          {runName}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          {isPausedError && (
            <button
              className="fnd-btn fnd-btn--primary fnd-btn--sm"
              onClick={() =>
                void invoke('foundry:run-retry', { runId, workspaceRoot }).then(
                  () => void loadRun()
                )
              }
              disabled={decidingWith !== null}
            >
              <RotateCcw size={11} /> Retry
            </button>
          )}
          {!isTerminal && (
            <button
              className="fnd-btn fnd-btn--secondary fnd-btn--sm"
              onClick={() => void abort()}
              disabled={decidingWith === 'abort'}
            >
              {decidingWith === 'abort' ? 'Aborting…' : 'Abort'}
            </button>
          )}
        </div>
      </div>

      {/* ── Status + metadata strip ── */}
      <div className="fnd-status-bar" style={{ justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div className={`fnd-dot ${dotClass}`} />
          <span>{label}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--tm-text-muted)' }}>
          <span>{run.mode}</span>
          <span>{run.providerId}</span>
          <span style={{ color: 'var(--tm-text-primary)' }}>{run.model}</span>
          {run.checkpointCommit && <span>checkpoint {run.checkpointCommit.slice(0, 7)}</span>}
        </div>
      </div>

      {error && (
        <div
          style={{
            padding: '6px 12px',
            background: 'rgba(239,68,68,0.1)',
            color: 'var(--tm-danger)',
            fontSize: 12,
            flexShrink: 0,
          }}
        >
          {error}
        </div>
      )}

      {/* ── Main body ── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* ── Left: Agent output log ── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRight: '1px solid var(--tm-border)',
          }}
        >
          <div
            style={{
              padding: '4px 12px',
              borderBottom: '1px solid var(--tm-border)',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span className="fnd-section-label" style={{ padding: 0 }}>
              Agent output
            </span>
            <button
              className="fnd-btn fnd-btn--secondary fnd-btn--sm"
              style={{ fontSize: 10 }}
              title="Copy log to clipboard"
              onClick={() => {
                const text = logs.map((e) => `[${e.ts}] ${e.kind}: ${e.message}`).join('\n')
                void navigator.clipboard.writeText(text)
              }}
            >
              ⎘ Copy
            </button>
          </div>
          <div className="fnd-log" style={{ flex: 1 }}>
            {logs.length === 0 ? (
              <div style={{ color: 'var(--tm-text-muted)' }}>Waiting for activity…</div>
            ) : (
              logs.map((entry, i) => <LogLine key={i} entry={entry} />)
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* ── Right: Changed files + diff + gate controls ── */}
        <div
          style={{
            width: 480,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {/* File list */}
          <div style={{ borderBottom: '1px solid var(--tm-border)', flexShrink: 0 }}>
            <div className="fnd-section-label" style={{ padding: '6px 10px 4px' }}>
              Changed files ({run.fileChanges.length})
            </div>
            {run.fileChanges.length === 0 ? (
              <div style={{ padding: '6px 10px 8px', color: 'var(--tm-text-muted)', fontSize: 11 }}>
                No file changes yet.
              </div>
            ) : (
              run.fileChanges.map((fc) => (
                <FileRow
                  key={fc.filePath}
                  fc={fc}
                  selected={selectedFile === fc.filePath}
                  onClick={() => void selectFile(fc.filePath)}
                />
              ))
            )}
          </div>

          {/* Diff viewer */}
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              background: 'var(--tm-bg-surface)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {run.fileChanges.length === 0 ? (
              <div style={{ padding: 12, color: 'var(--tm-text-muted)', fontSize: 11 }}>
                {run.status === 'running'
                  ? 'Diff will appear here when the agent makes changes.'
                  : 'No changes to review.'}
              </div>
            ) : loadingDiff ? (
              <div style={{ padding: 12, color: 'var(--tm-text-muted)', fontSize: 11 }}>
                Loading diff…
              </div>
            ) : (
              <DiffViewer diff={diffContent} filePath={selectedFile ?? undefined} />
            )}
          </div>

          {/* Sensor results + re-run button */}
          {run.sensorResults && run.sensorResults.length > 0 && (
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--tm-border)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 10px 2px',
                }}
              >
                <span className="fnd-section-label" style={{ padding: 0 }}>
                  Sensor results
                </span>
                <button
                  className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                  style={{ fontSize: 10 }}
                  disabled={runningChecks}
                  onClick={() => {
                    setRunningChecks(true)
                    void invoke('foundry:run-sensors', { runId, workspaceRoot })
                      .then(() => void loadRun())
                      .finally(() => setRunningChecks(false))
                  }}
                >
                  {runningChecks ? (
                    'Running…'
                  ) : (
                    <>
                      <RotateCcw size={10} /> Re-run checks
                    </>
                  )}
                </button>
              </div>
              {run.sensorResults.map((r, i) => (
                <SensorRow key={i} r={r} />
              ))}
            </div>
          )}

          {/* Gate controls */}
          {isGate && (
            <div
              style={{
                padding: '10px 12px',
                borderTop: '1px solid var(--tm-border)',
                flexShrink: 0,
                background: 'var(--tm-bg-elevated)',
              }}
            >
              <textarea
                placeholder="Feedback note (required for Request Changes)…"
                value={gateNote}
                onChange={(e) => setGateNote(e.target.value)}
                rows={2}
                style={{
                  width: '100%',
                  background: 'var(--tm-bg-input)',
                  border: '1px solid var(--tm-border)',
                  borderRadius: 'var(--tm-radius-xs)',
                  color: 'var(--tm-text-primary)',
                  fontSize: 11,
                  padding: '5px 8px',
                  resize: 'none',
                  marginBottom: 8,
                  boxSizing: 'border-box',
                  fontFamily: 'inherit',
                }}
              />
              {showMergePanel && mergeInfo ? (
                <div
                  style={{
                    background: 'var(--tm-bg-card)',
                    border: '1px solid var(--tm-border)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', fontWeight: 600 }}>
                    Changes approved — what next?
                  </div>
                  {mergeError && (
                    <div style={{ fontSize: 11, color: 'var(--tm-danger)' }}>{mergeError}</div>
                  )}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      color: 'var(--tm-text-secondary)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={removeWorktreeAfterMerge}
                      onChange={(e) => setRemoveWorktreeAfterMerge(e.target.checked)}
                    />
                    Remove worktree after merge
                  </label>
                  <button
                    className="fnd-btn fnd-btn--primary fnd-btn--sm"
                    onClick={() => void mergeToMain()}
                    disabled={merging !== null}
                    style={{ width: '100%' }}
                  >
                    {merging === 'merge' ? '…' : `⤶ Merge to ${mergeInfo.defaultBranch}`}
                  </button>
                  {mergeInfo.remoteUrl && (
                    <button
                      className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                      onClick={() => void createPR()}
                      disabled={merging !== null}
                      style={{ width: '100%' }}
                    >
                      {merging === 'pr' ? '…' : '⎇ Create Pull Request'}
                    </button>
                  )}
                  <button
                    className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                    onClick={() => void finishApprove()}
                    disabled={merging !== null}
                    style={{ width: '100%', color: 'var(--tm-text-muted)' }}
                  >
                    Just approve (keep branch)
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="fnd-btn fnd-btn--primary fnd-btn--sm"
                    onClick={() => void decide('approve')}
                    disabled={decidingWith !== null}
                    style={{ flex: 1 }}
                  >
                    {decidingWith === 'approve' ? (
                      '…'
                    ) : (
                      <>
                        <Check size={11} /> Approve
                      </>
                    )}
                  </button>
                  <button
                    className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                    onClick={() => void decide('request-changes')}
                    disabled={decidingWith !== null || !gateNote.trim()}
                    style={{ flex: 1 }}
                    title={!gateNote.trim() ? 'Add a note before requesting changes' : undefined}
                  >
                    {decidingWith === 'request-changes' ? '…' : '✎ Request Changes'}
                  </button>
                  <button
                    className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                    onClick={() => void decide('reject')}
                    disabled={decidingWith !== null}
                    style={{ color: 'var(--tm-danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                  >
                    {decidingWith === 'reject' ? (
                      '…'
                    ) : (
                      <>
                        <X size={11} /> Reject & Reset
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
