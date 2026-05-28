import React, { useEffect, useMemo, useRef, useState } from 'react'
import './foundry.css'
import type { Run, RunLogEntry, SubAgent } from '../types/foundry.types'

interface Props {
  run: Run
  workspaceRoot: string
  onAbort: () => void
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--tm-success)',
  running: 'var(--tm-accent)',
  gate: 'var(--tm-warning)',
  pending: 'var(--tm-text-muted)',
  rejected: 'var(--tm-danger)',
}

const STATUS_BG: Record<string, string> = {
  done: 'rgba(74,222,128,0.1)',
  running: 'rgba(92,107,192,0.15)',
  gate: 'rgba(250,204,21,0.12)',
  pending: 'var(--tm-bg-card)',
  rejected: 'rgba(239,68,68,0.1)',
}

const LOG_KIND_PREFIX: Record<string, string> = {
  system: '●',
  agent: '›',
  file: '~',
  sensor: '⬡',
  ok: '✓',
  error: '✗',
}

function computeTiers(agents: SubAgent[]): string[][] {
  const indegree = new Map<string, number>()
  const children = new Map<string, string[]>()
  for (const a of agents) {
    if (!indegree.has(a.agentId)) indegree.set(a.agentId, 0)
    for (const dep of a.dependsOn) {
      indegree.set(a.agentId, (indegree.get(a.agentId) ?? 0) + 1)
      if (!children.has(dep)) children.set(dep, [])
      children.get(dep)!.push(a.agentId)
    }
  }
  const tiers: string[][] = []
  let queue = agents.filter((a) => (indegree.get(a.agentId) ?? 0) === 0).map((a) => a.agentId)
  const visited = new Set<string>()
  while (queue.length > 0) {
    tiers.push([...queue])
    queue.forEach((id) => visited.add(id))
    const next: string[] = []
    for (const id of queue) {
      for (const child of children.get(id) ?? []) {
        const ind = (indegree.get(child) ?? 0) - 1
        indegree.set(child, ind)
        if (ind === 0 && !visited.has(child)) next.push(child)
      }
    }
    queue = next
  }
  return tiers
}

function DagView({
  agents,
  selectedId,
  onSelect,
}: {
  agents: SubAgent[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const tiers = useMemo(() => computeTiers(agents), [agents])

  const NODE_W = 140
  const NODE_H = 56
  const TIER_GAP = 90
  const ROW_GAP = 20
  const PAD = 24

  const maxRows = Math.max(...tiers.map((t) => t.length), 1)
  const totalW = tiers.length * NODE_W + (tiers.length - 1) * TIER_GAP + PAD * 2
  const totalH = maxRows * NODE_H + (maxRows - 1) * ROW_GAP + PAD * 2

  function nodeX(tier: number) {
    return PAD + tier * (NODE_W + TIER_GAP)
  }
  function nodeY(tier: number, row: number) {
    const tierRows = tiers[tier]?.length ?? 1
    const blockH = tierRows * NODE_H + (tierRows - 1) * ROW_GAP
    const startY = (totalH - blockH) / 2
    return startY + row * (NODE_H + ROW_GAP)
  }

  // Build position lookup
  const positions = useMemo(() => {
    const pos = new Map<string, { tier: number; row: number }>()
    tiers.forEach((tier, ti) => tier.forEach((id, ri) => pos.set(id, { tier: ti, row: ri })))
    return pos
  }, [tiers])

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.agentId, a])), [agents])

  const edges: Array<{ from: string; to: string }> = []
  for (const a of agents) {
    for (const dep of a.dependsOn) edges.push({ from: dep, to: a.agentId })
  }

  const agentIndex = (id: string) => agents.findIndex((a) => a.agentId === id) + 1

  return (
    <div style={{ overflow: 'auto', flex: 1 }}>
      <svg width={totalW} height={totalH} style={{ display: 'block' }}>
        {/* Edges */}
        {edges.map((e, i) => {
          const fp = positions.get(e.from)
          const tp = positions.get(e.to)
          if (!fp || !tp) return null
          const x1 = nodeX(fp.tier) + NODE_W
          const y1 = nodeY(fp.tier, fp.row) + NODE_H / 2
          const x2 = nodeX(tp.tier)
          const y2 = nodeY(tp.tier, tp.row) + NODE_H / 2
          const mx = (x1 + x2) / 2
          const fromDone = agentMap.get(e.from)?.status === 'done'
          const toStatus = agentMap.get(e.to)?.status
          const isActive = toStatus === 'running' || toStatus === 'gate'
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={
                isActive
                  ? 'var(--tm-accent)'
                  : fromDone
                    ? 'var(--tm-border-strong, #444)'
                    : 'var(--tm-border)'
              }
              strokeWidth={isActive ? 1.5 : 1}
              strokeDasharray={toStatus === 'pending' ? '5 3' : undefined}
              opacity={toStatus === 'pending' ? 0.4 : 0.75}
            />
          )
        })}

        {/* Nodes */}
        {agents.map((a) => {
          const pos = positions.get(a.agentId)
          if (!pos) return null
          const x = nodeX(pos.tier)
          const y = nodeY(pos.tier, pos.row)
          const color = STATUS_COLOR[a.status] ?? 'var(--tm-text-muted)'
          const bg = STATUS_BG[a.status] ?? 'var(--tm-bg-card)'
          const isSel = selectedId === a.agentId
          const idx = agentIndex(a.agentId)
          const BADGE_R = 10
          const bx = x + BADGE_R + 6
          const by = y + BADGE_R + 6

          return (
            <g key={a.agentId} onClick={() => onSelect(a.agentId)} style={{ cursor: 'pointer' }}>
              <rect
                x={x}
                y={y}
                width={NODE_W}
                height={NODE_H}
                rx={6}
                ry={6}
                fill={bg}
                stroke={isSel ? 'var(--tm-accent)' : color}
                strokeWidth={isSel ? 2 : 1}
                opacity={a.status === 'pending' ? 0.6 : 1}
              />
              {/* Number badge — single circle + single centered number */}
              <circle
                cx={bx}
                cy={by}
                r={BADGE_R}
                fill={`${color}20`}
                stroke={color}
                strokeWidth={1}
              />
              <text
                x={bx}
                y={by + 4}
                textAnchor="middle"
                fill={color}
                fontSize={10}
                fontWeight={700}
                fontFamily="monospace"
              >
                {idx}
              </text>
              {/* Role name */}
              <text
                x={bx + BADGE_R + 6}
                y={y + 20}
                fill="var(--tm-text-primary)"
                fontSize={12}
                fontWeight={500}
              >
                {a.role.length > 11 ? a.role.slice(0, 11) + '…' : a.role}
              </text>
              {/* Status line */}
              <text x={x + 8} y={y + 40} fill={color} fontSize={10} opacity={0.9}>
                {a.status === 'done'
                  ? 'done ✓'
                  : a.status === 'running'
                    ? 'running…'
                    : a.status === 'gate'
                      ? 'awaiting gate'
                      : a.status === 'rejected'
                        ? 'rejected'
                        : a.dependsOn.length > 0
                          ? `waiting on ${a.dependsOn.map((d) => agentIndex(d)).join(', ')}`
                          : 'pending'}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div
        style={{
          padding: '4px 12px 8px',
          display: 'flex',
          gap: 14,
          fontSize: 10,
          color: 'var(--tm-text-muted)',
        }}
      >
        {(['done', 'running', 'gate', 'pending'] as const).map((s) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: STATUS_COLOR[s],
                display: 'inline-block',
                flexShrink: 0,
              }}
            />
            {s}
          </span>
        ))}
      </div>
    </div>
  )
}

