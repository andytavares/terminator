import React, { useEffect, useState, useCallback } from 'react'
import type { Feature, PilotState, PhaseStatus } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface FeaturesViewProps {
  workspacePath: string
  onSelect: (featureDir: string) => void
}

interface FeatureRow {
  feature: Feature
  state: PilotState | null
}

function phaseColor(status: PhaseStatus): string {
  switch (status) {
    case 'approved':
      return '#22c55e'
    case 'running':
      return '#3b82f6'
    case 'awaiting_review':
      return '#eab308'
    case 'failed':
      return '#ef4444'
    case 'stale':
      return '#f97316'
    case 'modified':
      return '#a855f7'
    default:
      return 'var(--tm-text-secondary, #6b7280)'
  }
}

export function FeaturesView({ workspacePath, onSelect }: FeaturesViewProps) {
  const [rows, setRows] = useState<FeatureRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const api = getSpeckitAPI()
    try {
      const listResult = await api.featureList({ repoRoot: workspacePath })
      if (!('features' in listResult)) {
        setRows([])
        return
      }
      const populated = await Promise.all(
        listResult.features.map(async (feature) => {
          const stateResult = await api.pilotState({ featureDir: feature.dir })
          const state = 'state' in stateResult ? stateResult.state : null
          return { feature, state }
        })
      )
      setRows(populated)
    } finally {
      setLoading(false)
    }
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath) {
      setLoading(false)
      return
    }
    void load()
  }, [workspacePath, load])

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--tm-text-secondary)' }}>Loading…</div>
  }

  if (rows.length === 0) {
    return (
      <div
        style={{
          padding: 24,
          textAlign: 'center',
          color: 'var(--tm-text-secondary)',
          fontSize: 13,
        }}
      >
        No features yet. Dispatch a ticket to create one.
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      {rows.map(({ feature, state }) => {
        const runStatus = state?.run?.status ?? null
        const isActive = runStatus === 'running'
        return (
          <div
            key={feature.dir}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(feature.dir)}
            onKeyDown={(e) => e.key === 'Enter' && onSelect(feature.dir)}
            style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--tm-border, #374151)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
              background: isActive ? 'var(--tm-bg-selected, rgba(59,130,246,0.08))' : undefined,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: 'var(--tm-text-primary)', fontWeight: 500 }}>
                {feature.name}
              </div>
              {state?.ticket && (
                <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginTop: 2 }}>
                  {state.ticket.key} · {state.ticket.title}
                </div>
              )}
            </div>
            {runStatus && (
              <span
                style={{
                  fontSize: 10,
                  color: isActive ? 'var(--tm-accent)' : 'var(--tm-text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  flexShrink: 0,
                }}
              >
                {runStatus}
              </span>
            )}
            <ul
              style={{
                display: 'flex',
                gap: 3,
                listStyle: 'none',
                padding: 0,
                margin: 0,
                flexShrink: 0,
              }}
              aria-label="phase rail"
            >
              {PHASE_ORDER.map((phase) => {
                const phaseState = state?.phases[phase]
                const status: PhaseStatus = phaseState?.status ?? 'locked'
                return (
                  <li
                    key={phase}
                    title={`${phase}: ${status}`}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: phaseColor(status),
                      flexShrink: 0,
                    }}
                  />
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}
