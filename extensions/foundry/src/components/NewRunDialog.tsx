import React, { useEffect, useRef, useState } from 'react'
import './foundry.css'

type RunMode = 'spec-to-code' | 'orchestrate' | 'co-pilot'

// ─── Inline DAG builder ───────────────────────────────────────────────────────

interface DagAgent {
  id: string
  role: string
  task: string
  dependsOn: string[]
}

function DagBuilder({
  agents,
  onChange,
}: {
  agents: DagAgent[]
  onChange: (agents: DagAgent[]) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [drawingFrom, setDrawingFrom] = useState<string | null>(null)
  const editRef = useRef<HTMLInputElement | null>(null)

  function addAgent() {
    const id = `agent-${Date.now()}`
    onChange([...agents, { id, role: 'new agent', task: '', dependsOn: [] }])
    setEditingId(id)
  }

  function removeAgent(id: string) {
    onChange(
      agents
        .filter((a) => a.id !== id)
        .map((a) => ({ ...a, dependsOn: a.dependsOn.filter((d) => d !== id) }))
    )
    if (editingId === id) setEditingId(null)
    if (drawingFrom === id) setDrawingFrom(null)
  }

  function updateAgent(id: string, patch: Partial<DagAgent>) {
    onChange(agents.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  function toggleDep(fromId: string, toId: string) {
    if (fromId === toId) return
    const target = agents.find((a) => a.id === toId)
    if (!target) return
    const hasDep = target.dependsOn.includes(fromId)
    updateAgent(toId, {
      dependsOn: hasDep
        ? target.dependsOn.filter((d) => d !== fromId)
        : [...target.dependsOn, fromId],
    })
  }

  const editingAgent = agents.find((a) => a.id === editingId) ?? null

  return (
    <div
      style={{
        border: '1px solid var(--tm-border)',
        borderRadius: 'var(--tm-radius-xs)',
        overflow: 'hidden',
        marginBottom: 14,
      }}
    >
      {/* Agent chips */}
      <div
        style={{
          padding: '10px 12px',
          background: 'var(--tm-bg-card)',
          borderBottom: agents.length > 0 ? '1px solid var(--tm-border)' : undefined,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          alignItems: 'center',
          minHeight: 44,
        }}
      >
        {agents.map((a, i) => {
          const isDrawSrc = drawingFrom === a.id
          const isDrawTarget = drawingFrom && drawingFrom !== a.id
          const isDepOfSrc = drawingFrom
            ? agents.find((x) => x.id === a.id)?.dependsOn.includes(drawingFrom)
            : false
          return (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 8px',
                borderRadius: 'var(--tm-radius-xs)',
                background: isDrawSrc
                  ? 'rgba(92,107,192,0.2)'
                  : isDepOfSrc
                    ? 'rgba(74,222,128,0.1)'
                    : 'var(--tm-bg-elevated)',
                border: `1px solid ${isDrawSrc ? 'var(--tm-accent)' : isDrawTarget ? 'rgba(92,107,192,0.4)' : 'var(--tm-border)'}`,
                cursor: isDrawTarget ? 'cell' : 'default',
                fontSize: 12,
              }}
              onClick={() => {
                if (drawingFrom) {
                  toggleDep(drawingFrom, a.id)
                  setDrawingFrom(null)
                } else {
                  setEditingId(editingId === a.id ? null : a.id)
                }
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'rgba(92,107,192,0.2)',
                  border: '1px solid var(--tm-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'var(--tm-accent)',
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </span>
              <span style={{ color: 'var(--tm-text-primary)' }}>{a.role}</span>
              {a.dependsOn.length > 0 && (
                <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
                  ←{' '}
                  {a.dependsOn
                    .map((d) => {
                      const idx = agents.findIndex((x) => x.id === d)
                      return idx >= 0 ? idx + 1 : '?'
                    })
                    .join(',')}
                </span>
              )}
              <button
                title="Draw dependency from this agent"
                style={{
                  background: 'none',
                  border: '1px solid var(--tm-border)',
                  borderRadius: 3,
                  color: 'var(--tm-text-muted)',
                  cursor: 'pointer',
                  padding: '0 3px',
                  fontSize: 10,
                  lineHeight: 1.4,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setDrawingFrom(isDrawSrc ? null : a.id)
                }}
              >
                {isDrawSrc ? '✕' : '→'}
              </button>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--tm-text-muted)',
                  cursor: 'pointer',
                  padding: '0 2px',
                  fontSize: 13,
                  lineHeight: 1,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  removeAgent(a.id)
                }}
              >
                ×
              </button>
            </div>
          )
        })}
        <button
          className="fnd-btn fnd-btn--secondary fnd-btn--sm"
          style={{ fontSize: 11 }}
          onClick={addAgent}
        >
          + Add agent
        </button>
        {drawingFrom && (
          <span style={{ fontSize: 11, color: 'var(--tm-accent)', marginLeft: 4 }}>
            Click another agent to set it as downstream ↓ (or ✕ to cancel)
          </span>
        )}
      </div>

      {/* Edit pane for selected agent */}
      {editingAgent && (
        <div
          style={{
            padding: '10px 12px',
            background: 'var(--tm-bg)',
            borderTop: '1px solid var(--tm-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: '0 0 140px' }}>
              <div className="fnd-section-label" style={{ marginBottom: 4, fontSize: 10 }}>
                Role name
              </div>
              <input
                ref={editRef}
                className="fnd-sensor-cmd-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={editingAgent.role}
                onChange={(e) => updateAgent(editingAgent.id, { role: e.target.value })}
                placeholder="e.g. schema agent"
                autoFocus
              />
            </div>
            <div style={{ flex: 1 }}>
              <div className="fnd-section-label" style={{ marginBottom: 4, fontSize: 10 }}>
                Task description
              </div>
              <input
                className="fnd-sensor-cmd-input"
                style={{ width: '100%', boxSizing: 'border-box' }}
                value={editingAgent.task}
                onChange={(e) => updateAgent(editingAgent.id, { task: e.target.value })}
                placeholder="What should this agent do?"
              />
            </div>
          </div>
          {editingAgent.dependsOn.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--tm-text-muted)' }}>
              Depends on:{' '}
              {editingAgent.dependsOn.map((d) => {
                const dep = agents.find((a) => a.id === d)
                return dep ? (
                  <span key={d} style={{ color: 'var(--tm-text-secondary)', marginRight: 6 }}>
                    {dep.role}{' '}
                    <button
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--tm-danger)',
                        fontSize: 11,
                        padding: 0,
                      }}
                      onClick={() =>
                        updateAgent(editingAgent.id, {
                          dependsOn: editingAgent.dependsOn.filter((x) => x !== d),
                        })
                      }
                    >
                      ×
                    </button>
                  </span>
                ) : null
              })}
            </div>
          )}
        </div>
      )}

      {agents.length === 0 && (
        <div
          style={{
            padding: '12px',
            color: 'var(--tm-text-muted)',
            fontSize: 11,
            textAlign: 'center',
          }}
        >
          Add agents and draw dependencies between them, or just describe the task and let the AI
          plan it.
        </div>
      )}
    </div>
  )
}

