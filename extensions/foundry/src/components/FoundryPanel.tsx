import React, { useEffect, useState } from 'react'
import './foundry.css'
import { HarnessSetupWizard } from './HarnessSetupWizard'
import { HarnessSettings } from './HarnessSettings'
import { NewRunDialog } from './NewRunDialog'
import { HistoryView } from './HistoryView'
import type { HarnessHealthEvent } from '../types/foundry.types'

interface Props {
  repoRoot: string | null
}

type View = 'dashboard' | 'setup-wizard' | 'settings' | 'new-run'

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

const HEALTH_MSG: Record<string, (e: HarnessHealthEvent) => string> = {
  'sensor-failure': (e) =>
    `Sensor "${e.sensorName}" has failed ${e.consecutiveCount} consecutive times`,
  'feedforward-gap': (e) =>
    `Repeated rejections for "${e.specPath ? e.specPath.split('/').pop() : 'spec'}" — AGENTS.md may need updating`,
  'stale-reference': (e) =>
    `AGENTS.md references a missing file at line ${e.agentsMdLine}: ${e.agentsMdRef}`,
}

function HealthAlertBar({
  events,
  onEdit,
  onResolve,
}: {
  events: HarnessHealthEvent[]
  onEdit: (view: 'settings') => void
  onResolve: (kind: HarnessHealthEvent['kind'], key?: string) => void
}) {
  if (events.length === 0) return null
  return (
    <div style={{ flexShrink: 0 }}>
      {events.map((e, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 12px',
            background: 'rgba(250,204,21,0.1)',
            borderBottom: '1px solid rgba(250,204,21,0.25)',
            fontSize: 11,
          }}
        >
          <span style={{ color: 'var(--tm-warning)', flexShrink: 0 }}>⚠</span>
          <span style={{ flex: 1, color: 'var(--tm-text-secondary)' }}>
            {HEALTH_MSG[e.kind]?.(e) ?? e.kind}
          </span>
          {e.kind === 'sensor-failure' && (
            <button
              className="fnd-btn fnd-btn--secondary fnd-btn--sm"
              style={{ fontSize: 10, flexShrink: 0 }}
              onClick={() => onEdit('settings')}
            >
              Edit sensor
            </button>
          )}
          {e.kind === 'feedforward-gap' && (
            <button
              className="fnd-btn fnd-btn--secondary fnd-btn--sm"
              style={{ fontSize: 10, flexShrink: 0 }}
              onClick={() => onEdit('settings')}
            >
              Open AGENTS.md
            </button>
          )}
          {e.kind === 'stale-reference' && (
            <button
              className="fnd-btn fnd-btn--primary fnd-btn--sm"
              style={{ fontSize: 10, flexShrink: 0 }}
              onClick={() => onResolve('stale-reference')}
            >
              Dismiss
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

interface RerunConfig {
  providerId?: string
  model?: string
  mode?: string
  specPath?: string
  prompt?: string
}

export function FoundryPanel({ repoRoot }: Props) {
  const [view, setView] = useState<View>('dashboard')
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [sensorCount, setSensorCount] = useState(0)
  const [healthEvents, setHealthEvents] = useState<HarnessHealthEvent[]>([])
  const [rerunConfig, setRerunConfig] = useState<RerunConfig | undefined>(undefined)

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
        // Scan AGENTS.md for stale refs on load
        void invoke('foundry:agents-md-scan', { workspaceRoot: repoRoot })
      }
    } catch {
      setSetupRequired(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for navigation events dispatched by the renderer (⌘⇧R, command palette, etc.)
  useEffect(() => {
    function onNavigate(e: Event) {
      const target = (e as CustomEvent<string>).detail as View
      if (target) setView(target)
    }
    window.addEventListener('foundry:navigate', onNavigate)
    return () => window.removeEventListener('foundry:navigate', onNavigate)
  }, [])

  // Listen for re-run events dispatched by HistoryView
  useEffect(() => {
    function onRerun(e: Event) {
      const config = (e as CustomEvent<RerunConfig>).detail
      setRerunConfig(config)
      setView('new-run')
    }
    window.addEventListener('foundry:rerun', onRerun)
    return () => window.removeEventListener('foundry:rerun', onRerun)
  }, [])

  // Auto-create a Terminator project when a worktree is created for a run
  useEffect(() => {
    if (!repoRoot) return
    const unsub = window.electronAPI.extensionBridge.on('foundry:worktree-created', (data) => {
      const { runId, workspaceRoot, worktreePath, branch, label } = data as {
        runId: string
        workspaceRoot: string
        worktreePath: string
        branch: string
        label: string
      }
      void (async () => {
        try {
          const { workspaces } = await window.electronAPI.workspace.list()
          const ws = workspaces.find(
            (w: { folderPath: string }) => w.folderPath === workspaceRoot
          ) as { id: string } | undefined
          if (!ws) return
          const result = await window.electronAPI.project.create({
            workspaceId: ws.id,
            name: label,
            gitBranch: branch,
            worktreePath,
            isWorktree: true,
          })
          if ('project' in result) {
            await invoke('foundry:set-project-id', {
              runId,
              workspaceRoot,
              projectId: result.project.id,
            })
          }
        } catch {
          // best-effort — project creation must never break a run
        }
      })()
    })
    return () => unsub()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-delete the Terminator project when the worktree is cleaned up
  useEffect(() => {
    if (!repoRoot) return
    const unsub = window.electronAPI.extensionBridge.on('foundry:worktree-removed', (data) => {
      const { terminalProjectId } = data as { terminalProjectId?: string }
      if (!terminalProjectId) return
      void window.electronAPI.project.delete(terminalProjectId).catch(() => {
        // best-effort
      })
    })
    return () => unsub()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to health-changed push events
  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('foundry:health-changed', (data) => {
      const { events } = data as { events: HarnessHealthEvent[] }
      setHealthEvents([...(events ?? [])])
    })
    return () => unsub()
  }, [])

  function backToDashboard() {
    setView('dashboard')
    void refresh()
  }

  async function resolveHealthEvent(kind: HarnessHealthEvent['kind'], key?: string) {
    await invoke('foundry:health-resolve', { kind, key })
    setHealthEvents((prev) =>
      prev.filter((e) => e.kind !== kind || (key && e.sensorName !== key && e.specPath !== key))
    )
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
          onClose={() => {
            setView('dashboard')
            setRerunConfig(undefined)
          }}
          onLaunched={() => {
            setRerunConfig(undefined)
            backToDashboard()
          }}
          rerunConfig={rerunConfig}
        />
      </div>
    )
  }

  // ── Dashboard ── shows history + active runs directly
  return (
    <div className="fnd-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
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
              title="Settings"
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
            <div
              className={`fnd-dot ${healthEvents.length > 0 ? 'fnd-dot--amber' : 'fnd-dot--green'}`}
            />
            <span>
              {healthEvents.length > 0
                ? `${healthEvents.length} health alert${healthEvents.length !== 1 ? 's' : ''}`
                : 'Harness ready — '}
            </span>
            {healthEvents.length === 0 && (
              <span style={{ color: 'var(--tm-success)' }}>
                {sensorCount} sensor{sensorCount !== 1 ? 's' : ''} active
              </span>
            )}
          </div>
          <HealthAlertBar
            events={healthEvents}
            onEdit={(v) => setView(v)}
            onResolve={(kind, key) => void resolveHealthEvent(kind, key)}
          />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <HistoryView repoRoot={repoRoot} onNewRun={() => setView('new-run')} />
          </div>
        </>
      )}
    </div>
  )
}