function AgentLogPane({
  runId,
  agent,
  onClose,
}: {
  runId: string
  agent: SubAgent
  onClose: () => void
}) {
  const [logs, setLogs] = useState<RunLogEntry[]>([])
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // Load existing logs
    void invoke('foundry:subagent-logs', { runId, agentId: agent.agentId }).then((r) => {
      setLogs((r.entries as RunLogEntry[]) ?? [])
    })
    // Subscribe to new log events for this agent
    const unsub = window.electronAPI.extensionBridge.on('foundry:subagent-log', (data) => {
      const {
        runId: rid,
        agentId,
        entry,
      } = data as { runId: string; agentId: string; entry: RunLogEntry }
      if (rid === runId && agentId === agent.agentId) {
        setLogs((prev) => [...prev, entry])
      }
    })
    return () => unsub()
  }, [runId, agent.agentId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const color = STATUS_COLOR[agent.status] ?? 'var(--tm-text-muted)'

  return (
    <div
      style={{
        height: 220,
        flexShrink: 0,
        borderTop: '1px solid var(--tm-border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--tm-bg)',
      }}
    >
      {/* Pane header */}
      <div
        style={{
          padding: '5px 12px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--tm-bg-elevated)',
        }}
      >
        <span
          style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }}
        />
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--tm-text-primary)', flex: 1 }}>
          {agent.role}
        </span>
        <span className={`fnd-badge fnd-badge--${agent.status}`} style={{ fontSize: 10 }}>
          {agent.status}
        </span>
        <button
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--tm-text-muted)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 4px',
          }}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {/* Log entries */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          fontFamily: 'var(--tm-font-mono)',
          fontSize: 11,
          padding: '4px 0',
        }}
      >
        {logs.length === 0 ? (
          <div style={{ padding: '8px 14px', color: 'var(--tm-text-muted)' }}>
            {agent.status === 'pending' ? 'Waiting for dependencies…' : 'No output yet.'}
          </div>
        ) : (
          logs.map((entry, i) => {
            const time = new Date(entry.ts).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })
            return (
              <div
                key={i}
                className={`fnd-log-line fnd-log-line--${entry.kind}`}
                style={{ display: 'flex', gap: 6, padding: '1px 14px' }}
              >
                <span style={{ color: 'var(--tm-text-muted)', flexShrink: 0, fontSize: 10 }}>
                  {time}
                </span>
                <span style={{ color: 'var(--tm-text-muted)', flexShrink: 0, width: 12 }}>
                  {LOG_KIND_PREFIX[entry.kind] ?? '›'}
                </span>
                <span style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {entry.message}
                </span>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export function OrchestrationView({ run, workspaceRoot, onAbort }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agents, setAgents] = useState<SubAgent[]>(run.subAgents ?? [])

  // Refresh agent list when run status changes (sub-agent statuses update)
  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('foundry:run-status-changed', () => {
      void invoke('foundry:run-list', { workspaceRoot }).then((r) => {
        const runs = (r.runs as Array<{ id: string; subAgents?: SubAgent[] }>) ?? []
        const updated = runs.find((x) => x.id === run.id)
        if (updated?.subAgents) setAgents(updated.subAgents)
      })
    })
    return () => unsub()
  }, [run.id, workspaceRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedAgent = agents.find((a) => a.agentId === selectedId) ?? null
  const doneCount = agents.filter((a) => a.status === 'done').length
  const progress = agents.length > 0 ? doneCount / agents.length : 0

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id))
  }

  async function abortAll() {
    await invoke('foundry:run-abort', { runId: run.id, workspaceRoot })
    onAbort()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '6px 14px',
          borderBottom: '1px solid var(--tm-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <span className="fnd-badge fnd-badge--running" style={{ fontSize: 10 }}>
          orchestrate
        </span>
        <span
          style={{
            fontSize: 12,
            color: 'var(--tm-text-primary)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {run.prompt?.slice(0, 80) ?? run.id}
        </span>
        <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', flexShrink: 0 }}>
          {run.model}
        </span>
      </div>

      {/* Main area: DAG + agent list */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* DAG */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRight: '1px solid var(--tm-border)',
          }}
        >
          {agents.length === 0 ? (
            <div
              style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--tm-text-muted)',
                fontSize: 12,
              }}
            >
              Planning sub-agents…
            </div>
          ) : (
            <DagView agents={agents} selectedId={selectedId} onSelect={handleSelect} />
          )}
        </div>

        {/* Sub-agent list */}
        <div
          style={{
            width: 240,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              padding: '6px 12px 4px',
              flexShrink: 0,
              borderBottom: '1px solid var(--tm-border)',
            }}
          >
            <span className="fnd-section-label">Sub-agents</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto' }}>
            {agents.map((a, i) => {
              const color = STATUS_COLOR[a.status] ?? 'var(--tm-text-muted)'
              const isSel = selectedId === a.agentId
              return (
                <div
                  key={a.agentId}
                  onClick={() => handleSelect(a.agentId)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 8,
                    padding: '7px 12px',
                    cursor: 'pointer',
                    background: isSel ? 'var(--tm-bg-card)' : 'transparent',
                    borderLeft: `2px solid ${isSel ? 'var(--tm-accent)' : 'transparent'}`,
                    borderBottom: '1px solid var(--tm-border)',
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: `${color}18`,
                      border: `1px solid ${color}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                      color,
                      marginTop: 1,
                    }}
                  >
                    {i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--tm-text-primary)',
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {a.role}
                    </div>
                    <div style={{ fontSize: 10, color, marginTop: 1 }}>
                      {a.status === 'pending' && a.dependsOn.length > 0
                        ? `needs ${a.dependsOn
                            .map((d) => {
                              const idx = agents.findIndex((x) => x.agentId === d)
                              return idx >= 0 ? idx + 1 : d
                            })
                            .join(', ')}`
                        : a.status}
                    </div>
                  </div>
                  <span
                    className={`fnd-badge fnd-badge--${a.status}`}
                    style={{ fontSize: 9, flexShrink: 0 }}
                  >
                    {a.status}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Agent log pane — shown when an agent is selected */}
      {selectedAgent && (
        <AgentLogPane runId={run.id} agent={selectedAgent} onClose={() => setSelectedId(null)} />
      )}

      {/* Progress footer */}
      <div
        style={{
          padding: '6px 14px',
          borderTop: '1px solid var(--tm-border)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'var(--tm-bg-elevated)',
        }}
      >
        <div
          style={{
            flex: 1,
            height: 4,
            background: 'var(--tm-border)',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress * 100}%`,
              height: '100%',
              background: 'var(--tm-accent)',
              transition: 'width 0.4s',
              borderRadius: 2,
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', flexShrink: 0 }}>
          {doneCount}/{agents.length} done
        </span>
        <button
          className="fnd-btn fnd-btn--secondary fnd-btn--sm"
          style={{ color: 'var(--tm-danger)', flexShrink: 0, fontSize: 11 }}
          onClick={() => void abortAll()}
        >
          ✕ abort all
        </button>
      </div>
    </div>
  )
}
