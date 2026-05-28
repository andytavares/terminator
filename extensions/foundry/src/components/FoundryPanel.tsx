import React, { useEffect, useState } from 'react'
import './foundry.css'
import { HarnessSetupWizard } from './HarnessSetupWizard'
import { HarnessSettings } from './HarnessSettings'
import { NewRunDialog } from './NewRunDialog'
import { HistoryView } from './HistoryView'

interface Props {
  repoRoot: string | null
}

type View = 'dashboard' | 'setup-wizard' | 'settings' | 'new-run'

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

export function FoundryPanel({ repoRoot }: Props) {
  const [view, setView] = useState<View>('dashboard')
  const [setupRequired, setSetupRequired] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [sensorCount, setSensorCount] = useState(0)

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

  function backToDashboard() {
    setView('dashboard')
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
            <div className="fnd-dot fnd-dot--green" />
            <span>Harness ready —&nbsp;</span>
            <span style={{ color: 'var(--tm-success)' }}>
              {sensorCount} sensor{sensorCount !== 1 ? 's' : ''} active
            </span>
          </div>
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <HistoryView repoRoot={repoRoot} onNewRun={() => setView('new-run')} />
          </div>
        </>
      )}
    </div>
  )
}
