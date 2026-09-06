import React, { useState } from 'react'
import { ArrowRight, Pause, Play, SplitSquareVertical } from 'lucide-react'
import { getSpeckitAPI } from '../types/electron.js'

interface BatchCheckInProps {
  featureDir: string
  batchIndex: number
  diffSummary: string
}

export function BatchCheckIn({ featureDir, batchIndex, diffSummary }: BatchCheckInProps) {
  const [acting, setActing] = useState(false)

  async function decide(decision: 'continue' | 'pause' | 'split') {
    setActing(true)
    try {
      const api = getSpeckitAPI()
      await api.checkinDecision({ featureDir, decision, batchIndex })
    } finally {
      setActing(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 16,
        border: '2px dashed var(--tm-border, #374151)',
        borderRadius: 8,
        background: 'var(--tm-bg-elevated)',
      }}
    >
      {/* Batch label */}
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-primary)' }}>
        Batch {batchIndex + 1} check-in
      </div>

      {/* Diff summary */}
      {diffSummary && (
        <div
          style={{
            fontSize: 12,
            color: 'var(--tm-text-secondary)',
            fontFamily: 'var(--tm-font-mono, monospace)',
          }}
        >
          {diffSummary}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            void decide('continue')
          }}
          disabled={acting}
          aria-label="Continue"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Play className="tm-icon" />
          Continue
        </button>
        <button
          onClick={() => {
            void decide('pause')
          }}
          disabled={acting}
          aria-label="Pause"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Pause className="tm-icon" />
          Pause
        </button>
        <button
          onClick={() => {
            void decide('split')
          }}
          disabled={acting}
          aria-label="Split to follow-up"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <SplitSquareVertical className="tm-icon" />
          Split to follow-up
        </button>
        <button
          disabled={acting}
          aria-label="Redirect"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowRight className="tm-icon" />
          Redirect
        </button>
      </div>
    </div>
  )
}
