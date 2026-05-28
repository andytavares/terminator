import React, { useEffect, useState } from 'react'
import './foundry.css'
import type { Harness, Sensor } from '../types/foundry.types'

type NavItem = 'sensors' | 'agents-md' | 'gates' | 'providers'

interface Props {
  repoRoot: string
  onClose: () => void
}

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<
    Record<string, unknown>
  >
}

export function HarnessSettings({ repoRoot, onClose }: Props) {
  const [nav, setNav] = useState<NavItem>('sensors')
  const [harness, setHarness] = useState<Harness | null>(null)
  const [agentsMd, setAgentsMd] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [repoRoot])

  async function load() {
    const [hr, ar] = await Promise.all([
      invoke('foundry:harness-read', { workspaceRoot: repoRoot }),
      invoke('foundry:agents-md-read', { workspaceRoot: repoRoot }),
    ])
    if ('harness' in hr) setHarness(hr.harness as Harness)
    if ('content' in ar) setAgentsMd(ar.content as string)
  }

  async function saveHarness(updated: Harness) {
    setSaving(true)
    setSaveMsg(null)
    try {
      await invoke('foundry:harness-write', { workspaceRoot: repoRoot, harness: updated })
      setHarness(updated)
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 1500)
    } finally {
      setSaving(false)
    }
  }

  async function saveAgentsMd() {
    setSaving(true)
    setSaveMsg(null)
    try {
      await invoke('foundry:agents-md-write', { workspaceRoot: repoRoot, content: agentsMd })
      setSaveMsg('Saved')
      setTimeout(() => setSaveMsg(null), 1500)
    } finally {
      setSaving(false)
    }
  }

  const NAV: { id: NavItem; label: string }[] = [
    { id: 'sensors', label: 'Sensors' },
    { id: 'agents-md', label: 'AGENTS.md' },
    { id: 'gates', label: 'Gates' },
    { id: 'providers', label: 'Providers' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div className="fnd-wizard-header">
        <span className="fnd-wizard-title">Foundry settings</span>
        <button className="fnd-wizard-close" onClick={onClose}>
          ×
        </button>
      </div>

      {/* Body: nav + content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Nav */}
        <div
          style={{
            width: 120,
            flexShrink: 0,
            borderRight: '1px solid var(--tm-border)',
            paddingTop: 4,
            background: 'var(--tm-bg-base)',
          }}
        >
          <div
            style={{
              padding: '6px 10px 4px',
              fontSize: 10,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.07em',
              color: 'var(--tm-text-muted)',
            }}
          >
            Harness
          </div>
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => setNav(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                width: '100%',
                padding: '6px 12px',
                background: nav === item.id ? 'var(--tm-bg-card)' : 'none',
                border: 'none',
                borderLeft: `2px solid ${nav === item.id ? 'var(--tm-accent)' : 'transparent'}`,
                color: nav === item.id ? 'var(--tm-text-primary)' : 'var(--tm-text-secondary)',
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {harness === null ? (
            <div style={{ color: 'var(--tm-text-muted)', fontSize: 12 }}>Loading…</div>
          ) : nav === 'sensors' ? (
            <SensorsPanel
              harness={harness}
              repoRoot={repoRoot}
              onSave={saveHarness}
              saving={saving}
            />
          ) : nav === 'agents-md' ? (
            <AgentsMdPanel
              content={agentsMd}
              onChange={setAgentsMd}
              onSave={saveAgentsMd}
              saving={saving}
            />
          ) : nav === 'gates' ? (
            <GatesPanel harness={harness} onSave={saveHarness} saving={saving} />
          ) : (
            <ProvidersPanel repoRoot={repoRoot} />
          )}
        </div>
      </div>

      {/* Footer save confirmation */}
      {saveMsg && (
        <div
          style={{
            padding: '6px 14px',
            borderTop: '1px solid var(--tm-border)',
            fontSize: 11,
            color: 'var(--tm-success)',
          }}
        >
          {saveMsg}
        </div>
      )}
    </div>
  )
}

// ─── Sensors panel ────────────────────────────────────────────────────────────

function SensorsPanel({
  harness,
  repoRoot,
  onSave,
  saving,
}: {
  harness: Harness
  repoRoot: string
  onSave: (h: Harness) => void
  saving: boolean
}) {
  const [sensors, setSensors] = useState<Sensor[]>(harness.sensors ?? [])
  const [checking, setChecking] = useState<Record<number, 'checking' | 'pass' | 'fail'>>({})

  async function runCheck(i: number) {
    const s = sensors[i]
    if (!s.command.trim()) return
    setChecking((prev) => ({ ...prev, [i]: 'checking' }))
    try {
      const res = await (window.electronAPI.extensionBridge.invoke('foundry:sensor-run', {
        sensorName: s.name,
        command: s.command,
        workspaceRoot: repoRoot,
      }) as Promise<Record<string, unknown>>)
      const pass = (res.result as { pass?: boolean })?.pass === true
      setChecking((prev) => ({ ...prev, [i]: pass ? 'pass' : 'fail' }))
    } catch {
      setChecking((prev) => ({ ...prev, [i]: 'fail' }))
    }
  }

  function update(i: number, field: keyof Sensor, val: string) {
    setSensors((prev) => prev.map((s, j) => (j === i ? { ...s, [field]: val } : s)))
  }

  function save() {
    onSave({ ...harness, sensors })
  }

  const statusColor = {
    checking: 'var(--tm-accent)',
    pass: 'var(--tm-success)',
    fail: 'var(--tm-danger)',
  }
  const statusLabel = { checking: 'checking…', pass: '✓ passing', fail: '✗ failing' }

  return (
    <div>
      <SectionTitle>Feedback sensors</SectionTitle>
      {sensors.map((s, i) => (
        <div key={i} className="fnd-sensor-card" style={{ marginBottom: 8 }}>
          <div className="fnd-sensor-row">
            <span
              style={{ fontSize: 12, fontWeight: 500, color: 'var(--tm-text-primary)', flex: 1 }}
            >
              {s.name || `sensor ${i + 1}`}
            </span>
            {checking[i] && (
              <span style={{ fontSize: 10, color: statusColor[checking[i]] }}>
                {statusLabel[checking[i]]}
              </span>
            )}
            <button onClick={() => runCheck(i)} className="fnd-btn fnd-btn--secondary fnd-btn--sm">
              Run
            </button>
            <button
              onClick={() => setSensors((p) => p.filter((_, j) => j !== i))}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--tm-text-secondary)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '2px 4px',
                lineHeight: 1,
                borderRadius: 'var(--tm-radius-xs)',
              }}
            >
              ×
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="fnd-sensor-name-input"
              value={s.name}
              onChange={(e) => update(i, 'name', e.target.value)}
              placeholder="name"
            />
            <input
              className="fnd-sensor-cmd-input"
              value={s.command}
              onChange={(e) => update(i, 'command', e.target.value)}
              placeholder="command"
            />
          </div>
        </div>
      ))}
      <button
        className="fnd-add-sensor-btn"
        onClick={() => setSensors((p) => [...p, { name: '', command: '' }])}
      >
        + Add sensor
      </button>
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="fnd-btn fnd-btn--primary fnd-btn--sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save sensors'}
        </button>
      </div>
    </div>
  )
}

