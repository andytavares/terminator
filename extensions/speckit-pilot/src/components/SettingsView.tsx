import React, { useEffect, useState } from 'react'
import { CheckCircle, XCircle, Save, Eye, EyeOff, Lock } from 'lucide-react'
import { getSpeckitAPI } from '../types/electron.js'
import type { PhaseGateConfig, PilotSettings } from '../types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../types/speckit.types.js'

interface ConnectionStatus {
  linear: boolean
  jira: boolean
}

const SETTINGS_KEY = 'speckit-pilot-global-settings'

function loadSettings(): PilotSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } as PilotSettings
  } catch (e) {
    // ignore parse errors — fall through to defaults
  }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(s: PilotSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch (e) {
    // ignore storage errors (e.g., private browsing quota)
  }
}

const PHASE_LABEL: Record<string, string> = {
  constitution: 'Constitution',
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  checklist: 'Checklist',
  tasks: 'Tasks',
  analyze: 'Analyze',
  implement: 'Implement',
  'self-review': 'Self-Review',
  'open-pr': 'Open PR',
}

const LOCKED_PHASES = new Set(['self-review', 'open-pr', 'implement'])

export function SettingsView() {
  const [connection, setConnection] = useState<ConnectionStatus>({ linear: false, jira: false })
  const [connLoading, setConnLoading] = useState(true)
  const [settings, setSettings] = useState<PilotSettings>(loadSettings)
  const [settingsSaved, setSettingsSaved] = useState(false)

  // Linear form state
  const [linearKey, setLinearKey] = useState('')
  const [linearEmail, setLinearEmail] = useState('')
  const [linearKeyVisible, setLinearKeyVisible] = useState(false)
  const [linearSaving, setLinearSaving] = useState(false)
  const [linearError, setLinearError] = useState<string | null>(null)
  const [linearSaved, setLinearSaved] = useState(false)

  // Jira form state
  const [jiraDomain, setJiraDomain] = useState('')
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraToken, setJiraToken] = useState('')
  const [jiraTokenVisible, setJiraTokenVisible] = useState(false)
  const [jiraJql, setJiraJql] = useState('')
  const [jiraSaving, setJiraSaving] = useState(false)
  const [jiraError, setJiraError] = useState<string | null>(null)
  const [jiraSaved, setJiraSaved] = useState(false)

  useEffect(() => {
    const api = getSpeckitAPI()
    Promise.all([
      api.credentialsStatus({ source: 'linear' }),
      api.credentialsStatus({ source: 'jira' }),
    ])
      .then(([lin, jir]) => {
        setConnection({
          linear: 'connected' in lin ? lin.connected : false,
          jira: 'connected' in jir ? jir.connected : false,
        })
        if ('email' in lin && lin.email) setLinearEmail(lin.email)
      })
      .catch(() => {})
      .finally(() => setConnLoading(false))
  }, [])

  async function saveLinear() {
    // Allow saving the email alone (to update it) once a key is already stored.
    if (!linearKey.trim() && !connection.linear) return
    setLinearSaving(true)
    setLinearError(null)
    setLinearSaved(false)
    try {
      const result = await getSpeckitAPI().credentialsSet({
        source: 'linear',
        apiKey: linearKey.trim() || undefined,
        email: linearEmail.trim() || undefined,
      })
      if ('error' in result) {
        setLinearError(result.error)
      } else {
        setConnection((c) => ({ ...c, linear: true }))
        setLinearKey('')
        setLinearSaved(true)
        setTimeout(() => setLinearSaved(false), 3000)
      }
    } catch (e) {
      setLinearError(String(e))
    } finally {
      setLinearSaving(false)
    }
  }

  async function saveJira() {
    if (!jiraDomain.trim() || !jiraEmail.trim() || !jiraToken.trim()) return
    setJiraSaving(true)
    setJiraError(null)
    setJiraSaved(false)
    try {
      const result = await getSpeckitAPI().credentialsSet({
        source: 'jira',
        domain: jiraDomain.trim(),
        email: jiraEmail.trim(),
        apiToken: jiraToken.trim(),
        jql: jiraJql.trim(),
      })
      if ('error' in result) {
        setJiraError(result.error)
      } else {
        setConnection((c) => ({ ...c, jira: true }))
        setJiraToken('')
        setJiraSaved(true)
        setTimeout(() => setJiraSaved(false), 3000)
      }
    } catch (e) {
      setJiraError(String(e))
    } finally {
      setJiraSaving(false)
    }
  }

  function updateSettings(patch: Partial<PilotSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }))
  }

  function updateGate(phase: string, patch: Partial<PhaseGateConfig>) {
    setSettings((prev) => ({
      ...prev,
      phaseGates: {
        ...prev.phaseGates,
        [phase]: { ...prev.phaseGates[phase as keyof typeof prev.phaseGates], ...patch },
      },
    }))
  }

  function handleSaveSettings() {
    saveSettings(settings)
    setSettingsSaved(true)
    setTimeout(() => setSettingsSaved(false), 2500)
  }

  // --- styles ---
  const s = {
    section: {
      marginBottom: 24,
      borderBottom: '1px solid var(--tm-border)',
      paddingBottom: 20,
    } as React.CSSProperties,
    sectionLast: { marginBottom: 0 } as React.CSSProperties,
    label: {
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'uppercase' as const,
      letterSpacing: '0.08em',
      color: 'var(--tm-text-secondary)',
      marginBottom: 12,
    } as React.CSSProperties,
    row: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      fontSize: 13,
      color: 'var(--tm-text-primary)',
    } as React.CSSProperties,
    field: { marginBottom: 10 } as React.CSSProperties,
    fieldLabel: {
      display: 'block',
      fontSize: 12,
      color: 'var(--tm-text-secondary)',
      marginBottom: 4,
    } as React.CSSProperties,
    inputWrap: { display: 'flex', alignItems: 'center', gap: 4 } as React.CSSProperties,
    input: {
      flex: 1,
      background: 'var(--tm-bg-elevated)',
      border: '1px solid var(--tm-border)',
      borderRadius: 4,
      padding: '5px 8px',
      fontSize: 13,
      color: 'var(--tm-text-primary)',
      outline: 'none',
    } as React.CSSProperties,
    iconBtn: {
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: 'var(--tm-text-secondary)',
      padding: 4,
      display: 'flex',
      alignItems: 'center',
    } as React.CSSProperties,
    saveBtn: {
      marginTop: 10,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      background: 'var(--tm-accent)',
      color: '#fff',
      border: 'none',
      borderRadius: 4,
      padding: '6px 14px',
      fontSize: 13,
      cursor: 'pointer',
    } as React.CSSProperties,
    error: { marginTop: 6, fontSize: 12, color: 'var(--tm-danger)' } as React.CSSProperties,
    saved: {
      marginTop: 6,
      fontSize: 12,
      color: 'var(--tm-success)',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
    } as React.CSSProperties,
    segCtrl: {
      display: 'flex',
      gap: 2,
      background: 'var(--tm-bg-elevated)',
      border: '1px solid var(--tm-border)',
      borderRadius: 6,
      padding: 3,
      width: 'fit-content',
    } as React.CSSProperties,
    toggle: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
      fontSize: 13,
      color: 'var(--tm-text-primary)',
    } as React.CSSProperties,
    select: {
      background: 'var(--tm-bg-elevated)',
      border: '1px solid var(--tm-border)',
      borderRadius: 4,
      padding: '5px 8px',
      fontSize: 13,
      color: 'var(--tm-text-primary)',
      outline: 'none',
    } as React.CSSProperties,
  }

  function SegButton({
    value,
    current,
    label,
    onChange,
  }: {
    value: string
    current: string
    label: string
    onChange: (v: string) => void
  }) {
    const active = value === current
    return (
      <button
        onClick={() => onChange(value)}
        className={`sk-editor__mode-btn${active ? ' sk-editor__mode-btn--active' : ''}`}
        style={{ flex: 1 }}
        aria-pressed={active}
      >
        {label}
      </button>
    )
  }

  function Toggle({
    checked,
    onChange,
    disabled,
    label,
  }: {
    checked: boolean
    onChange: (v: boolean) => void
    disabled?: boolean
    label: string
  }) {
    return (
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer', accentColor: 'var(--tm-accent)' }}
      />
    )
  }

  return (
    <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
      {/* ─── Section 1: Ticket integrations ─── */}
      <div style={s.section}>
        <div style={s.label}>Ticket integrations</div>
        {connLoading ? (
          <div style={{ color: 'var(--tm-text-secondary)', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {/* Linear */}
            <div style={{ marginBottom: 20 }}>
              <div style={s.row}>
                {connection.linear ? <CheckCircle size={14} /> : <XCircle size={14} />}
                <span>Linear — {connection.linear ? 'Connected' : 'Not connected'}</span>
              </div>
              <div style={s.field}>
                <label style={s.fieldLabel} htmlFor="linear-api-key">
                  API Key
                  {connection.linear && (
                    <span style={{ color: 'var(--tm-success)' }}> (update)</span>
                  )}
                </label>
                <div style={s.inputWrap}>
                  <input
                    id="linear-api-key"
                    type={linearKeyVisible ? 'text' : 'password'}
                    placeholder={connection.linear ? '••••••••••••••••' : 'lin_api_...'}
                    value={linearKey}
                    onChange={(e) => setLinearKey(e.target.value)}
                    style={s.input}
                    aria-label="Linear API key"
                  />
                  <button
                    style={s.iconBtn}
                    onClick={() => setLinearKeyVisible((v) => !v)}
                    aria-label={linearKeyVisible ? 'Hide key' : 'Show key'}
                    type="button"
                  >
                    {linearKeyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <label
                  style={{ ...s.fieldLabel, display: 'block', marginTop: 10 }}
                  htmlFor="linear-email"
                >
                  Your Linear email
                </label>
                <input
                  id="linear-email"
                  type="email"
                  placeholder="you@example.com"
                  value={linearEmail}
                  onChange={(e) => setLinearEmail(e.target.value)}
                  style={s.input}
                  aria-label="Linear user email"
                />
                <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginTop: 4 }}>
                  Used to look up your assigned issues. Leave blank to use the API key's own user.
                </div>
              </div>
              <button
                style={s.saveBtn}
                onClick={saveLinear}
                disabled={linearSaving || (!linearKey.trim() && !connection.linear)}
                aria-label="Save Linear credentials"
              >
                <Save size={13} />
                {linearSaving ? 'Saving…' : 'Save'}
              </button>
              {linearError && <div style={s.error}>{linearError}</div>}
              {linearSaved && (
                <div style={s.saved}>
                  <CheckCircle size={12} /> Saved
                </div>
              )}
            </div>

            {/* Jira */}
            <div>
              <div style={s.row}>
                {connection.jira ? <CheckCircle size={14} /> : <XCircle size={14} />}
                <span>Jira — {connection.jira ? 'Connected' : 'Not connected'}</span>
              </div>
              <div style={s.field}>
                <label style={s.fieldLabel} htmlFor="jira-domain">
                  Domain
                </label>
                <input
                  id="jira-domain"
                  type="text"
                  placeholder="yourcompany.atlassian.net"
                  value={jiraDomain}
                  onChange={(e) => setJiraDomain(e.target.value)}
                  style={s.input}
                  aria-label="Jira domain"
                />
              </div>
              <div style={s.field}>
                <label style={s.fieldLabel} htmlFor="jira-email">
                  Email
                </label>
                <input
                  id="jira-email"
                  type="email"
                  placeholder="you@company.com"
                  value={jiraEmail}
                  onChange={(e) => setJiraEmail(e.target.value)}
                  style={s.input}
                  aria-label="Jira email"
                />
              </div>
              <div style={s.field}>
                <label style={s.fieldLabel} htmlFor="jira-token">
                  API Token
                </label>
                <div style={s.inputWrap}>
                  <input
                    id="jira-token"
                    type={jiraTokenVisible ? 'text' : 'password'}
                    placeholder={connection.jira ? '••••••••••••••••' : 'ATATT3...'}
                    value={jiraToken}
                    onChange={(e) => setJiraToken(e.target.value)}
                    style={s.input}
                    aria-label="Jira API token"
                  />
                  <button
                    style={s.iconBtn}
                    onClick={() => setJiraTokenVisible((v) => !v)}
                    aria-label={jiraTokenVisible ? 'Hide token' : 'Show token'}
                    type="button"
                  >
                    {jiraTokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div style={s.field}>
                <label style={s.fieldLabel} htmlFor="jira-jql">
                  JQL filter <span style={{ fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  id="jira-jql"
                  type="text"
                  placeholder="project = ENG AND assignee = currentUser()"
                  value={jiraJql}
                  onChange={(e) => setJiraJql(e.target.value)}
                  style={s.input}
                  aria-label="Jira JQL filter"
                />
              </div>
              <button
                style={s.saveBtn}
                onClick={saveJira}
                disabled={
                  jiraSaving || !jiraDomain.trim() || !jiraEmail.trim() || !jiraToken.trim()
                }
                aria-label="Save Jira credentials"
              >
                <Save size={13} />
                {jiraSaving ? 'Saving…' : 'Save'}
              </button>
              {jiraError && <div style={s.error}>{jiraError}</div>}
              {jiraSaved && (
                <div style={s.saved}>
                  <CheckCircle size={12} /> Saved
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ─── Section 2: Autonomy & gates ─── */}
      <div style={s.section}>
        <div style={s.label}>Autonomy &amp; gates</div>

        {/* Max concurrent runs */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...s.fieldLabel, display: 'block', marginBottom: 6 }}>
            Maximum cards running in parallel
          </label>
          <input
            type="number"
            min={1}
            aria-label="Maximum cards running in parallel"
            value={settings.maxConcurrentRuns}
            onChange={(e) => {
              const n = Math.max(1, Math.floor(Number(e.target.value) || 1))
              updateSettings({ maxConcurrentRuns: n })
              try {
                ;(
                  window as unknown as {
                    electronAPI?: { settings?: { set?: (k: string, v: unknown) => void } }
                  }
                ).electronAPI?.settings?.set?.('terminator.speckit-pilot.maxConcurrentRuns', n)
              } catch {
                // core settings bridge unavailable — localStorage value still persists
              }
            }}
            style={{ width: 80 }}
          />
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginTop: 5 }}>
            How many cards agents may work at once; extra hand-offs wait for a free slot.
          </div>
        </div>

        {/* Log retention */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ ...s.fieldLabel, display: 'block', marginBottom: 6 }}>
            Keep step logs for (days)
          </label>
          <input
            type="number"
            min={1}
            aria-label="Days to keep persisted step logs"
            value={settings.logRetentionDays}
            onChange={(e) => {
              const n = Math.max(1, Math.floor(Number(e.target.value) || 1))
              updateSettings({ logRetentionDays: n })
              try {
                ;(
                  window as unknown as {
                    electronAPI?: { settings?: { set?: (k: string, v: unknown) => void } }
                  }
                ).electronAPI?.settings?.set?.('terminator.speckit-pilot.logRetentionDays', n)
              } catch {
                // core settings bridge unavailable — localStorage value still persists
              }
            }}
            style={{ width: 80 }}
          />
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginTop: 5 }}>
            Persisted step output older than this is deleted automatically.
          </div>
        </div>

        {/* Default autonomy */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...s.fieldLabel, display: 'block', marginBottom: 6 }}>Default autonomy</div>
          <div style={s.segCtrl}>
            <SegButton
              value="guided"
              current={settings.defaultAutonomy}
              label="Guided"
              onChange={(v) =>
                updateSettings({ defaultAutonomy: v as 'guided' | 'standard' | 'fast' })
              }
            />
            <SegButton
              value="standard"
              current={settings.defaultAutonomy}
              label="Standard"
              onChange={(v) =>
                updateSettings({ defaultAutonomy: v as 'guided' | 'standard' | 'fast' })
              }
            />
            <SegButton
              value="fast"
              current={settings.defaultAutonomy}
              label="Fast"
              onChange={(v) =>
                updateSettings({ defaultAutonomy: v as 'guided' | 'standard' | 'fast' })
              }
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--tm-text-secondary)', marginTop: 5 }}>
            {settings.defaultAutonomy === 'guided' && 'Pauses at every gate for review'}
            {settings.defaultAutonomy === 'standard' &&
              'Auto-approves non-critical phases, pauses at Implement, Self-Review, and Open PR'}
            {settings.defaultAutonomy === 'fast' &&
              'Auto-approves all phases except Self-Review and Open PR (always required)'}
          </div>
        </div>

        {/* Phase gate toggles */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ ...s.fieldLabel, display: 'block', marginBottom: 6 }}>Phase gates</div>
          <div
            style={{ border: '1px solid var(--tm-border)', borderRadius: 6, overflow: 'hidden' }}
          >
            {/* Header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 90px 100px',
                gap: 8,
                padding: '6px 12px',
                background: 'var(--tm-bg-elevated)',
                fontSize: 11,
                color: 'var(--tm-text-secondary)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
              }}
            >
              <span>Phase</span>
              <span style={{ textAlign: 'center' }}>Required</span>
              <span style={{ textAlign: 'center' }}>Auto-approve</span>
            </div>
            {PHASE_ORDER.map((phaseId, i) => {
              const gate = settings.phaseGates[phaseId]
              const locked = LOCKED_PHASES.has(phaseId)
              const isLast = i === PHASE_ORDER.length - 1
              return (
                <div
                  key={phaseId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 90px 100px',
                    gap: 8,
                    padding: '8px 12px',
                    borderTop: '1px solid var(--tm-border)',
                    background: locked ? 'var(--tm-bg-elevated)' : 'transparent',
                    borderBottom: isLast ? 'none' : undefined,
                    fontSize: 13,
                    color: locked ? 'var(--tm-text-secondary)' : 'var(--tm-text-primary)',
                  }}
                  aria-label={`${PHASE_LABEL[phaseId]} gate row`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {locked && <Lock size={11} />}
                    {PHASE_LABEL[phaseId]}
                    {locked && (
                      <span style={{ fontSize: 10, color: 'var(--tm-text-secondary)' }}>
                        always required
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <Toggle
                      checked={gate?.required ?? true}
                      onChange={(v) => updateGate(phaseId, { required: v })}
                      disabled={locked}
                      label={`${PHASE_LABEL[phaseId]} required`}
                    />
                  </span>
                  <span style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <Toggle
                      checked={gate?.autoApprove ?? false}
                      onChange={(v) => updateGate(phaseId, { autoApprove: v })}
                      disabled={locked}
                      label={`${PHASE_LABEL[phaseId]} auto-approve`}
                    />
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Batch check-ins & write-back toggles */}
        <div style={{ marginBottom: 8 }}>
          <div style={s.toggle}>
            <Toggle
              checked={settings.batchCheckinsEnabled}
              onChange={(v) => updateSettings({ batchCheckinsEnabled: v })}
              label="Enable batch check-ins"
            />
            <span>Enable batch check-ins</span>
            <span style={{ fontSize: 11, color: 'var(--tm-text-secondary)' }}>
              Pauses at each tasks.md section boundary during Implement
            </span>
          </div>
          <div style={s.toggle}>
            <Toggle
              checked={settings.writeStatusBackOnPrOpen}
              onChange={(v) => updateSettings({ writeStatusBackOnPrOpen: v })}
              label="Write status back to tracker when PR opens"
            />
            <span>Write status back to tracker on PR open</span>
          </div>
          <div style={s.toggle}>
            <Toggle
              checked={settings.runConstitutionPhase}
              onChange={(v) => updateSettings({ runConstitutionPhase: v })}
              label="Run the Constitution phase for each card"
            />
            <span>Run the Constitution phase for each card</span>
            <span style={{ fontSize: 11, color: 'var(--tm-text-secondary)' }}>
              Off by default — the project already has a ratified constitution spec-kit respects
            </span>
          </div>
        </div>
      </div>

      {/* ─── Section 3: Agent runner ─── */}
      <div style={{ ...s.section, ...s.sectionLast }}>
        <div style={s.label}>Agent runner</div>

        {/* Model selector */}
        <div style={{ ...s.field, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label
            style={{ ...s.fieldLabel, marginBottom: 0, minWidth: 100 }}
            htmlFor="default-model"
          >
            Default model
          </label>
          <select
            id="default-model"
            value={settings.defaultModel}
            onChange={(e) => updateSettings({ defaultModel: e.target.value })}
            style={s.select}
            aria-label="Default model"
          >
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
          </select>
        </div>

        {/* Console position */}
        <div style={{ ...s.field, display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ ...s.fieldLabel, marginBottom: 0, minWidth: 100 }} htmlFor="console-pos">
            Run console
          </label>
          <select
            id="console-pos"
            value={settings.runConsolePosition}
            onChange={(e) =>
              updateSettings({ runConsolePosition: e.target.value as 'bottom' | 'side' | 'tab' })
            }
            style={s.select}
            aria-label="Run console position"
          >
            <option value="bottom">Bottom panel</option>
            <option value="side">Side panel</option>
            <option value="tab">Separate tab</option>
          </select>
        </div>

        {/* Disallowed paths */}
        <div style={s.field}>
          <label style={s.fieldLabel} htmlFor="disallowed-paths">
            Disallowed paths{' '}
            <span style={{ fontWeight: 400 }}>(one per line — agent cannot write these files)</span>
          </label>
          <textarea
            id="disallowed-paths"
            value={(settings.disallowedPaths ?? []).join('\n')}
            onChange={(e) =>
              updateSettings({
                disallowedPaths: e.target.value
                  .split('\n')
                  .map((l) => l.trim())
                  .filter(Boolean),
              })
            }
            rows={4}
            style={{
              ...s.input,
              flex: 'none',
              width: '100%',
              resize: 'vertical',
              fontFamily: 'monospace',
              fontSize: 12,
            }}
            aria-label="Disallowed paths"
          />
        </div>

        {/* Safety toggles */}
        <div style={{ marginBottom: 12 }}>
          <div style={s.toggle}>
            <Toggle
              checked={settings.requireCleanTreeForImplement}
              onChange={(v) => updateSettings({ requireCleanTreeForImplement: v })}
              label="Require clean git tree before Implement"
            />
            <span>Require clean git tree before Implement</span>
          </div>
          <div style={s.toggle}>
            <Toggle
              checked={settings.createCheckpointBeforeImplement}
              onChange={(v) => updateSettings({ createCheckpointBeforeImplement: v })}
              label="Create git checkpoint before Implement"
            />
            <span>Create git checkpoint before Implement</span>
          </div>
        </div>

        {/* Global save */}
        <button
          style={s.saveBtn}
          onClick={handleSaveSettings}
          aria-label="Save agent runner settings"
        >
          <Save size={13} /> Save settings
        </button>
        {settingsSaved && (
          <div style={s.saved}>
            <CheckCircle size={12} /> Settings saved
          </div>
        )}
      </div>
    </div>
  )
}
