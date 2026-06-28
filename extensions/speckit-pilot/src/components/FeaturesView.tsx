import React, { useEffect, useState } from 'react'
import type { Feature } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface FeaturesViewProps {
  workspacePath: string
}

export function FeaturesView({ workspacePath }: FeaturesViewProps) {
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

  if (features.length === 0) {
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
      {features.map((feature) => (
        <div
          key={feature.dir}
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--tm-border, #374151)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span style={{ flex: 1, fontSize: 13, color: 'var(--tm-text-primary)' }}>
            {feature.name}
          </span>
          <ul
            style={{ display: 'flex', gap: 4, listStyle: 'none', padding: 0, margin: 0 }}
            aria-label="phase rail"
          >
            {PHASE_ORDER.map((phase) => (
              <li
                key={phase}
                title={phase}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--tm-text-secondary)',
                  flexShrink: 0,
                }}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
