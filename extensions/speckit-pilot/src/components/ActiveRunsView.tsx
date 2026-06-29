import React, { useCallback, useEffect, useState } from 'react'
import type { PhaseId, PilotState } from '../types/speckit.types.js'
import { PHASE_LABELS, PHASE_ORDER } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface RunRow {
  featureDir: string
  state: PilotState | null
}

interface ActiveRunsViewProps {
  activeRunDirs: string[]
  workspacePath: string
  onSelect: (featureDir: string) => void
}

function findActivePhase(state: PilotState): PhaseId | null {
  for (const id of PHASE_ORDER) {
    const s = state.phases[id]?.status
    if (s === 'running' || s === 'awaiting_review') return id
  }
  return null
}

function statusBadge(status: string): React.CSSProperties {
  switch (status) {
    case 'running':
      return { background: 'rgba(59,130,246,0.15)', color: '#60a5fa' }
    case 'awaiting_review':
      return { background: 'rgba(234,179,8,0.15)', color: '#facc15' }
    default:
      return { background: 'rgba(107,114,128,0.15)', color: '#9ca3af' }
  }
}

function elapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m}m`
}

export function ActiveRunsView({
  activeRunDirs,
  workspacePath: _workspacePath,
  onSelect,
}: ActiveRunsViewProps) {
  const [rows, setRows] = useState<RunRow[]>([])

  const refreshRow = useCallback((featureDir: string, state: PilotState) => {
    setRows((prev) => prev.map((r) => (r.featureDir === featureDir ? { featureDir, state } : r)))
  }, [])

  useEffect(() => {
    if (activeRunDirs.length === 0) {
      setRows([])
      return
    }
    const api = getSpeckitAPI()

    // Initialise rows, then load state for each
    setRows(activeRunDirs.map((featureDir) => ({ featureDir, state: null })))
    for (const featureDir of activeRunDirs) {
      void api.pilotState({ featureDir }).then((result) => {
        if ('state' in result) refreshRow(featureDir, result.state)
      })
    }

    const unsub = api.onStateChanged((data) => {
      const payload = data as { state?: PilotState }
      if (payload.state && activeRunDirs.includes(payload.state.featureDir)) {
        refreshRow(payload.state.featureDir, payload.state)
      }
    })
    return unsub
  }, [activeRunDirs, refreshRow])

  if (activeRunDirs.length === 0) {
    return (
      <div className="sk-empty">
        <div className="sk-empty__title">No active runs</div>
        <div className="sk-empty__sub">Dispatch a ticket from the Tickets tab to start one.</div>
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {rows.map(({ featureDir, state }) => {
        const featureName = featureDir.split('/').pop() ?? featureDir
        const activePhase = state ? findActivePhase(state) : null
        const phaseStatus = activePhase ? (state!.phases[activePhase]?.status ?? '') : ''
        const startedAt = state?.run?.startedAt

        return (
          <div
            key={featureDir}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(featureDir)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(featureDir)}
            style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--tm-border, #374151)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--tm-text-primary)' }}>
                {featureName}
              </div>
              {state?.ticket && (
                <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginTop: 2 }}>
                  {state.ticket.key} · {state.ticket.title}
                </div>
              )}
            </div>

            {activePhase && (
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  flexShrink: 0,
                  ...statusBadge(phaseStatus),
                }}
              >
                {PHASE_LABELS[activePhase]}
              </span>
            )}

            {startedAt && (
              <span style={{ fontSize: 11, color: 'var(--tm-text-secondary)', flexShrink: 0 }}>
                {elapsed(startedAt)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