// ─── AGENTS.md panel ──────────────────────────────────────────────────────────

function AgentsMdPanel({
  content,
  onChange,
  onSave,
  saving,
}: {
  content: string
  onChange: (c: string) => void
  onSave: () => void
  saving: boolean
}) {
  const lineCount = content.split('\n').length
  const [dragging, setDragging] = React.useState(false)

  async function importFile() {
    const res = await invoke('foundry:open-file', {
      filters: [{ name: 'Markdown / text', extensions: ['md', 'txt', 'mdx'] }],
    })
    if ('filePath' in res) {
      const read = await invoke('foundry:read-file', { filePath: res.filePath })
      if ('content' in read) onChange(read.content as string)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const p = (file as File & { path?: string }).path
    if (!p) return
    void invoke('foundry:read-file', { filePath: p }).then((res) => {
      if ('content' in res) onChange(res.content as string)
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--tm-text-primary)',
            paddingBottom: 8,
            borderBottom: '1px solid var(--tm-border)',
          }}
        >
          AGENTS.md
        </div>
        <button
          className="fnd-btn fnd-btn--secondary fnd-btn--sm"
          style={{ marginLeft: 8 }}
          onClick={importFile}
        >
          Import from file…
        </button>
      </div>
      {lineCount > 200 && (
        <div
          style={{
            padding: '6px 10px',
            marginBottom: 8,
            background: 'rgba(250,204,21,0.08)',
            border: '1px solid rgba(250,204,21,0.2)',
            borderRadius: 'var(--tm-radius-xs)',
            fontSize: 11,
            color: 'var(--tm-warning)',
          }}
        >
          Consider splitting into subdirectory-level files — AGENTS.md is {lineCount} lines.
        </div>
      )}
      <textarea
        className="fnd-editor-textarea"
        value={content}
        onChange={(e) => onChange(e.target.value)}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        spellCheck={false}
        placeholder="Drag & drop a file here to import its content, or type directly"
        style={{
          flex: 1,
          minHeight: 300,
          border: `1px solid ${dragging ? 'var(--tm-accent)' : 'var(--tm-border)'}`,
          borderRadius: 'var(--tm-radius-xs)',
          background: dragging ? 'var(--tm-accent-dim)' : 'var(--tm-bg-input)',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      />
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="fnd-btn fnd-btn--primary fnd-btn--sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save AGENTS.md'}
        </button>
      </div>
    </div>
  )
}

// ─── Gates panel ─────────────────────────────────────────────────────────────

function GatesPanel({
  harness,
  onSave,
  saving,
}: {
  harness: Harness
  onSave: (h: Harness) => void
  saving: boolean
}) {
  const [gd, setGd] = useState(harness.gateDefaults)
  const [limit, setLimit] = useState(harness.iterationLimit)

  const toggles: { key: keyof typeof gd; label: string }[] = [
    { key: 'requireGateAfterEachIteration', label: 'Require gate after each iteration' },
    { key: 'sensorsMustPassBeforeGate', label: 'Sensors must pass before gate opens' },
    { key: 'autoCheckpointBeforeRun', label: 'Auto-checkpoint commit before run' },
    { key: 'requireCleanWorkingTree', label: 'Require clean working tree' },
  ]

  function save() {
    onSave({ ...harness, gateDefaults: gd, iterationLimit: limit })
  }

  return (
    <div>
      <SectionTitle>Gate defaults</SectionTitle>
      {toggles.map(({ key, label }) => (
        <div
          key={key}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 0',
            borderBottom: '1px solid var(--tm-border)',
          }}
        >
          <span style={{ flex: 1, fontSize: 12, color: 'var(--tm-text-secondary)' }}>{label}</span>
          <Toggle checked={gd[key]} onChange={(v) => setGd((p) => ({ ...p, [key]: v }))} />
        </div>
      ))}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', marginTop: 4 }}
      >
        <span style={{ flex: 1, fontSize: 12, color: 'var(--tm-text-secondary)' }}>
          Max iterations per run
        </span>
        <input
          type="number"
          min={1}
          max={20}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          style={{
            width: 52,
            background: 'var(--tm-bg-input)',
            border: '1px solid var(--tm-border)',
            borderRadius: 'var(--tm-radius-xs)',
            color: 'var(--tm-text-primary)',
            fontSize: 12,
            padding: '3px 8px',
            textAlign: 'center',
            fontFamily: 'inherit',
          }}
        />
      </div>
      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="fnd-btn fnd-btn--primary fnd-btn--sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save gates'}
        </button>
      </div>
    </div>
  )
}

