import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  X,
  RotateCcw,
  Check,
  ChevronRight,
  MessageSquare,
  AlertCircle,
  Square,
  GitMerge,
  GitPullRequest,
  GitBranch,
} from 'lucide-react'
import './foundry.css'
import type { Run, RunLogEntry, SubAgent, FileChange, SensorResult } from '../types/foundry.types'
import { DiffViewer, type DiffAnnotation } from './DiffViewer'

interface Props {
  run: Run
  workspaceRoot: string
  onRetried: () => void
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

// Running is amber/yellow so incomplete work is visually distinct from done (green)
const STATUS_COLOR: Record<string, string> = {
  done: 'var(--tm-success)',
  running: 'var(--tm-warning)',
  gate: 'var(--tm-warning)',
  pending: 'var(--tm-text-muted)',
  rejected: 'var(--tm-danger)',
}

const STATUS_BG: Record<string, string> = {
  done: 'rgba(74,222,128,0.1)',
  running: 'rgba(250,204,21,0.08)',
  gate: 'rgba(250,204,21,0.12)',
  pending: 'var(--tm-bg-card)',
  rejected: 'rgba(239,68,68,0.1)',
}

function LogKindIcon({ kind }: { kind: string }) {
  if (kind === 'ok') return <Check size={10} />
  if (kind === 'error') return <AlertCircle size={10} />
  if (kind === 'agent') return <ChevronRight size={10} />
  return <span style={{ fontSize: 8, lineHeight: 1 }}>●</span>
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

function SpinnerDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        border: '2px solid transparent',
        borderTopColor: color,
        animation: 'fnd-spin 0.75s linear infinite',
        flexShrink: 0,
        boxSizing: 'border-box',
      }}
    />
  )
}

function FileRow({
  fc,
  selected,
  hasAnnotations,
  onClick,
}: {
  fc: FileChange
  selected: boolean
  hasAnnotations: boolean
  onClick: () => void
}) {
  const sigil = fc.status === 'new' ? 'A' : fc.status === 'deleted' ? 'D' : 'M'
  const sigilColor =
    fc.status === 'new'
      ? 'var(--tm-success)'
      : fc.status === 'deleted'
        ? 'var(--tm-danger)'
        : 'var(--tm-warning)'
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        cursor: 'pointer',
        background: selected ? 'var(--tm-bg-card)' : 'transparent',
        borderLeft: `2px solid ${selected ? 'var(--tm-accent)' : hasAnnotations ? 'var(--tm-warning)' : 'transparent'}`,
        borderBottom: '1px solid var(--tm-border)',
      }}
    >
      <span style={{ fontSize: 10, fontWeight: 700, color: sigilColor, width: 10, flexShrink: 0 }}>
        {sigil}
      </span>
      <span
        style={{
          fontSize: 11,
          color: 'var(--tm-text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {fc.filePath.split('/').pop()}
      </span>
      {hasAnnotations && <MessageSquare size={10} style={{ flexShrink: 0 }} />}
      <span style={{ fontSize: 10, color: 'var(--tm-text-muted)', flexShrink: 0 }}>
        {fc.linesAdded > 0 && <span style={{ color: 'var(--tm-success)' }}>+{fc.linesAdded}</span>}
        {fc.linesRemoved > 0 && (
          <span style={{ color: 'var(--tm-danger)' }}> -{fc.linesRemoved}</span>
        )}
      </span>
    </div>
  )
}

