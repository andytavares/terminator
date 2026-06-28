import React, { useEffect, useState } from 'react'
import type { Feature } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface HistoryViewProps {
  workspacePath: string
}

export function HistoryView({ workspacePath }: HistoryViewProps) {
  const [features, setFeatures] = useState<Feature[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const api = getSpeckitAPI()
    api
      .featureList({ repoRoot: workspacePath })
      .then((result) => {
        if ('features' in result) setFeatures(result.features)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [workspacePath])

  if (loading) {
    return <div style={{ padding: 16, color: 'var(--tm-text-secondary)' }}>Loading…</div>
  }

  return (
    <div style={{ overflowY: 'auto', flex: 1 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--tm-border, #374151)' }}>
            <th
              style={{
                padding: '8px 16px',
                textAlign: 'left',
                color: 'var(--tm-text-secondary)',
                fontWeight: 500,
              }}
            >
              Ticket
            </th>
            <th
              style={{
                padding: '8px 16px',
                textAlign: 'left',
                color: 'var(--tm-text-secondary)',
                fontWeight: 500,
              }}
            >
              Feature
            </th>
            <th
              style={{
                padding: '8px 16px',
                textAlign: 'left',
                color: 'var(--tm-text-secondary)',
                fontWeight: 500,
              }}
            >
              PR URL
            </th>
            <th
              style={{
                padding: '8px 16px',
                textAlign: 'left',
                color: 'var(--tm-text-secondary)',
                fontWeight: 500,
              }}
            >
              Status
            </th>
            <th
              style={{
                padding: '8px 16px',
                textAlign: 'left',
                color: 'var(--tm-text-secondary)',
                fontWeight: 500,
              }}
            >
              Timestamp
            </th>
          </tr>
        </thead>
        <tbody>
          {features.length === 0 ? (
            <tr>
              <td
                colSpan={5}
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
            features.map((feature) => (
              <tr key={feature.dir} style={{ borderBottom: '1px solid var(--tm-border, #1f2937)' }}>
                <td style={{ padding: '8px 16px', color: 'var(--tm-text-primary)' }}>—</td>
                <td style={{ padding: '8px 16px', color: 'var(--tm-text-primary)' }}>
                  {feature.name}
                </td>
                <td style={{ padding: '8px 16px', color: 'var(--tm-text-secondary)' }}>—</td>
                <td style={{ padding: '8px 16px', color: 'var(--tm-text-secondary)' }}>—</td>
                <td style={{ padding: '8px 16px', color: 'var(--tm-text-secondary)' }}>
                  {new Date(feature.lastModified).toLocaleString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