// ─── Providers panel ─────────────────────────────────────────────────────────

interface ProviderConfig {
  id: string
  type: string
  label: string
  model: string
  endpoint?: string
  keychainKey?: string
  supportsStreaming: boolean
  maxRetries?: number
  requestDelayMs?: number
}

type ProviderType = 'claude' | 'openai' | 'gemini' | 'ollama'

const PROVIDER_DEFAULTS: Record<
  ProviderType,
  { label: string; model: string; streaming: boolean; needsKey: boolean; needsEndpoint: boolean }
> = {
  claude: {
    label: 'Claude (Anthropic)',
    model: 'claude-sonnet-4-6',
    streaming: true,
    needsKey: true,
    needsEndpoint: false,
  },
  openai: {
    label: 'OpenAI',
    model: 'gpt-4o',
    streaming: true,
    needsKey: true,
    needsEndpoint: false,
  },
  gemini: {
    label: 'Gemini (Google)',
    model: 'gemini-1.5-pro',
    streaming: true,
    needsKey: true,
    needsEndpoint: false,
  },
  ollama: {
    label: 'Ollama (local)',
    model: 'llama3',
    streaming: false,
    needsKey: false,
    needsEndpoint: true,
  },
}

const MODELS: Record<ProviderType, string[]> = {
  claude: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1'],
  gemini: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
  ollama: ['llama3', 'mistral', 'codellama', 'phi3'],
}

