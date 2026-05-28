import React, { useEffect, useState } from 'react'
import './foundry.css'
import type { HistoryEntry, Run } from '../types/foundry.types'

interface Props {
  repoRoot: string | null
  onNewRun?: () => void
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function formatDuration(ms: number): string {
  if (!ms || ms < 1000) return ms > 0 ? `${ms}ms` : '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

function formatTokens(n: number): string {
  if (!n) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

const MODE_CHIP: Record<string, { label: string; cls: string }> = {
  'spec-to-code': { label: 'spec-code', cls: 'fnd-mc-stc' },
  orchestrate: { label: 'orchestrate', cls: 'fnd-mc-orc' },
  'co-pilot': { label: 'co-pilot', cls: 'fnd-mc-cp' },
}

type FilterMode = 'all' | 'spec-to-code' | 'orchestrate' | 'co-pilot' | 'failed'

// Unified row type covering both active runs and history entries
interface RunRow {
  id: string
  name: string
  mode: string
  model: string
  status: string
  tokenCount: number
  durationMs: number
  createdAt: string
  isActive: boolean
}

function toRow(e: HistoryEntry): RunRow {
  return {
    id: e.runId,
    name: e.specPath ? (e.specPath.split('/').pop() ?? e.specPath) : e.promptSummary.slice(0, 60),
    mode: e.mode,
    model: e.model,
    status: e.status,
    tokenCount: e.tokenCountIn + e.tokenCountOut,
    durationMs: e.durationMs,
    createdAt: e.createdAt,
    isActive: false,
  }
}

function activeToRow(r: Run): RunRow {
  return {
    id: r.id,
    name: r.specPath
      ? (r.specPath.split('/').pop() ?? r.id)
      : (r.prompt ?? '').slice(0, 60) || r.id,
    mode: r.mode,
    model: r.model,
    status: r.status,
    tokenCount: 0,
    durationMs: Date.now() - new Date(r.createdAt).getTime(),
    createdAt: r.createdAt,
    isActive: true,
  }
}

export function HistoryView({ repoRoot, onNewRun }: Props) {
  const [rows, setRows] = useState<RunRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const PAGE = 100

  async function load(off = 0, replace = true) {
    if (!repoRoot) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      // Load active runs first
      const activeRes = await invoke('foundry:run-list', { workspaceRoot: repoRoot })
      const activeRuns = ((activeRes.runs as Run[]) ?? []).filter(
        (r) => r.status === 'running' || r.status === 'gate' || r.status === 'paused-error'
      )
      const activeRows = activeRuns.map(activeToRow)
      const activeIds = new Set(activeRows.map((r) => r.id))

      // Load history (exclude IDs already shown as active)
      const histRes = await invoke('foundry:history-load', {
        workspaceRoot: repoRoot,
        offset: off,
        limit: PAGE,
      })
      const histEntries = (histRes.entries as HistoryEntry[]) ?? []
      const histRows = histEntries.filter((e) => !activeIds.has(e.runId)).map(toRow)

      setHasMore((histRes.hasMore as boolean) ?? false)
      setOffset(off + histEntries.length)
      setRows((prev) => (replace ? [...activeRows, ...histRows] : [...prev, ...histRows]))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(0, true)
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when run status changes (new run started, aborted, etc.)
  useEffect(() => {
    if (!repoRoot) return
    const unsub = window.electronAPI.extensionBridge.on('foundry:run-status-changed', () => {
      void load(0, true)
    })
    return () => unsub()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteRow(id: string) {
    if (!repoRoot) return
    setDeletingId(id)
    try {
      await invoke('foundry:run-dismiss', { runId: id, workspaceRoot: repoRoot })
      setRows((prev) => prev.filter((r) => r.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  async function openRun(id: string) {
    if (!repoRoot) return
    await invoke('foundry:open-run-console', { runId: id, workspaceRoot: repoRoot })
  }

  const visible = rows.filter((r) => {
    if (filter === 'failed' && r.status !== 'rejected' && r.status !== 'aborted') return false
    if (filter !== 'all' && filter !== 'failed' && r.mode !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      if (!r.name.toLowerCase().includes(q) && !r.model.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Filter bar */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexWrap: 'wrap',
        }}
      >
        {(['all', 'spec-to-code', 'orchestrate', 'co-pilot', 'failed'] as FilterMode[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`fnd-btn fnd-btn--sm ${filter === f ? 'fnd-btn--primary' : 'fnd-btn--secondary'}`}
            style={{ fontSize: 10 }}
          >
            {f}
          </button>
        ))}
        <input
          className="fnd-sensor-cmd-input"
          style={{ flex: 1, minWidth: 100, fontSize: 11 }}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="search runs…"
        />
      </div>

      {/* Column headers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px 110px 56px 62px 100px 28px',
          gap: 0,
          padding: '4px 12px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
        }}
      >
        {['RUN / SPEC', 'MODE', 'MODEL', 'TOKENS', 'TIME', 'STATUS', ''].map((h, i) => (
          <div
            key={i}
            style={{
              fontSize: 10,
              color: 'var(--tm-text-muted)',
              fontWeight: 600,
              letterSpacing: '0.05em',
              padding: '2px 0',
            }}
          >
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && rows.length === 0 ? (
          <div style={{ padding: 20, color: 'var(--tm-text-muted)', fontSize: 12 }}>Loading…</div>
        ) : visible.length === 0 ? (
          <div
            style={{
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              color: 'var(--tm-text-muted)',
              fontSize: 12,
            }}
          >
            <span>No runs yet.</span>
            {onNewRun && (
              <button className="fnd-btn fnd-btn--primary fnd-btn--sm" onClick={onNewRun}>
                ▶ Start your first run
              </button>
            )}
          </div>
        ) : (
          <>
            {visible.map((r) => {
              const chip = MODE_CHIP[r.mode] ?? { label: r.mode, cls: '' }
              const isDeleting = deletingId === r.id
              return (
                <div
                  key={r.id}
                  onClick={() => void openRun(r.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 90px 110px 56px 62px 100px 28px',
                    gap: 0,
                    padding: '7px 12px',
                    borderBottom: '1px solid var(--tm-border)',
                    cursor: 'pointer',
                    alignItems: 'center',
                  }}
                  className="fnd-run-row"
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--tm-text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 2 }}>
                      {r.model}
                    </div>
                  </div>
                  <div>
                    <span className={`fnd-mode-chip ${chip.cls}`}>{chip.label}</span>
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--tm-text-secondary)',
                      fontFamily: 'var(--tm-font-mono)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.model}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>
                    {formatTokens(r.tokenCount)}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>
                    {r.isActive ? timeSince(r.createdAt) : formatDuration(r.durationMs)}
                  </div>
                  <div>
                    <span
                      className={`fnd-badge fnd-badge--${r.status}`}
                      style={{ fontSize: 10, whiteSpace: 'nowrap' }}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button
                      className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                      style={{ padding: '1px 5px', fontSize: 13, lineHeight: 1, opacity: 0.5 }}
                      title="Delete"
                      disabled={isDeleting}
                      onClick={(e) => {
                        e.stopPropagation()
                        void deleteRow(r.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                </div>
              )
            })}
            {hasMore && (
              <div style={{ padding: '10px 12px' }}>
                <button
                  className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                  onClick={() => void load(offset, false)}
                  disabled={loading}
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
