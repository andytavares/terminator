import React, { useEffect, useState } from 'react'
import { GitMerge, Link } from 'lucide-react'
import type { PilotState } from '../types/speckit.types.js'
import { getSpeckitAPI } from '../types/electron.js'

interface OpenPrGateProps {
  featureDir: string
  workspacePath: string
}

export function OpenPrGate({ featureDir, workspacePath }: OpenPrGateProps) {
  const [state, setState] = useState<PilotState | null>(null)
  const [prTitle, setPrTitle] = useState('')
  const [opening, setOpening] = useState(false)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const api = getSpeckitAPI()
    api
      .pilotState({ featureDir })
      .then((res) => {
        if ('state' in res) setState(res.state)
      })
      .catch(() => {})
  }, [featureDir])

  async function handleOpenPr() {
    if (!state || !prTitle.trim()) return
    setOpening(true)
    setError(null)
    const api = getSpeckitAPI()
    try {
      const res = await api.openPr({
        featureDir,
        workspacePath,
        title: prTitle.trim(),
        baseBranch: 'main',
      })
      if ('prUrl' in res) {
        setPrUrl(res.prUrl)
      } else {
        setError(res.error)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setOpening(false)
    }
  }

  if (!state) {
    return <div style={{ padding: 16, color: 'var(--tm-text-secondary)' }}>Loading…</div>
  }

  if (prUrl) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
        <div style={{ color: 'var(--tm-success, #22c55e)', fontWeight: 600 }}>PR opened!</div>
        <a
          href={prUrl}
          target="_blank"
          rel="noreferrer"
          style={{ color: 'var(--tm-accent, #3b82f6)', fontSize: 13 }}
        >
          {prUrl}
        </a>
      </div>
    )
  }

  const specPath = `${featureDir}/spec.md`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 16 }}>
      <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--tm-text-primary)' }}>
        Open Pull Request
      </div>

      {/* Ticket badge */}
      {state.ticket && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            className="sk-badge sk-badge--accent"
            style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
          >
            {state.ticket.key}
          </span>
          <span style={{ fontSize: 13, color: 'var(--tm-text-primary)' }}>
            {state.ticket.title}
          </span>
        </div>
      )}

      {/* Branch */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--tm-text-secondary)',
          fontFamily: 'var(--tm-font-mono, monospace)',
        }}
      >
        {state.branchName ?? 'unknown branch'}
      </div>

      {/* Traceability: spec link */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--tm-text-secondary)',
        }}
      >
        <Link size={12} />
        <span>Spec: {specPath}</span>
      </div>

      {/* PR title input */}
      <input
        type="text"
        value={prTitle}
        onChange={(e) => setPrTitle(e.target.value)}
        placeholder="PR title…"
        aria-label="PR title"
        style={{
          padding: '6px 10px',
          background: 'var(--tm-surface, #111827)',
          color: 'var(--tm-text-primary)',
          border: '1px solid var(--tm-border, #374151)',
          borderRadius: 6,
          fontSize: 13,
          width: '100%',
          boxSizing: 'border-box',
        }}
      />

      {error && <div style={{ fontSize: 12, color: 'var(--tm-danger)' }}>{error}</div>}

      <button
        onClick={handleOpenPr}
        disabled={opening || !prTitle.trim()}
        aria-label="Open PR"
        style={{ display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <GitMerge size={14} />
        {opening ? 'Opening…' : 'Open PR'}
      </button>
    </div>
  )
}
