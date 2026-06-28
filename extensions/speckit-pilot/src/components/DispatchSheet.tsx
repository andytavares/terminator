import React, { useState } from 'react'
import { Play } from 'lucide-react'
import type { AutonomyLevel, TicketRef } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

const LOCKED_GATES = new Set<string>(['self-review', 'open-pr'])
const AUTONOMY_OPTIONS: { value: AutonomyLevel; label: string }[] = [
  { value: 'guided', label: 'Guided' },
  { value: 'standard', label: 'Standard' },
  { value: 'fast', label: 'Fast' },
]

interface DispatchSheetProps {
  ticket: TicketRef
  workspacePath: string
  onDispatched?: (featureDir: string) => void
}

export function DispatchSheet({ ticket, workspacePath, onDispatched }: DispatchSheetProps) {
  const [autonomy, setAutonomy] = useState<AutonomyLevel>('standard')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleStartRun() {
    setLoading(true)
    setError(null)
    try {
      const api = getSpeckitAPI()
      const result = await api.dispatch({ ticket, workspacePath, autonomyLevel: autonomy })
      if ('error' in result) {
        setError(result.error)
      } else {
        onDispatched?.(result.featureDir)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <div>
        <div
          style={{
            fontWeight: 600,
            marginBottom: 4,
            fontSize: 13,
            color: 'var(--tm-text-primary)',
          }}
        >
          {ticket.key}
        </div>
        <div style={{ fontSize: 13, color: 'var(--tm-text-secondary)' }}>{ticket.title}</div>
      </div>

      {/* Autonomy control */}
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 6,
            color: 'var(--tm-text-secondary)',
          }}
        >
          Autonomy
        </div>
        <div className="sk-editor__mode-toggle" style={{ width: '100%' }}>
          {AUTONOMY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setAutonomy(opt.value)}
              style={{ flex: 1 }}
              className={`sk-editor__mode-btn${autonomy === opt.value ? ' sk-editor__mode-btn--active' : ''}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Gate rows */}
      <div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            marginBottom: 6,
            color: 'var(--tm-text-secondary)',
          }}
        >
          Phase gates
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {PHASE_ORDER.map((id) => {
            const locked = LOCKED_GATES.has(id)
            return (
              <label
                key={id}
                className="sk-checkbox-label"
                data-testid="gate-row"
                data-phase={id}
                data-locked={locked ? 'true' : 'false'}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 0',
                  opacity: locked ? 0.6 : 1,
                  cursor: locked ? 'default' : 'pointer',
                  fontSize: 12,
                  color: 'var(--tm-text-primary)',
                }}
              >
                <input
                  type="checkbox"
                  defaultChecked
                  disabled={locked}
                  readOnly={locked}
                  style={{
                    accentColor: 'var(--tm-accent)',
                    cursor: locked ? 'default' : 'pointer',
                  }}
                />
                <span>{id}</span>
                {locked && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--tm-text-muted)',
                      marginLeft: 'auto',
                    }}
                  >
                    Required
                  </span>
                )}
              </label>
            )
          })}
        </div>
      </div>

      {error && <div style={{ color: 'var(--tm-danger)', fontSize: 12 }}>{error}</div>}

      <button
        onClick={handleStartRun}
        disabled={loading}
        className="sk-btn sk-btn--primary"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          width: '100%',
          padding: '8px 12px',
        }}
        aria-label={loading ? 'Starting' : 'Start run'}
      >
        <Play size={14} />
        {loading ? 'Starting…' : 'Start run'}
      </button>
    </div>
  )
}
