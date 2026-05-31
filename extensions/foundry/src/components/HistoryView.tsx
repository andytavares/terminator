import React, { useEffect, useState } from 'react'
import { X, RotateCcw, Play } from 'lucide-react'
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

const DECISION_DOT: Record<string, string> = {
  approve: 'var(--tm-success)',
  'request-changes': 'var(--tm-warning)',
  reject: 'var(--tm-danger)',
}

type FilterMode = 'all' | 'spec-to-code' | 'orchestrate' | 'co-pilot' | 'failed'

// Unified row type covering both active runs and history entries
interface RunRow {
  id: string
  name: string
  mode: string
  model: string
  status: string
  providerId: string
  specPath?: string
  promptSummary: string
  tokenCount: number
  durationMs: number
  createdAt: string
  isActive: boolean
  workspaceRoot?: string
  entry?: HistoryEntry
}

function toRow(e: HistoryEntry): RunRow {
  return {
    id: e.runId,
    name: e.specPath ? (e.specPath.split('/').pop() ?? e.specPath) : e.promptSummary.slice(0, 60),
    mode: e.mode,
    model: e.model,
    status: e.status,
    providerId: e.providerId,
    specPath: e.specPath,
    promptSummary: e.promptSummary,
    tokenCount: e.tokenCountIn + e.tokenCountOut,
    durationMs: e.durationMs,
    createdAt: e.createdAt,
    isActive: false,
    entry: e,
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
    providerId: r.providerId,
    specPath: r.specPath,
    promptSummary: r.prompt ?? '',
    tokenCount: 0,
    durationMs: Date.now() - new Date(r.createdAt).getTime(),
    createdAt: r.createdAt,
    isActive: true,
    workspaceRoot: r.workspaceRoot,
  }
}

function DetailPane({
  row,
  repoRoot,
  onRerun,
  onClose,
}: {
  row: RunRow
  repoRoot: string | null
  onRerun: (row: RunRow) => void | Promise<void>
  onClose: () => void
}) {
  const e = row.entry
  return (
    <div
      style={{
        width: 280,
        flexShrink: 0,
        borderLeft: '1px solid var(--tm-border)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '7px 12px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span className="fnd-section-label" style={{ flex: 1, padding: 0 }}>
          Run details
        </span>
        <button
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--tm-text-muted)',
            cursor: 'pointer',
            fontSize: 16,
          }}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '10px 12px' }}>
        {/* Metadata */}
        <div style={{ marginBottom: 12 }}>
          {[
            ['Mode', row.mode],
            ['Provider', row.providerId],
            ['Model', row.model],
            ...(e
              ? [
                  ['Tokens in', formatTokens(e.tokenCountIn)],
                  ['Tokens out', formatTokens(e.tokenCountOut)],
                  ['Files changed', String(e.filesChangedCount)],
                  ['Duration', formatDuration(e.durationMs)],
                  ['Sensors', e.sensorSummary],
                ]
              : []),
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', gap: 8, marginBottom: 4, fontSize: 11 }}>
              <span style={{ color: 'var(--tm-text-muted)', width: 90, flexShrink: 0 }}>
                {label}
              </span>
              <span
                style={{ color: 'var(--tm-text-secondary)', fontFamily: 'var(--tm-font-mono)' }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>

        {/* Prompt summary */}
        {row.promptSummary && (
          <div style={{ marginBottom: 12 }}>
            <div className="fnd-section-label" style={{ marginBottom: 4 }}>
              Prompt
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--tm-text-secondary)',
                lineHeight: 1.4,
                wordBreak: 'break-word',
              }}
            >
              {row.promptSummary.slice(0, 200)}
            </div>
          </div>
        )}

        {/* Gate timeline */}
        {e && e.gateDecisions.length > 0 && (
          <div>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Gate decisions
            </div>
            {e.gateDecisions.map((g, i) => (
              <div
                key={i}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: DECISION_DOT[g.decision] ?? 'var(--tm-text-muted)',
                      marginTop: 2,
                    }}
                  />
                  {i < e.gateDecisions.length - 1 && (
                    <div
                      style={{ width: 1, flex: 1, background: 'var(--tm-border)', marginTop: 2 }}
                    />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      color: DECISION_DOT[g.decision] ?? 'var(--tm-text-primary)',
                    }}
                  >
                    iter {g.iterationNumber} — {g.decision}
                  </div>
                  {g.note && (
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--tm-text-muted)',
                        marginTop: 2,
                        wordBreak: 'break-word',
                      }}
                    >
                      {g.note}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 1 }}>
                    {new Date(g.decidedAt).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer: re-run + open console */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--tm-border)',
          flexShrink: 0,
          display: 'flex',
          gap: 6,
        }}
      >
        <button
          className="fnd-btn fnd-btn--primary fnd-btn--sm"
          style={{ flex: 1, fontSize: 11 }}
          onClick={() => void onRerun(row)}
        >
          <RotateCcw size={11} /> Re-run
        </button>
        <button
          className="fnd-btn fnd-btn--secondary fnd-btn--sm"
          style={{ flex: 1, fontSize: 11 }}
          onClick={() =>
            void invoke('foundry:open-run-console', {
              runId: row.id,
              workspaceRoot: row.workspaceRoot ?? repoRoot,
            })
          }
        >
          View console
        </button>
      </div>
    </div>
  )
}

