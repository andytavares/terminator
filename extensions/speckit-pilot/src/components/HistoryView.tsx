import React, { useEffect, useState, useCallback } from 'react'
import type { Feature, PilotState } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface HistoryViewProps {
  workspacePath: string
}

interface HistoryRow {
  feature: Feature
  state: PilotState | null
}

export function HistoryView({ workspacePath }: HistoryViewProps) {
  const [rows, setRows] = useState<HistoryRow[]>([])
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
      // Most recently modified first
      populated.sort((a, b) => b.feature.lastModified - a.feature.lastModified)
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

  const cellStyle: React.CSSProperties = {
    padding: '8px 16px',
    color: 'var(--tm-text-primary)',
    fontSize: 13,
  }
  const dimStyle: React.CSSProperties = { ...cellStyle, color: 'var(--tm-text-secondary)' }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--tm-border, #374151)' }}>
            {['Feature', 'Ticket', 'Branch', 'Status', 'PR', 'Started'].map((h) => (
              <th
                key={h}
                style={{
                  padding: '8px 16px',
                  textAlign: 'left',
                  color: 'var(--tm-text-secondary)',
                  fontWeight: 500,
                  fontSize: 12,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: 'var(--tm-text-secondary)',
                }}
              >
                No completed runs yet.
              </td>
            </tr>
          ) : (
            rows.map(({ feature, state }) => (
              <tr key={feature.dir} style={{ borderBottom: '1px solid var(--tm-border, #1f2937)' }}>
                <td style={cellStyle}>{feature.name}</td>
                <td style={dimStyle}>
                  {state?.ticket ? `${state.ticket.key} · ${state.ticket.title}` : '—'}
                </td>
                <td style={dimStyle}>{state?.branchName ?? '—'}</td>
                <td style={dimStyle}>{state?.run?.status ?? '—'}</td>
                <td style={dimStyle}>
                  {state?.prUrl ? (
                    <a
                      href={state.prUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--tm-accent, #3b82f6)', textDecoration: 'none' }}
                    >
                      PR
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td style={dimStyle}>
                  {state?.run?.startedAt
                    ? new Date(state.run.startedAt).toLocaleString()
                    : new Date(feature.lastModified).toLocaleString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