function DagView({
  agents,
  selectedId,
  onSelect,
  runError,
  runErrorSelected,
  onRunErrorClick,
}: {
  agents: SubAgent[]
  selectedId: string | null
  onSelect: (id: string) => void
  runError?: { message: string }
  runErrorSelected?: boolean
  onRunErrorClick?: () => void
}) {
  const tiers = useMemo(() => computeTiers(agents), [agents])

  const NODE_W = 140
  const NODE_H = 56
  const TIER_GAP = 90
  const ROW_GAP = 20
  const PAD = 24

  const maxRows = Math.max(...tiers.map((t) => t.length), 1)
  const baseTotalW = tiers.length * NODE_W + (tiers.length - 1) * TIER_GAP + PAD * 2
  const totalW = runError ? baseTotalW + NODE_W + TIER_GAP : baseTotalW
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
        {edges.map((e, i) => {
          const fp = positions.get(e.from)
          const tp = positions.get(e.to)
          if (!fp || !tp) return null
          const x1 = nodeX(fp.tier) + NODE_W
          const y1 = nodeY(fp.tier, fp.row) + NODE_H / 2
          const x2 = nodeX(tp.tier)
          const y2 = nodeY(tp.tier, tp.row) + NODE_H / 2
          const mx = (x1 + x2) / 2
          const fromAgent = agentMap.get(e.from)
          const toStatus = agentMap.get(e.to)?.status
          const isActive = toStatus === 'running' || toStatus === 'gate'
          const fromRejected = fromAgent?.status === 'rejected'
          return (
            <path
              key={i}
              d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={
                fromRejected
                  ? 'var(--tm-danger)'
                  : isActive
                    ? 'var(--tm-warning)'
                    : fromAgent?.status === 'done'
                      ? 'var(--tm-border-strong, #444)'
                      : 'var(--tm-border)'
              }
              strokeWidth={isActive ? 1.5 : 1}
              strokeDasharray={toStatus === 'pending' ? '5 3' : undefined}
              opacity={toStatus === 'pending' ? 0.4 : 0.75}
            />
          )
        })}

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
              <text
                x={bx + BADGE_R + 6}
                y={y + 20}
                fill="var(--tm-text-primary)"
                fontSize={12}
                fontWeight={500}
              >
                {a.status === 'rejected' ? '✗ ' : a.status === 'done' ? '✓ ' : ''}
                {a.role.length > 10 ? a.role.slice(0, 10) + '…' : a.role}
              </text>
              {a.status === 'running' && (
                <circle
                  cx={x + NODE_W - 14}
                  cy={y + NODE_H - 14}
                  r={5}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.5}
                  strokeDasharray="10 4"
                  strokeLinecap="round"
                >
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    from={`0 ${x + NODE_W - 14} ${y + NODE_H - 14}`}
                    to={`360 ${x + NODE_W - 14} ${y + NODE_H - 14}`}
                    dur="0.75s"
                    repeatCount="indefinite"
                  />
                </circle>
              )}
              <text x={x + 8} y={y + 40} fill={color} fontSize={10} opacity={0.9}>
                {a.status === 'done'
                  ? 'complete'
                  : a.status === 'running'
                    ? 'running…'
                    : a.status === 'gate'
                      ? 'awaiting gate'
                      : a.status === 'rejected'
                        ? 'failed — click to retry'
                        : a.dependsOn.length > 0
                          ? `waiting on ${a.dependsOn.map((d) => agentIndex(d)).join(', ')}`
                          : 'pending'}
              </text>
            </g>
          )
        })}
        {/* Synthetic "Run failed" terminal node — only when there's a run-level error */}
        {runError &&
          (() => {
            const lastTierIds = tiers[tiers.length - 1] ?? []
            const errTier = tiers.length
            const ex = PAD + errTier * (NODE_W + TIER_GAP)
            const ey = totalH / 2 - NODE_H / 2
            const BADGE_R = 10
            const bx = ex + BADGE_R + 6
            const by = ey + BADGE_R + 6
            const truncMsg =
              runError.message.length > 20 ? runError.message.slice(0, 20) + '…' : runError.message
            return (
              <g key="run-error-node">
                {/* Red edges from each last-tier agent to the error node */}
                {lastTierIds.map((id) => {
                  const fp = positions.get(id)
                  if (!fp) return null
                  const x1 = nodeX(fp.tier) + NODE_W
                  const y1 = nodeY(fp.tier, fp.row) + NODE_H / 2
                  const x2 = ex
                  const y2 = ey + NODE_H / 2
                  const mx = (x1 + x2) / 2
                  return (
                    <path
                      key={id}
                      d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                      fill="none"
                      stroke="var(--tm-danger)"
                      strokeWidth={1.5}
                      opacity={0.7}
                    />
                  )
                })}

                {/* Error node */}
                <g onClick={onRunErrorClick} style={{ cursor: 'pointer' }}>
                  <rect
                    x={ex}
                    y={ey}
                    width={NODE_W}
                    height={NODE_H}
                    rx={6}
                    ry={6}
                    fill="rgba(239,68,68,0.13)"
                    stroke="var(--tm-danger)"
                    strokeWidth={runErrorSelected ? 2 : 1.5}
                  />
                  <circle
                    cx={bx}
                    cy={by}
                    r={BADGE_R}
                    fill="rgba(239,68,68,0.22)"
                    stroke="var(--tm-danger)"
                    strokeWidth={1}
                  />
                  <text
                    x={bx}
                    y={by + 4}
                    textAnchor="middle"
                    fill="var(--tm-danger)"
                    fontSize={11}
                    fontWeight={700}
                  >
                    ✗
                  </text>
                  <text
                    x={bx + BADGE_R + 6}
                    y={ey + 20}
                    fill="var(--tm-danger)"
                    fontSize={12}
                    fontWeight={600}
                  >
                    Run failed
                  </text>
                  <text x={ex + 8} y={ey + 40} fill="var(--tm-danger)" fontSize={10} opacity={0.8}>
                    {truncMsg}
                  </text>
                </g>
              </g>
            )
          })()}
      </svg>

      <div
        style={{
          padding: '4px 12px 8px',
          display: 'flex',
          gap: 14,
          fontSize: 10,
          color: 'var(--tm-text-muted)',
        }}
      >
        {(['done', 'running', 'rejected', 'pending'] as const).map((s) => (
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
  workspaceRoot,
  canRetry,
  onRetried,
  onClose,
}: {
  runId: string
  agent: SubAgent
  workspaceRoot: string
  canRetry: boolean
  onRetried: () => void
  onClose: () => void
}) {
  const [logs, setLogs] = useState<RunLogEntry[]>([])
  const [feedback, setFeedback] = useState('')
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void invoke('foundry:subagent-logs', { runId, agentId: agent.agentId, workspaceRoot }).then(
      (r) => {
        setLogs((r.entries as RunLogEntry[]) ?? [])
      }
    )
    const unsub = window.electronAPI.extensionBridge.on('foundry:subagent-log', (data) => {
      const {
        runId: rid,
        agentId,
        entry,
      } = data as {
        runId: string
        agentId: string
        entry: RunLogEntry
      }
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

  async function handleRetry() {
    setRetrying(true)
    setRetryError(null)
    try {
      const res = await invoke('foundry:orchestrate-retry-from', {
        runId,
        workspaceRoot,
        agentId: agent.agentId,
        feedback: feedback.trim() || undefined,
      })
      if ('error' in res) throw new Error(res.error as string)
      setFeedback('')
      onRetried()
    } catch (err) {
      setRetryError(String(err))
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      style={{
        height: 260,
        flexShrink: 0,
        borderTop: '1px solid var(--tm-border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--tm-bg)',
      }}
    >
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
        {agent.status === 'running' ? (
          <SpinnerDot color={color} />
        ) : (
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }}
          />
        )}
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
          <X size={14} />
        </button>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          fontFamily: 'var(--tm-font-mono)',
          fontSize: 11,
          padding: '4px 0',
        }}
      >
        {/* Failures summary — pinned at top if any error lines exist */}
        {logs.filter((e) => e.kind === 'error').length > 0 &&
          (() => {
            const errorLogs = logs.filter((e) => e.kind === 'error')
            return (
              <div
                style={{
                  margin: '4px 8px 6px',
                  background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.35)',
                  borderLeft: '3px solid var(--tm-danger)',
                  borderRadius: 4,
                  padding: '6px 10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <AlertCircle size={12} style={{ color: 'var(--tm-danger)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--tm-danger)' }}>
                    {errorLogs.length} failure{errorLogs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {errorLogs.map((entry, i) => {
                  const time = new Date(entry.ts).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })
                  return (
                    <div key={i} style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                      <span style={{ color: 'var(--tm-text-muted)', flexShrink: 0, fontSize: 10 }}>
                        {time}
                      </span>
                      <span
                        style={{
                          flex: 1,
                          color: 'var(--tm-danger)',
                          fontSize: 10,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          opacity: 0.9,
                        }}
                      >
                        {entry.message}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })()}

        {logs.length === 0 ? (
          <div style={{ padding: '8px 14px', color: 'var(--tm-text-muted)' }}>
            {agent.status === 'pending'
              ? agent.dependsOn.length > 0
                ? 'Waiting for dependencies…'
                : 'Queued…'
              : 'No output yet.'}
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
                style={{
                  display: 'flex',
                  gap: 6,
                  padding: '1px 14px',
                  ...(entry.kind === 'error'
                    ? {
                        background: 'rgba(239,68,68,0.07)',
                        borderLeft: '2px solid var(--tm-danger)',
                        paddingLeft: 12,
                      }
                    : {}),
                }}
              >
                <span style={{ color: 'var(--tm-text-muted)', flexShrink: 0, fontSize: 10 }}>
                  {time}
                </span>
                <span style={{ flexShrink: 0, width: 12, display: 'flex', alignItems: 'center' }}>
                  <LogKindIcon kind={entry.kind} />
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

      {/* Feedback + re-run — shown when the run is paused and this agent can be retried */}
      {canRetry && (
        <div
          style={{
            borderTop: '1px solid var(--tm-border)',
            padding: '8px 12px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            background: 'var(--tm-bg-card)',
          }}
        >
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={`Feedback for "${agent.role}" (optional). All dependent steps will re-run.`}
            rows={2}
            style={{
              width: '100%',
              resize: 'none',
              background: 'var(--tm-bg-input)',
              color: 'var(--tm-text)',
              border: '1px solid var(--tm-border)',
              borderRadius: 4,
              padding: '5px 8px',
              fontSize: 11,
              fontFamily: 'inherit',
              boxSizing: 'border-box',
            }}
          />
          {retryError && (
            <span style={{ fontSize: 11, color: 'var(--tm-danger)' }}>{retryError}</span>
          )}
          <button
            className="fnd-btn fnd-btn--primary fnd-btn--sm"
            disabled={retrying}
            onClick={() => void handleRetry()}
            style={{ alignSelf: 'flex-end' }}
          >
            {retrying ? (
              '…'
            ) : (
              <>
                <RotateCcw size={11} /> {`Re-run "${agent.role}" + downstream`}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

export function OrchestrationView({ run, workspaceRoot, onRetried }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agents, setAgents] = useState<SubAgent[]>(run.subAgents ?? [])
  const [aborting, setAborting] = useState(false)
  const [mergeInfo, setMergeInfo] = useState<{
    defaultBranch: string
    remoteUrl: string | null
  } | null>(null)
  const [merging, setMerging] = useState<'merge' | 'pr' | 'keep' | null>(null)
  const [mergeError, setMergeError] = useState<string | null>(null)
  const [removeWorktreeAfterMerge, setRemoveWorktreeAfterMerge] = useState(false)
  const [fileChanges, setFileChanges] = useState<FileChange[]>(run.fileChanges ?? [])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState('')
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [annotations, setAnnotations] = useState<DiffAnnotation[]>([])
  const [sendingFeedback, setSendingFeedback] = useState(false)
  const [runErrorLogs, setRunErrorLogs] = useState<RunLogEntry[]>([])
  const [showRunError, setShowRunError] = useState(false)
  const [sensorResults, setSensorResults] = useState<SensorResult[]>(run.sensorResults ?? [])
  const [runningChecks, setRunningChecks] = useState(false)

  // Derived status — declared before effects so they can be used in dependency arrays
  const isTerminal = run.status === 'done' || run.status === 'rejected' || run.status === 'aborted'
  const isGate = run.status === 'gate'
  const isPausedError = run.status === 'paused-error'
  const allAgentsDone =
    agents.length > 0 && agents.every((a) => a.status === 'done' || a.status === 'rejected')
  const hasRejectedAgents = agents.some((a) => a.status === 'rejected')
  const agentsWithErrors = agents.filter((a) => a.status === 'rejected')
  const hasRunLevelFailure =
    isPausedError && runErrorLogs.length > 0 && agentsWithErrors.length === 0
  const totalFailureCount = agentsWithErrors.length + (hasRunLevelFailure ? 1 : 0)

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('foundry:run-status-changed', () => {
      void invoke('foundry:run-list', { workspaceRoot }).then((r) => {
        const runs =
          (r.runs as Array<{
            id: string
            subAgents?: SubAgent[]
            fileChanges?: FileChange[]
            sensorResults?: SensorResult[]
          }>) ?? []
        const updated = runs.find((x) => x.id === run.id)
        if (updated?.subAgents) setAgents(updated.subAgents)
        if (updated?.fileChanges) setFileChanges(updated.fileChanges)
        if (updated?.sensorResults) setSensorResults(updated.sensorResults)
      })
    })
    return () => unsub()
  }, [run.id, workspaceRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load run-level error logs when the run is paused (sensor fail, provider error, etc.)
  useEffect(() => {
    if (!isPausedError) return
    void invoke('foundry:run-logs', { runId: run.id, workspaceRoot }).then((r) => {
      const errors = ((r.entries as RunLogEntry[]) ?? []).filter((e) => e.kind === 'error')
      setRunErrorLogs(errors)
    })
  }, [isPausedError]) // eslint-disable-line react-hooks/exhaustive-deps

  async function selectFile(filePath: string) {
    setSelectedFile(filePath)
    setLoadingDiff(true)
    try {
      const result = await invoke('foundry:git-diff-file', { workspaceRoot, filePath })
      setDiffContent((result.unifiedDiff as string) ?? '')
    } finally {
      setLoadingDiff(false)
    }
  }

  function addAnnotation(lineIndices: number[], text: string) {
    if (!selectedFile) return
    setAnnotations((prev) => [
      ...prev,
      { id: crypto.randomUUID(), filePath: selectedFile, lineIndices, text },
    ])
  }

  function removeAnnotation(id: string) {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }

  async function sendFeedback() {
    if (annotations.length === 0 || !selectedId) return
    const lines: string[] = ['Code review feedback:\n']
    const byFile = new Map<string, DiffAnnotation[]>()
    for (const ann of annotations) {
      const arr = byFile.get(ann.filePath) ?? []
      arr.push(ann)
      byFile.set(ann.filePath, arr)
    }
    for (const [fp, anns] of byFile) {
      lines.push(`File: ${fp.split('/').pop()}`)
      for (const ann of anns) {
        const lo = ann.lineIndices[0] + 1
        const hi = ann.lineIndices[ann.lineIndices.length - 1] + 1
        const loc = lo === hi ? `Line ${lo}` : `Lines ${lo}–${hi}`
        lines.push(`  ${loc}: ${ann.text}`)
      }
      lines.push('')
    }
    const feedback = lines.join('\n')
    setSendingFeedback(true)
    try {
      const res = await invoke('foundry:orchestrate-retry-from', {
        runId: run.id,
        workspaceRoot,
        agentId: selectedId,
        feedback,
      })
      if (!('error' in res)) {
        setAnnotations([])
        onRetried()
      }
    } finally {
      setSendingFeedback(false)
    }
  }

  // Load merge info once when gate opens or paused-error with all agents done
  useEffect(() => {
    const shouldLoad = isGate || (isPausedError && allAgentsDone && !hasRejectedAgents)
    if (shouldLoad && !mergeInfo) {
      void invoke('foundry:run-get-merge-info', { workspaceRoot }).then((r) => {
        if (!('error' in r)) {
          setMergeInfo({
            defaultBranch: (r.defaultBranch as string) ?? 'main',
            remoteUrl: (r.remoteUrl as string | null) ?? null,
          })
        }
      })
    }
  }, [isGate, isPausedError, allAgentsDone]) // eslint-disable-line react-hooks/exhaustive-deps

  async function mergeToDefault() {
    setMerging('merge')
    setMergeError(null)
    try {
      const res = await invoke('foundry:run-gate-decide', {
        runId: run.id,
        workspaceRoot,
        decision: 'approve',
        removeWorktree: removeWorktreeAfterMerge,
      })
      if ('error' in res) throw new Error(res.error as string)
      onRetried()
    } catch (err) {
      setMergeError(String(err))
    } finally {
      setMerging(null)
    }
  }

  async function createPR() {
    setMerging('pr')
    setMergeError(null)
    try {
      const res = await invoke('foundry:run-create-pr', { runId: run.id, workspaceRoot })
      if ('error' in res) throw new Error(res.error as string)
      await invoke('foundry:run-gate-decide', { runId: run.id, workspaceRoot, decision: 'approve' })
      onRetried()
    } catch (err) {
      setMergeError(String(err))
    } finally {
      setMerging(null)
    }
  }

  async function keepBranch() {
    setMerging('keep')
    setMergeError(null)
    try {
      const res = await invoke('foundry:run-gate-decide', {
        runId: run.id,
        workspaceRoot,
        decision: 'approve',
        skipMerge: true,
      })
      if ('error' in res) throw new Error(res.error as string)
      onRetried()
    } catch (err) {
      setMergeError(String(err))
    } finally {
      setMerging(null)
    }
  }

  async function abort() {
    setAborting(true)
    try {
      await invoke('foundry:run-abort', { runId: run.id, workspaceRoot })
      onRetried()
    } finally {
      setAborting(false)
    }
  }

  async function rerunSensors() {
    setRunningChecks(true)
    try {
      const r = await invoke('foundry:run-sensors', { runId: run.id, workspaceRoot })
      if ('results' in r) setSensorResults(r.results as SensorResult[])
      // run-status-changed fires automatically via broadcastAndSave — onRetried picks it up
      onRetried()
    } finally {
      setRunningChecks(false)
    }
  }

  const selectedAgent = agents.find((a) => a.agentId === selectedId) ?? null
  const doneCount = agents.filter((a) => a.status === 'done').length
  const progress = agents.length > 0 ? doneCount / agents.length : 0

  function handleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id))
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
        <span
          className={`fnd-badge fnd-badge--${run.status === 'paused-error' ? 'rejected' : isGate ? 'gate' : isTerminal ? 'done' : 'running'}`}
          style={{ fontSize: 10 }}
        >
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
        {!isTerminal && (
          <button
            className="fnd-btn fnd-btn--secondary fnd-btn--sm"
            style={{ flexShrink: 0 }}
            disabled={aborting}
            onClick={() => void abort()}
          >
            <Square size={11} />
            {aborting ? 'Stopping…' : 'Stop'}
          </button>
        )}
      </div>

      {/* Run-level error banner */}
      {isPausedError && (
        <div
          style={{
            padding: '6px 14px',
            background: 'rgba(239,68,68,0.14)',
            borderBottom: '2px solid rgba(239,68,68,0.4)',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={13} style={{ color: 'var(--tm-danger)', flexShrink: 0 }} />
          <span style={{ fontSize: 11, color: 'var(--tm-danger)', fontWeight: 600, flex: 1 }}>
            {agentsWithErrors.length > 0
              ? `${agentsWithErrors.length} step${agentsWithErrors.length !== 1 ? 's' : ''} failed — click the red step${agentsWithErrors.length !== 1 ? 's' : ''} to inspect and retry.`
              : hasRunLevelFailure
                ? (runErrorLogs[runErrorLogs.length - 1]?.message ?? 'Run failed.')
                : 'Run paused — retry to continue.'}
          </span>
        </div>
      )}

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
            <DagView
              agents={agents}
              selectedId={selectedId}
              onSelect={handleSelect}
              runError={
                hasRunLevelFailure
                  ? { message: runErrorLogs[runErrorLogs.length - 1]?.message ?? 'Run failed' }
                  : undefined
              }
              runErrorSelected={showRunError}
              onRunErrorClick={() => {
                setShowRunError((v) => !v)
                setSelectedId(null)
              }}
            />
          )}
        </div>

        {/* Files + diff panel */}
        <div
          style={{
            width: 420,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRight: '1px solid var(--tm-border)',
          }}
        >
          {/* File list header */}
          <div
            style={{
              padding: '6px 10px 4px',
              flexShrink: 0,
              borderBottom: '1px solid var(--tm-border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span className="fnd-section-label" style={{ flex: 1 }}>
              Changed files ({fileChanges.length})
            </span>
            {annotations.length > 0 && (
              <span style={{ fontSize: 10, color: 'var(--tm-warning)' }}>
                {annotations.length} note{annotations.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* File list */}
          {fileChanges.length === 0 ? (
            <div
              style={{
                padding: '8px 10px',
                color: 'var(--tm-text-muted)',
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {run.status === 'running'
                ? 'Changes appear here as agents work.'
                : 'No file changes.'}
            </div>
          ) : (
            <div
              style={{
                flexShrink: 0,
                maxHeight: 148,
                overflow: 'auto',
                borderBottom: '1px solid var(--tm-border)',
              }}
            >
              {fileChanges.map((fc) => {
                const fileAnns = annotations.filter((a) => a.filePath === fc.filePath)
                return (
                  <FileRow
                    key={fc.filePath}
                    fc={fc}
                    selected={selectedFile === fc.filePath}
                    hasAnnotations={fileAnns.length > 0}
                    onClick={() => void selectFile(fc.filePath)}
                  />
                )
              })}
            </div>
          )}

          {/* Diff viewer */}
          <div style={{ flex: 1, overflow: 'auto', background: 'var(--tm-bg-surface)' }}>
            {loadingDiff ? (
              <div style={{ padding: 12, color: 'var(--tm-text-muted)', fontSize: 11 }}>
                Loading diff…
              </div>
            ) : (
              <DiffViewer
                diff={diffContent}
                filePath={selectedFile ?? undefined}
                annotations={annotations.filter((a) => a.filePath === selectedFile)}
                onAnnotate={addAnnotation}
                onRemoveAnnotation={removeAnnotation}
              />
            )}
          </div>

          {/* Feedback footer — shown when there are annotations and run is paused */}
          {annotations.length > 0 && isPausedError && (
            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid var(--tm-border)',
                padding: '8px 10px',
                background: 'var(--tm-bg-elevated)',
              }}
            >
              {selectedId ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', flex: 1 }}>
                    {annotations.length} annotation{annotations.length !== 1 ? 's' : ''} ready
                  </span>
                  <button
                    className="fnd-btn fnd-btn--primary fnd-btn--sm"
                    disabled={sendingFeedback}
                    onClick={() => void sendFeedback()}
                    style={{ fontSize: 10 }}
                  >
                    {sendingFeedback ? (
                      '…'
                    ) : (
                      <>
                        <RotateCcw size={11} />{' '}
                        {`Send feedback to "${agents.find((a) => a.agentId === selectedId)?.role ?? selectedId}"`}
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>
                  Select an agent in the list to send feedback →
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sub-agent list */}
        <div
          style={{
            width: 200,
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
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
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
                  {a.status === 'running' ? (
                    <div style={{ marginTop: 2 }}>
                      <SpinnerDot color={color} />
                    </div>
                  ) : (
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
                      {a.status === 'rejected' ? <X size={10} /> : i + 1}
                    </div>
                  )}
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
                        : a.status === 'rejected'
                          ? 'failed — click to retry'
                          : a.status}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Failures section — agent rejections + run-level errors */}
          {totalFailureCount > 0 && (
            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid var(--tm-border)',
                maxHeight: 220,
                overflow: 'auto',
              }}
            >
              <div
                style={{
                  padding: '5px 12px 3px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  borderBottom: '1px solid var(--tm-border)',
                }}
              >
                <AlertCircle size={10} style={{ color: 'var(--tm-danger)', flexShrink: 0 }} />
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--tm-danger)',
                  }}
                >
                  Failures ({totalFailureCount})
                </span>
              </div>

              {/* Agent-level failures */}
              {agentsWithErrors.map((a) => {
                const isSel = selectedId === a.agentId
                return (
                  <div
                    key={a.agentId}
                    onClick={() => {
                      handleSelect(a.agentId)
                      setShowRunError(false)
                    }}
                    style={{
                      padding: '5px 10px',
                      cursor: 'pointer',
                      background: isSel ? 'var(--tm-bg-card)' : 'transparent',
                      borderLeft: `2px solid ${isSel ? 'var(--tm-accent)' : 'transparent'}`,
                      borderBottom: '1px solid var(--tm-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <X size={9} style={{ color: 'var(--tm-danger)', flexShrink: 0 }} />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--tm-text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        {a.role}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--tm-text-muted)',
                        marginTop: 2,
                        paddingLeft: 14,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      step rejected — click to retry
                    </div>
                  </div>
                )
              })}

              {/* Run-level failure entry */}
              {hasRunLevelFailure &&
                runErrorLogs.map((entry, i) => (
                  <div
                    key={i}
                    onClick={() => {
                      setShowRunError((v) => !v)
                      setSelectedId(null)
                    }}
                    style={{
                      padding: '5px 10px',
                      cursor: 'pointer',
                      background: showRunError ? 'var(--tm-bg-card)' : 'transparent',
                      borderLeft: `2px solid ${showRunError ? 'var(--tm-accent)' : 'transparent'}`,
                      borderBottom: '1px solid var(--tm-border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <X size={9} style={{ color: 'var(--tm-danger)', flexShrink: 0 }} />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 500,
                          color: 'var(--tm-text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          flex: 1,
                        }}
                      >
                        Run error
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--tm-text-muted)',
                        marginTop: 2,
                        paddingLeft: 14,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {entry.message}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent log pane */}
      {selectedAgent && !showRunError && (
        <AgentLogPane
          runId={run.id}
          agent={selectedAgent}
          workspaceRoot={workspaceRoot}
          canRetry={isPausedError}
          onRetried={onRetried}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Run-error log pane — shown when user clicks the red "Run failed" block */}
      {showRunError && hasRunLevelFailure && (
        <div
          style={{
            height: 240,
            flexShrink: 0,
            borderTop: '1px solid var(--tm-border)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--tm-bg)',
          }}
        >
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
            <AlertCircle size={12} style={{ color: 'var(--tm-danger)', flexShrink: 0 }} />
            <span
              style={{ fontSize: 12, fontWeight: 500, color: 'var(--tm-text-primary)', flex: 1 }}
            >
              Run error log
            </span>
            <span className="fnd-badge fnd-badge--rejected" style={{ fontSize: 10 }}>
              failed
            </span>
            <button
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--tm-text-muted)',
                cursor: 'pointer',
                padding: '0 4px',
              }}
              onClick={() => setShowRunError(false)}
            >
              <X size={14} />
            </button>
          </div>
          <div
            style={{
              flex: 1,
              overflow: 'auto',
              fontFamily: 'var(--tm-font-mono)',
              fontSize: 11,
              padding: '4px 0',
            }}
          >
            {runErrorLogs.map((entry, i) => {
              const time = new Date(entry.ts).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 6,
                    padding: '1px 14px',
                    background: 'rgba(239,68,68,0.07)',
                    borderLeft: '2px solid var(--tm-danger)',
                    paddingLeft: 12,
                  }}
                >
                  <span style={{ color: 'var(--tm-text-muted)', flexShrink: 0, fontSize: 10 }}>
                    {time}
                  </span>
                  <AlertCircle
                    size={10}
                    style={{ color: 'var(--tm-danger)', flexShrink: 0, marginTop: 1 }}
                  />
                  <span
                    style={{
                      flex: 1,
                      color: 'var(--tm-danger)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                  >
                    {entry.message}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Sensor results + re-run button */}
          {sensorResults.length > 0 && (
            <div style={{ flexShrink: 0, borderTop: '1px solid var(--tm-border)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '4px 12px 2px',
                }}
              >
                <span className="fnd-section-label" style={{ padding: 0 }}>
                  Sensor results
                </span>
                <button
                  className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                  style={{ fontSize: 10 }}
                  disabled={runningChecks}
                  onClick={() => void rerunSensors()}
                >
                  {runningChecks ? (
                    'Running…'
                  ) : (
                    <>
                      <RotateCcw size={10} /> Re-run sensors
                    </>
                  )}
                </button>
              </div>
              {sensorResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '3px 12px',
                    borderTop: '1px solid var(--tm-border)',
                    fontSize: 11,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      color: r.pass ? 'var(--tm-success)' : 'var(--tm-danger)',
                    }}
                  >
                    {r.pass ? <Check size={12} /> : <X size={12} />}
                  </span>
                  <span style={{ flex: 1, color: 'var(--tm-text-secondary)' }}>{r.sensorName}</span>
                  <span style={{ color: 'var(--tm-text-muted)', fontSize: 10 }}>
                    {r.durationMs}ms
                  </span>
                  {!r.pass && (r.stderrExcerpt || r.stdoutExcerpt) && (
                    <span
                      style={{
                        color: 'var(--tm-danger)',
                        fontFamily: 'monospace',
                        fontSize: 10,
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {(r.stderrExcerpt || r.stdoutExcerpt).split('\n')[0]}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Re-run button shown even when no prior sensor results */}
          {sensorResults.length === 0 && (
            <div
              style={{
                flexShrink: 0,
                borderTop: '1px solid var(--tm-border)',
                padding: '6px 12px',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <button
                className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                style={{ fontSize: 10 }}
                disabled={runningChecks}
                onClick={() => void rerunSensors()}
              >
                {runningChecks ? (
                  'Running…'
                ) : (
                  <>
                    <RotateCcw size={10} /> Re-run sensors
                  </>
                )}
              </button>
            </div>
          )}
        </div>
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
              background: agents.some((a) => a.status === 'rejected')
                ? 'var(--tm-danger)'
                : 'var(--tm-success)',
              transition: 'width 0.4s',
              borderRadius: 2,
            }}
          />
        </div>
        <span style={{ fontSize: 11, color: 'var(--tm-text-muted)', flexShrink: 0 }}>
          {doneCount}/{agents.length} done
          {agents.some((a) => a.status === 'rejected') &&
            ` · ${agents.filter((a) => a.status === 'rejected').length} failed`}
        </span>
      </div>

      {/* Gate / Merge panel — shown when all agents complete or run is paused-error with all agents done */}
      {(isGate || (isPausedError && allAgentsDone && !hasRejectedAgents)) && (
        <div
          style={{
            flexShrink: 0,
            borderTop: '2px solid var(--tm-accent)',
            background: 'var(--tm-bg-elevated)',
            padding: '12px 14px',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--tm-text-primary)',
              marginBottom: 10,
            }}
          >
            All agents complete — what would you like to do with the changes?
          </div>

          {mergeError && (
            <div style={{ fontSize: 11, color: 'var(--tm-danger)', marginBottom: 8 }}>
              {mergeError}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              className="fnd-btn fnd-btn--primary fnd-btn--sm"
              style={{ justifyContent: 'flex-start' }}
              disabled={merging !== null}
              onClick={() => void mergeToDefault()}
            >
              <GitMerge size={13} />
              {merging === 'merge'
                ? 'Merging…'
                : `Merge to ${mergeInfo?.defaultBranch ?? 'default branch'}`}
            </button>

            {mergeInfo?.remoteUrl && (
              <button
                className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                style={{ justifyContent: 'flex-start' }}
                disabled={merging !== null}
                onClick={() => void createPR()}
              >
                <GitPullRequest size={13} />
                {merging === 'pr' ? 'Creating PR…' : 'Create Pull Request'}
              </button>
            )}

            <button
              className="fnd-btn fnd-btn--secondary fnd-btn--sm"
              style={{ justifyContent: 'flex-start', color: 'var(--tm-text-muted)' }}
              disabled={merging !== null}
              onClick={() => void keepBranch()}
            >
              <GitBranch size={13} />
              {merging === 'keep' ? '…' : `Keep changes on branch (${run.featureBranch})`}
            </button>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: 'var(--tm-text-muted)',
                cursor: 'pointer',
                marginTop: 2,
              }}
            >
              <input
                type="checkbox"
                checked={removeWorktreeAfterMerge}
                onChange={(e) => setRemoveWorktreeAfterMerge(e.target.checked)}
              />
              Remove worktree after merge
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