export function HistoryView({ repoRoot, onNewRun }: Props) {
  const [rows, setRows] = useState<RunRow[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('all')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [selectedRow, setSelectedRow] = useState<RunRow | null>(null)
  const PAGE = 100

  async function load(off = 0, replace = true) {
    setLoading(true)
    try {
      if (repoRoot) {
        // Single-workspace mode
        const activeRes = await invoke('foundry:run-list', { workspaceRoot: repoRoot })
        const activeRuns = ((activeRes.runs as Run[]) ?? []).filter(
          (r) => r.status === 'running' || r.status === 'gate' || r.status === 'paused-error'
        )
        const activeRows = activeRuns.map(activeToRow)
        const activeIds = new Set(activeRows.map((r) => r.id))

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
      } else {
        // Global mode — aggregate history across all workspaces
        const { workspaces } = await window.electronAPI.workspace.list()
        const allRows: RunRow[] = []
        for (const ws of workspaces as { folderPath: string }[]) {
          if (!ws.folderPath) continue
          try {
            const activeRes = await invoke('foundry:run-list', { workspaceRoot: ws.folderPath })
            const activeRuns = ((activeRes.runs as Run[]) ?? []).filter(
              (r) => r.status === 'running' || r.status === 'gate' || r.status === 'paused-error'
            )
            // activeToRow sets workspaceRoot from r.workspaceRoot — preserve it so IPC calls work
            allRows.push(...activeRuns.map((r) => activeToRow(r)))
            // Proxy workspaces have no independent history — skip history load
            if (activeRes.isWorktreeProxy) continue
            const activeIds = new Set(activeRuns.map((r) => r.id))

            const histRes = await invoke('foundry:history-load', {
              workspaceRoot: ws.folderPath,
              offset: 0,
              limit: PAGE,
            })
            const histEntries = (histRes.entries as HistoryEntry[]) ?? []
            allRows.push(
              ...histEntries
                .filter((e) => !activeIds.has(e.runId))
                .map((e) => ({ ...toRow(e), workspaceRoot: ws.folderPath }))
            )
          } catch {
            // workspace may not have foundry configured — skip
          }
        }
        // Sort by most recent first
        allRows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        setHasMore(false)
        setRows(replace ? allRows : (prev) => [...prev, ...allRows])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(0, true)
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh when run status changes (new run started, aborted, etc.)
  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('foundry:run-status-changed', () => {
      void load(0, true)
    })
    return () => unsub()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteRow(id: string) {
    const row = rows.find((r) => r.id === id)
    const ws = row?.workspaceRoot ?? repoRoot
    if (!ws) return
    setDeletingId(id)
    try {
      // Active runs: dismiss (marks aborted, clears from memory, no git cleanup)
      // History entries: delete (removes history.jsonl entry + git worktree/branch)
      const channel = row?.isActive ? 'foundry:run-dismiss' : 'foundry:run-delete'
      await invoke(channel, { runId: id, workspaceRoot: ws })
      setRows((prev) => prev.filter((r) => r.id !== id))
      if (selectedRow?.id === id) setSelectedRow(null)
    } finally {
      setDeletingId(null)
    }
  }

  async function openRun(id: string) {
    const ws = rows.find((r) => r.id === id)?.workspaceRoot ?? repoRoot
    if (!ws) return
    await invoke('foundry:open-run-console', { runId: id, workspaceRoot: ws })
  }

  async function handleRerun(row: RunRow) {
    const ws = row.workspaceRoot ?? repoRoot
    if (!ws) return

    // For orchestrate runs: load saved subAgents so we skip replanning
    let manualDag:
      | Array<{ id: string; role: string; task: string; dependsOn: string[] }>
      | undefined
    if (row.mode === 'orchestrate') {
      const r = await invoke('foundry:history-get-agents', { runId: row.id, workspaceRoot: ws })
      const agents =
        (r.subAgents as Array<{
          agentId: string
          role: string
          task?: string
          dependsOn: string[]
        }>) ?? []
      if (agents.length > 0) {
        manualDag = agents.map((a) => ({
          id: a.agentId,
          role: a.role,
          task: a.task ?? a.role,
          dependsOn: a.dependsOn,
        }))
      }
    }

    const result = await invoke('foundry:run-start', {
      workspaceRoot: ws,
      mode: row.mode,
      providerId: row.providerId,
      model: row.model,
      baseBranch: row.entry?.baseBranch ?? '',
      featureBranch: row.entry?.featureBranch ?? '',
      existingWorktreePath: row.entry?.worktreePath,
      specPath: row.entry?.specPath,
      prompt: row.promptSummary,
      manualDag,
    })

    if ('error' in result) {
      // Fall back to dialog if direct start fails (e.g. branch conflict)
      window.dispatchEvent(
        new CustomEvent('foundry:rerun', {
          detail: {
            providerId: row.providerId,
            model: row.model,
            mode: row.mode,
            specPath: row.specPath,
            prompt: row.promptSummary,
            featureBranch: row.entry?.featureBranch,
            baseBranch: row.entry?.baseBranch,
            worktreePath: row.entry?.worktreePath,
          },
        })
      )
      onNewRun?.()
      return
    }

    const newRunId = result.runId as string
    await invoke('foundry:open-run-console', { runId: newRunId, workspaceRoot: ws })
    onNewRun?.()
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

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Main list */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Column headers */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 90px 56px 62px 100px 28px',
              gap: 0,
              padding: '4px 12px',
              borderBottom: '1px solid var(--tm-border)',
              flexShrink: 0,
            }}
          >
            {['RUN / SPEC', 'MODE', 'TOKENS', 'TIME', 'STATUS', ''].map((h, i) => (
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
              <div style={{ padding: 20, color: 'var(--tm-text-muted)', fontSize: 12 }}>
                Loading…
              </div>
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
                    <Play size={11} /> Start your first run
                  </button>
                )}
              </div>
            ) : (
              <>
                {visible.map((r) => {
                  const chip = MODE_CHIP[r.mode] ?? { label: r.mode, cls: '' }
                  const isDeleting = deletingId === r.id
                  const isSelected = selectedRow?.id === r.id
                  return (
                    <div
                      key={r.id}
                      onClick={() => {
                        setSelectedRow((prev) => (prev?.id === r.id ? null : r))
                        if (!r.isActive) void openRun(r.id)
                      }}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 90px 56px 62px 100px 28px',
                        gap: 0,
                        padding: '7px 12px',
                        borderBottom: '1px solid var(--tm-border)',
                        borderLeft: `2px solid ${isSelected ? 'var(--tm-accent)' : 'transparent'}`,
                        cursor: 'pointer',
                        alignItems: 'center',
                        background: isSelected ? 'var(--tm-bg-card)' : 'transparent',
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
                          {timeSince(r.createdAt)}
                        </div>
                      </div>
                      <div>
                        <span className={`fnd-mode-chip ${chip.cls}`}>{chip.label}</span>
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
                          <X size={12} />
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

        {/* Detail pane */}
        {selectedRow && (
          <DetailPane
            row={selectedRow}
            repoRoot={selectedRow.workspaceRoot ?? repoRoot}
            onRerun={handleRerun}
            onClose={() => setSelectedRow(null)}
          />
        )}
      </div>
    </div>
  )
}