function RateLimitPanel({
  provider,
  onSave,
  saving,
}: {
  provider: ProviderConfig
  onSave: (maxRetries: number, requestDelayMs: number) => void
  saving: boolean
}) {
  const [retries, setRetries] = useState(provider.maxRetries ?? 4)
  const [delay, setDelay] = useState(provider.requestDelayMs ?? 0)

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--tm-border)' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--tm-text-secondary)',
          marginBottom: 10,
        }}
      >
        Rate limit &amp; retry settings
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
        <div>
          <div className="fnd-section-label" style={{ marginBottom: 5, fontSize: 10 }}>
            Max retries on 429
          </div>
          <input
            type="number"
            className="fnd-sensor-cmd-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            min={0}
            max={10}
            value={retries}
            onChange={(e) => setRetries(Math.max(0, Math.min(10, parseInt(e.target.value) || 0)))}
          />
          <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 4 }}>
            SDK retries with exponential backoff. 0 = no retries. Default:{' '}
            {provider.type === 'claude' ? 4 : 3}.
          </div>
        </div>
        <div>
          <div className="fnd-section-label" style={{ marginBottom: 5, fontSize: 10 }}>
            Request delay (ms)
          </div>
          <input
            type="number"
            className="fnd-sensor-cmd-input"
            style={{ width: '100%', boxSizing: 'border-box' }}
            min={0}
            max={60000}
            step={500}
            value={delay}
            onChange={(e) => setDelay(Math.max(0, parseInt(e.target.value) || 0))}
          />
          <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 4 }}>
            Fixed pause before each request. 1000 = ~60 rpm. 0 = no throttle.
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button
          className="fnd-btn fnd-btn--primary fnd-btn--sm"
          onClick={() => onSave(retries, delay)}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function ProvidersPanel({ repoRoot }: { repoRoot: string }) {
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [adding, setAdding] = useState<ProviderType | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; latencyMs: number }>>(
    {}
  )
  const [loaded, setLoaded] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  useEffect(() => {
    void loadProviders()
  }, [])

  async function loadProviders() {
    try {
      const res = await invoke('foundry:provider-list', { workspaceRoot: repoRoot })
      setProviders((res.providers as ProviderConfig[]) ?? [])
    } finally {
      setLoaded(true)
    }
  }

  async function testConnection(p: ProviderConfig) {
    setTesting(p.id)
    try {
      const res = await invoke('foundry:provider-test', {
        providerId: p.id,
        workspaceRoot: repoRoot,
      })
      setTestResult((prev) => ({
        ...prev,
        [p.id]: {
          ok: 'ok' in res ? Boolean(res.ok) : false,
          latencyMs: (res.latencyMs as number) ?? 0,
        },
      }))
    } catch {
      setTestResult((prev) => ({ ...prev, [p.id]: { ok: false, latencyMs: 0 } }))
    } finally {
      setTesting(null)
    }
  }

  async function saveRateLimits(p: ProviderConfig, maxRetries: number, requestDelayMs: number) {
    setSaving(p.id)
    try {
      await invoke('foundry:provider-save', {
        provider: { ...p, maxRetries, requestDelayMs },
        workspaceRoot: repoRoot,
      })
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, maxRetries, requestDelayMs } : x))
      )
      setExpandedId(null)
    } finally {
      setSaving(null)
    }
  }

  async function deleteProvider(id: string) {
    await invoke('foundry:provider-delete', { providerId: id, workspaceRoot: repoRoot })
    setProviders((prev) => prev.filter((p) => p.id !== id))
    setTestResult((prev) => {
      const n = { ...prev }
      delete n[id]
      return n
    })
  }

  if (!loaded) return <div style={{ color: 'var(--tm-text-muted)', fontSize: 12 }}>Loading…</div>

  return (
    <div>
      <SectionTitle>Providers</SectionTitle>

      {providers.length === 0 && !adding && (
        <div className="fnd-empty" style={{ padding: '16px 0 20px' }}>
          <span>No providers configured.</span>
          <span style={{ fontSize: 11 }}>Add a provider below to start using Foundry.</span>
        </div>
      )}

      {providers.map((p) => {
        const tr = testResult[p.id]
        return (
          <div
            key={p.id}
            style={{
              border: '1px solid var(--tm-border)',
              borderRadius: 'var(--tm-radius-xs)',
              padding: '10px 12px',
              marginBottom: 8,
              background: 'var(--tm-bg-card)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--tm-text-primary)' }}
              >
                {p.label}
              </span>
              {tr && (
                <span
                  style={{ fontSize: 10, color: tr.ok ? 'var(--tm-success)' : 'var(--tm-danger)' }}
                >
                  {tr.ok ? `✓ connected ${tr.latencyMs}ms` : '✗ failed'}
                </span>
              )}
              <button
                className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                onClick={() => testConnection(p)}
                disabled={testing === p.id}
              >
                {testing === p.id ? '…' : 'Test'}
              </button>
              <button
                onClick={() => deleteProvider(p.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--tm-text-secondary)',
                  cursor: 'pointer',
                  fontSize: 15,
                  padding: '1px 4px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--tm-text-muted)',
                display: 'flex',
                gap: 12,
                alignItems: 'center',
              }}
            >
              <span>{p.model}</span>
              {p.endpoint && <span>{p.endpoint}</span>}
              {p.keychainKey && (
                <span style={{ color: 'var(--tm-success)' }}>key stored in keychain ✓</span>
              )}
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                {p.requestDelayMs ? (
                  <span style={{ color: 'var(--tm-warning)' }}>⏱ {p.requestDelayMs}ms delay</span>
                ) : null}
                {p.maxRetries !== undefined && p.maxRetries !== 4 ? (
                  <span>{p.maxRetries} retries</span>
                ) : null}
                <button
                  className="fnd-btn fnd-btn--secondary fnd-btn--sm"
                  style={{ fontSize: 10 }}
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                >
                  {expandedId === p.id ? '▲ Rate limits' : '▼ Rate limits'}
                </button>
              </span>
            </div>
            {expandedId === p.id && (
              <RateLimitPanel
                provider={p}
                onSave={(retries, delay) => void saveRateLimits(p, retries, delay)}
                saving={saving === p.id}
              />
            )}
          </div>
        )
      })}

      {adding ? (
        <AddProviderForm
          type={adding}
          repoRoot={repoRoot}
          onSave={async (saved) => {
            await loadProviders()
            setAdding(null)
            if (saved) setTestResult({})
          }}
          onCancel={() => setAdding(null)}
        />
      ) : (
        <div>
          <div
            className="fnd-section-label"
            style={{ marginBottom: 8, marginTop: providers.length > 0 ? 12 : 0 }}
          >
            Add provider
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            {(Object.keys(PROVIDER_DEFAULTS) as ProviderType[]).map((type) => {
              const already = providers.some((p) => p.type === type)
              return (
                <button
                  key={type}
                  onClick={() => !already && setAdding(type)}
                  disabled={already}
                  className="fnd-btn fnd-btn--secondary"
                  style={{ justifyContent: 'flex-start', opacity: already ? 0.4 : 1 }}
                >
                  {PROVIDER_DEFAULTS[type].label}
                  {already && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tm-success)' }}>
                      ✓
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <p className="fnd-hint" style={{ marginTop: 14 }}>
        API keys are encrypted and stored in the OS keychain — never written to disk.
      </p>
    </div>
  )
}

function AddProviderForm({
  type,
  repoRoot,
  onSave,
  onCancel,
}: {
  type: ProviderType
  repoRoot: string
  onSave: (saved: boolean) => void
  onCancel: () => void
}) {
  const defaults = PROVIDER_DEFAULTS[type]
  const [model, setModel] = useState(defaults.model)
  const [apiKey, setApiKey] = useState('')
  const [endpoint, setEndpoint] = useState(type === 'ollama' ? 'http://localhost:11434' : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const id = `${type}-${Date.now()}`
      const provider: ProviderConfig = {
        id,
        type,
        label: defaults.label,
        model,
        endpoint: defaults.needsEndpoint ? endpoint : undefined,
        keychainKey: defaults.needsKey ? `foundry.provider.${id}.apikey` : undefined,
        supportsStreaming: defaults.streaming,
      }
      const res = await invoke('foundry:provider-save', {
        provider,
        apiKey: defaults.needsKey ? apiKey : undefined,
        workspaceRoot: repoRoot,
      })
      if ('error' in res) throw new Error(res.error as string)
      onSave(true)
    } catch (err) {
      setError(String(err))
      setSaving(false)
    }
  }

  const canSave =
    (!defaults.needsKey || apiKey.trim()) &&
    (!defaults.needsEndpoint || endpoint.trim()) &&
    model.trim()

  return (
    <div
      style={{
        border: '1px solid var(--tm-border)',
        borderRadius: 'var(--tm-radius-xs)',
        padding: '12px',
        marginTop: 8,
        background: 'var(--tm-bg-elevated)',
      }}
    >
      <div
        style={{ fontSize: 13, fontWeight: 600, color: 'var(--tm-text-primary)', marginBottom: 12 }}
      >
        Add {defaults.label}
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 4 }}>
          Model
        </div>
        <select
          className="fnd-editor-select"
          style={{ width: '100%' }}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          {MODELS[type].map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {defaults.needsKey && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 4 }}>
            API key
          </div>
          <input
            type="password"
            className="fnd-sensor-cmd-input"
            style={{ width: '100%' }}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            autoComplete="off"
          />
          <div style={{ fontSize: 10, color: 'var(--tm-text-muted)', marginTop: 4 }}>
            Stored in the OS keychain — not written to disk.
          </div>
        </div>
      )}

      {defaults.needsEndpoint && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginBottom: 4 }}>
            Endpoint
          </div>
          <input
            className="fnd-sensor-cmd-input"
            style={{ width: '100%' }}
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://localhost:11434"
          />
        </div>
      )}

      {error && (
        <div
          className="fnd-error-bar"
          style={{ borderRadius: 'var(--tm-radius-xs)', marginBottom: 10 }}
        >
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button className="fnd-btn fnd-btn--secondary fnd-btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="fnd-btn fnd-btn--primary fnd-btn--sm"
          onClick={save}
          disabled={saving || !canSave}
        >
          {saving ? 'Saving…' : 'Save provider'}
        </button>
      </div>
    </div>
  )
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 600,
        color: 'var(--tm-text-primary)',
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: '1px solid var(--tm-border)',
      }}
    >
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        width: 32,
        height: 17,
        borderRadius: 9,
        cursor: 'pointer',
        flexShrink: 0,
        background: checked ? 'var(--tm-accent)' : 'var(--tm-bg-elevated)',
        border: `1px solid ${checked ? 'var(--tm-accent)' : 'var(--tm-border-strong)'}`,
        position: 'relative',
        transition: 'background 0.15s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 15 : 2,
          width: 11,
          height: 11,
          borderRadius: '50%',
          background: checked ? '#fff' : 'var(--tm-text-muted)',
          transition: 'left 0.15s',
        }}
      />
    </div>
  )
}
