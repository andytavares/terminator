import React, { useEffect, useState } from 'react'
import './foundry.css'
import { HarnessSetupWizard } from './HarnessSetupWizard'
import { HarnessSettings } from './HarnessSettings'
import { NewRunDialog } from './NewRunDialog'

interface Props {
  repoRoot: string | null
}

type View = 'dashboard' | 'setup-wizard' | 'settings' | 'new-run'

interface RunSummary {
  id: string
  name: string
  status: 'running' | 'gate' | 'done' | 'aborted'
  model: string
  time: string
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

export function FoundryPanel({ repoRoot }: Props) {
  const [view, setView] = useState<View>('dashboard')
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [activeRuns, setActiveRuns] = useState<RunSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [sensorCount, setSensorCount] = useState(0)
  const [confirmDismissId, setConfirmDismissId] = useState<string | null>(null)

  async function refresh() {
    if (!repoRoot) {
      setLoading(false)
      return
    }
    try {
      const harnessResult = await invoke('foundry:harness-read', { workspaceRoot: repoRoot })
      const needsSetup = 'notFound' in harnessResult
      setSetupRequired(needsSetup)
      if (!needsSetup && 'harness' in harnessResult) {
        const h = harnessResult.harness as { sensors?: unknown[] }
        setSensorCount(h.sensors?.length ?? 0)
      }
      const runResult = await invoke('foundry:run-list', { workspaceRoot: repoRoot })
      const runs =
        (runResult.runs as Array<{
          id: string
          mode: string
          status: string
          model: string
          specPath?: string
          prompt?: string
          createdAt: string
        }>) ?? []
      setActiveRuns(
        runs.map((r) => ({
          id: r.id,
          name: r.specPath
            ? (r.specPath.split('/').pop() ?? r.id)
            : (r.prompt ?? '').slice(0, 30) || r.id,
          status: r.status as RunSummary['status'],
          model: r.model,
          time: timeSince(r.createdAt),
        }))
      )
    } catch {
      setSetupRequired(true)
    } finally {
      setLoading(false)
    }
  }

  // Runs once on mount / repoRoot change — no polling loop
  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh dashboard when any run's status changes (abort, approve, reject, etc.)
  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('foundry:run-status-changed', () => {
      void refresh()
    })
    return () => unsub()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  function backToDashboard() {
    setView('dashboard')
    setLoading(true)
    void refresh()
  }

  if (!repoRoot) {
    return (
      <div className="fnd-panel">
        <div className="fnd-header">
          <span className="fnd-title">Foundry</span>
        </div>
        <div className="fnd-empty">
          <span>Open a workspace to use Foundry.</span>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="fnd-panel">
        <div className="fnd-header">
          <span className="fnd-title">Foundry</span>
        </div>
        <div className="fnd-empty">
          <span>Loading…</span>
        </div>
      </div>
    )
  }

  if (view === 'setup-wizard') {
    return (
      <div className="fnd-panel">
        <HarnessSetupWizard
          repoRoot={repoRoot}
          onComplete={backToDashboard}
          onCancel={() => setView('dashboard')}
        />
      </div>
    )
  }

  if (view === 'settings') {
    return (
      <div className="fnd-panel">
        <HarnessSettings repoRoot={repoRoot} onClose={backToDashboard} />
      </div>
    )
  }

  if (view === 'new-run') {
    return (
      <div className="fnd-panel">
        <NewRunDialog
          repoRoot={repoRoot}
          onClose={() => setView('dashboard')}
          onLaunched={backToDashboard}
        />
      </div>
    )
  }

  // ── Dashboard view ──────────────────────────────────────────────────────────
  return (
    <div className="fnd-panel">
      <div className="fnd-header">
        <span className="fnd-title">Foundry</span>
        {!setupRequired && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className="fnd-btn fnd-btn--primary fnd-btn--sm"
              onClick={() => setView('new-run')}
            >
              ▶ Run
            </button>
            <button
              className="fnd-btn fnd-btn--secondary fnd-btn--sm"
              onClick={() => setView('settings')}
            >
              ⚙
            </button>
          </div>
        )}
      </div>

      {setupRequired ? (
        <>
          <div className="fnd-status-bar">
            <div className="fnd-dot fnd-dot--amber" />
            <span>Harness not configured</span>
          </div>
          <div className="fnd-setup-banner">
            <p>
              No AGENTS.md found in this workspace.
              <br />
              Set up your harness to start using Foundry.
            </p>
            <button className="fnd-btn fnd-btn--primary" onClick={() => setView('setup-wizard')}>
              Set up harness
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="fnd-status-bar">
            <div className="fnd-dot fnd-dot--green" />
            <span>Harness ready —&nbsp;</span>
            <span style={{ color: 'var(--tm-success)' }}>
              {sensorCount} sensor{sensorCount !== 1 ? 's' : ''} active
            </span>
          </div>
          <div className="fnd-body">
            {activeRuns.length > 0 ? (
              <>
                <div className="fnd-section-label">Active runs</div>
                {activeRuns.map((run) => (
                  <div
                    key={run.id}
                    className={`fnd-run-card${run.status === 'gate' ? ' fnd-run-card--gate' : ''}`}
                    onClick={() =>
                      repoRoot &&
                      void invoke('foundry:open-run-console', {
                        runId: run.id,
                        workspaceRoot: repoRoot,
                      })
                    }
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="fnd-run-top">
                      <span
                        className="fnd-run-name"
                        style={{
                          flex: 1,
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {run.name}
                      </span>
                      <span
                        className={`fnd-badge fnd-badge--${run.status}`}
                        style={{ flexShrink: 0 }}
                      >
                        {run.status}
                      </span>
                      {confirmDismissId === run.id ? (
                        <span
                          style={{ display: 'flex', gap: 4, flexShrink: 0 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                            style={{ color: 'var(--tm-danger)', fontSize: 10 }}
                            onClick={() => {
                              setConfirmDismissId(null)
                              void invoke('foundry:run-dismiss', {
                                runId: run.id,
                                workspaceRoot: repoRoot,
                              }).then(() => refresh())
                            }}
                          >
                            Remove
                          </button>
                          <button
                            className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                            style={{ fontSize: 10 }}
                            onClick={() => setConfirmDismissId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                          style={{ flexShrink: 0, opacity: 0.5, fontSize: 11, lineHeight: 1 }}
                          title="Remove from list"
                          onClick={(e) => {
                            e.stopPropagation()
                            if (run.status === 'running' || run.status === 'gate') {
                              setConfirmDismissId(run.id)
                            } else {
                              void invoke('foundry:run-dismiss', {
                                runId: run.id,
                                workspaceRoot: repoRoot,
                              }).then(() => refresh())
                            }
                          }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                    <div className="fnd-run-meta" style={{ justifyContent: 'space-between' }}>
                      <span>{run.model}</span>
                      <span>{run.time}</span>
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <div className="fnd-empty">
                <span>No active runs.</span>
                <span style={{ fontSize: 11 }}>Click ▶ Run to start one.</span>
              </div>
            )}
          </div>
          <button className="fnd-new-run-btn" onClick={() => setView('new-run')}>
            + New run
          </button>
        </>
      )}
    </div>
  )
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  return `${Math.floor(m / 60)}h ago`
}