interface SavedProvider {
  id: string
  type: string
  label: string
  model: string
}

interface DetectedContext {
  hasAgentsMd: boolean
  agentsMdPath: string
  sensorCount: number
}

interface Props {
  repoRoot: string
  onClose: () => void
  onLaunched: () => void
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

async function pickFile(filters?: Array<{ name: string; extensions: string[] }>) {
  const res = await invoke('foundry:open-file', { filters })
  if ('filePath' in res) return res.filePath as string
  return null
}

const MD_FILTER = [{ name: 'Markdown / text', extensions: ['md', 'txt', 'mdx'] }]

const MODE_CARDS: { id: RunMode; icon: string; label: string; desc: string }[] = [
  {
    id: 'spec-to-code',
    icon: '⊞',
    label: 'Spec-to-code',
    desc: 'Spec drives code generation with approval gates',
  },
  {
    id: 'orchestrate',
    icon: '✦',
    label: 'Orchestrate',
    desc: 'Decompose task across multiple sub-agents',
  },
  {
    id: 'co-pilot',
    icon: '⊡',
    label: 'Co-pilot',
    desc: 'Continuous back-and-forth, no hard gates',
  },
]

export function NewRunDialog({ repoRoot, onClose, onLaunched }: Props) {
  const [mode, setMode] = useState<RunMode>('spec-to-code')
  const [specPath, setSpecPath] = useState('')
  const [taskDesc, setTaskDesc] = useState('')
  const [dagAgents, setDagAgents] = useState<DagAgent[]>([])
  const [prompt, setPrompt] = useState('')
  const [providers, setProviders] = useState<SavedProvider[]>([])
  const [providerId, setProviderId] = useState('')
  const [model, setModel] = useState('')
  const [maxIterations, setMaxIterations] = useState(3)
  const [launching, setLaunching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<DetectedContext | null>(null)

  useEffect(() => {
    void invoke('foundry:provider-list', { workspaceRoot: repoRoot }).then((res) => {
      const list = (res.providers as SavedProvider[]) ?? []
      setProviders(list)
      if (list.length > 0 && !providerId) {
        setProviderId(list[0].id)
        setModel(list[0].model)
      }
    })
    // Auto-detect context: AGENTS.md + harness sensor count
    void (async () => {
      try {
        const harnessRes = await invoke('foundry:harness-read', { workspaceRoot: repoRoot })
        const agentsMdRes = await invoke('foundry:agents-md-scan', { workspaceRoot: repoRoot })
        const harness =
          'harness' in harnessRes
            ? (harnessRes.harness as { sensors?: unknown[]; agentsMdPath?: string })
            : null
        const hasAgentsMd =
          !('staleRefs' in agentsMdRes) || !(agentsMdRes as { notFound?: boolean }).notFound
        setContext({
          hasAgentsMd: !!harness?.agentsMdPath || hasAgentsMd,
          agentsMdPath: (harness?.agentsMdPath as string) ?? 'AGENTS.md',
          sensorCount: harness?.sensors?.length ?? 0,
        })
      } catch {
        setContext({ hasAgentsMd: false, agentsMdPath: 'AGENTS.md', sensorCount: 0 })
      }
    })()
  }, [repoRoot]) // eslint-disable-line react-hooks/exhaustive-deps

  async function browseSpec() {
    const p = await pickFile(MD_FILTER)
    if (p) setSpecPath(p)
  }

  async function launch() {
    setLaunching(true)
    setError(null)
    try {
      const res = await invoke('foundry:run-create', {
        workspaceRoot: repoRoot,
        mode,
        providerId,
        model,
        specPath: mode === 'spec-to-code' && specPath.trim() ? specPath.trim() : undefined,
        prompt:
          mode === 'spec-to-code'
            ? undefined
            : mode === 'orchestrate'
              ? taskDesc.trim() || undefined
              : prompt.trim() || undefined,
        maxIterations,
        // Pass manual DAG if the user built one — skips AI planning phase
        manualDag: mode === 'orchestrate' && dagAgents.length > 0 ? dagAgents : undefined,
      })
      if ('error' in res) throw new Error(res.error as string)
      onLaunched()
    } catch (err) {
      setError(String(err))
      setLaunching(false)
    }
  }

  const selectedProvider = providers.find((p) => p.id === providerId)
  const copilotUnsupported = mode === 'co-pilot' && selectedProvider?.type === 'ollama'

  const canLaunch =
    !copilotUnsupported &&
    providerId &&
    model &&
    (mode === 'orchestrate'
      ? dagAgents.length > 0 || taskDesc.trim()
      : mode === 'co-pilot'
        ? true
        : specPath.trim() || taskDesc.trim())

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="fnd-wizard-header">
        <span className="fnd-wizard-title">New Foundry run</span>
        <button className="fnd-wizard-close" onClick={onClose}>
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        {/* Mode cards */}
        <div className="fnd-section-label" style={{ marginBottom: 8 }}>
          Run mode
        </div>
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 18 }}
        >
          {MODE_CARDS.map((m) => (
            <div
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`fnd-template-card${mode === m.id ? ' fnd-template-card--selected' : ''}`}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ fontSize: 18, marginBottom: 4, opacity: 0.7 }}>{m.icon}</div>
              <div className="fnd-template-name">{m.label}</div>
              <div className="fnd-template-desc">{m.desc}</div>
            </div>
          ))}
        </div>

        {/* Provider pills */}
        <div className="fnd-section-label" style={{ marginBottom: 6 }}>
          Provider
        </div>
        {providers.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--tm-warning)', marginBottom: 14 }}>
            No providers configured —{' '}
            <span style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={onClose}>
              add one in Harness Settings
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14 }}>
            {providers.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setProviderId(p.id)
                  setModel(p.model)
                }}
                className={`fnd-btn fnd-btn--sm ${providerId === p.id ? 'fnd-btn--primary' : 'fnd-btn--secondary'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {copilotUnsupported && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--tm-warning)',
              marginBottom: 10,
              padding: '6px 10px',
              background: 'rgba(250,204,21,0.08)',
              borderRadius: 'var(--tm-radius-xs)',
              border: '1px solid rgba(250,204,21,0.2)',
            }}
          >
            CLI-based providers (Ollama) are not supported in Co-pilot mode — streaming required.
          </div>
        )}

        {/* Model + Max iterations */}
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, marginBottom: 14 }}
        >
          <div>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Model
            </div>
            <input
              className="fnd-sensor-cmd-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. claude-sonnet-4-6"
            />
          </div>
          {mode !== 'co-pilot' && (
            <div>
              <div className="fnd-section-label" style={{ marginBottom: 6 }}>
                Max iterations
              </div>
              <input
                className="fnd-sensor-cmd-input"
                style={{ width: 80 }}
                type="number"
                min={1}
                max={20}
                value={maxIterations}
                onChange={(e) => setMaxIterations(Math.max(1, parseInt(e.target.value) || 1))}
              />
            </div>
          )}
        </div>

        {/* Mode-specific input */}
        {mode === 'spec-to-code' && (
          <>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Spec file
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              <input
                className="fnd-sensor-cmd-input"
                style={{ flex: 1, fontFamily: 'var(--tm-font-mono)', fontSize: 11 }}
                value={specPath}
                onChange={(e) => setSpecPath(e.target.value)}
                placeholder="specs/007-feature/spec.md"
              />
              <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={browseSpec}>
                Browse…
              </button>
            </div>
          </>
        )}

        {mode === 'orchestrate' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div className="fnd-section-label" style={{ marginBottom: 0, flex: 1 }}>
                Agent flow
              </div>
              <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
                {dagAgents.length > 0
                  ? `${dagAgents.length} agent${dagAgents.length !== 1 ? 's' : ''} defined`
                  : 'or describe below and let AI plan'}
              </span>
            </div>
            <DagBuilder agents={dagAgents} onChange={setDagAgents} />
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              {dagAgents.length > 0
                ? 'Task context (optional)'
                : 'Task description (AI will plan agents)'}
            </div>
            <textarea
              className="fnd-editor-textarea"
              style={{
                width: '100%',
                minHeight: 60,
                border: '1px solid var(--tm-border)',
                borderRadius: 'var(--tm-radius-xs)',
                background: 'var(--tm-bg-input)',
                boxSizing: 'border-box',
                marginBottom: 14,
              }}
              value={taskDesc}
              onChange={(e) => setTaskDesc(e.target.value)}
              placeholder={
                dagAgents.length > 0
                  ? 'Any additional context for the agents…'
                  : 'e.g. Build a REST API with tests, OpenAPI docs, and a code review pass'
              }
            />
          </>
        )}

        {mode === 'co-pilot' && (
          <>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Opening instruction (optional)
            </div>
            <textarea
              className="fnd-editor-textarea"
              style={{
                width: '100%',
                minHeight: 72,
                border: '1px solid var(--tm-border)',
                borderRadius: 'var(--tm-radius-xs)',
                background: 'var(--tm-bg-input)',
                boxSizing: 'border-box',
                marginBottom: 14,
              }}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Add error handling to the auth middleware"
            />
          </>
        )}

        {/* Auto-detected context */}
        {context && (
          <>
            <div className="fnd-section-label" style={{ marginBottom: 6 }}>
              Context (auto-detected)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: 'var(--tm-bg-card)',
                  borderRadius: 'var(--tm-radius-xs)',
                  border: '1px solid var(--tm-border)',
                }}
              >
                <span style={{ fontSize: 12 }}>⊞</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontFamily: 'var(--tm-font-mono)',
                    color: context.hasAgentsMd ? 'var(--tm-text-primary)' : 'var(--tm-text-muted)',
                  }}
                >
                  {context.agentsMdPath}
                  {!context.hasAgentsMd && (
                    <span style={{ color: 'var(--tm-warning)', marginLeft: 6 }}>not found</span>
                  )}
                </span>
                <span
                  className="fnd-badge"
                  style={{
                    background: 'rgba(74,222,128,0.1)',
                    color: 'var(--tm-success)',
                    border: '1px solid rgba(74,222,128,0.2)',
                    fontSize: 10,
                    padding: '1px 6px',
                  }}
                >
                  feedforward
                </span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 10px',
                  background: 'var(--tm-bg-card)',
                  borderRadius: 'var(--tm-radius-xs)',
                  border: '1px solid var(--tm-border)',
                }}
              >
                <span style={{ fontSize: 12 }}>◎</span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontFamily: 'var(--tm-font-mono)',
                    color: 'var(--tm-text-secondary)',
                  }}
                >
                  .foundry/harness.json
                  {context.sensorCount > 0 && (
                    <span style={{ color: 'var(--tm-text-muted)', marginLeft: 6 }}>
                      — {context.sensorCount} sensor{context.sensorCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </span>
                <span
                  className="fnd-badge"
                  style={{
                    background: 'rgba(92,107,192,0.12)',
                    color: 'var(--tm-accent)',
                    border: '1px solid rgba(92,107,192,0.25)',
                    fontSize: 10,
                    padding: '1px 6px',
                  }}
                >
                  sensors
                </span>
              </div>
            </div>
          </>
        )}
      </div>

      {error && <div className="fnd-error-bar">{error}</div>}

      <div className="fnd-wizard-footer">
        <span style={{ fontSize: 10, color: 'var(--tm-text-muted)' }}>
          ⌘R to launch from command palette
        </span>
        <div className="fnd-wizard-footer-actions">
          <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="fnd-btn fnd-btn--primary fnd-btn--sm"
            onClick={launch}
            disabled={launching || !canLaunch}
          >
            {launching ? 'Launching…' : 'Launch →'}
          </button>
        </div>
      </div>
    </div>
  )
}
