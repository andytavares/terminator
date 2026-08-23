import React, { useEffect, useState } from 'react'
import { CheckCircle, Save, Lock } from 'lucide-react'
import { getSpeckitAPI, type ModelChoiceView } from '../types/electron.js'
import type { PhaseGateConfig, PilotSettings } from '../types/speckit.types.js'
import { PHASE_ORDER, DEFAULT_SETTINGS } from '../types/speckit.types.js'

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

/**
 * The aliases, duplicated here so the picker renders before the main process
 * answers — and still renders if it never does.
 *
 * Duplication rather than an import because this is the renderer: the catalog
 * module reads `process.env` and talks to the network, neither of which
 * belongs on this side of the bridge.
 */
const FALLBACK_MODELS: ModelChoiceView[] = [
  { id: '', label: 'Use my Claude Code default', floating: true },
  { id: 'opus', label: 'Opus (latest)', floating: true },
  { id: 'sonnet', label: 'Sonnet (latest)', floating: true },
  { id: 'haiku', label: 'Haiku (latest)', floating: true },
  { id: 'fable', label: 'Fable (latest)', floating: true },
]

export function SettingsView() {
  const [settings, setSettings] = useState<PilotSettings>(loadSettings)
  const [settingsSaved, setSettingsSaved] = useState(false)
  // Seeded with the aliases so the box is never briefly empty: the pinned ids
  // need a round trip, and the aliases are the whole list for anyone without a
  // Models API credential anyway.
  const [models, setModels] = useState<ModelChoiceView[]>(FALLBACK_MODELS)

  useEffect(() => {
    let cancelled = false
    // Left on the seeded aliases whenever this fails, which is the honest
    // result: there is nothing extra to offer, not an error to report. Wrapped
    // rather than `.catch`ed because the bridge may not carry the channel at
    // all — an older main process throws on the call itself, not on its
    // promise, and that took the whole settings page down.
    void (async () => {
      try {
        const { models: next, selected } = await getSpeckitAPI().modelsList()
        if (cancelled) return
        if (next.length > 0) setModels(next)
        // The main process is the authority: it is what builds the launch
        // command. A local copy that disagrees would show one model in the box
        // while every run used another.
        if (typeof selected === 'string') {
          setSettings((current) =>
            current.defaultModel === selected ? current : { ...current, defaultModel: selected }
          )
        }
      } catch {
        // The aliases stand.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
      />
    )
  }

  return (
    <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
      {/* Tracker credentials moved to Settings → Integrations (ExtensionAPI
          v2.2.0). This extension holds none: it asks the application, which
          means uninstalling it orphans nothing. */}
      <div style={s.section}>
        <div style={s.label}>Ticket integrations</div>
        <div style={{ color: 'var(--tm-text-secondary)', fontSize: 13 }}>
          Linear and Jira are connected once in the application&rsquo;s own Settings → Integrations.
          The board reads that connection.
        </div>
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
            onChange={(e) => {
              const model = e.target.value
              updateSettings({ defaultModel: model })
              // Persisted where it is read from. Kept in localStorage too, so
              // the box renders before the round trip returns.
              void getSpeckitAPI()
                .modelSet({ model })
                .catch(() => {})
            }}
            style={s.select}
            aria-label="Default model"
          >
            {/* Two groups, because they age differently: an alias resolves to
                the latest of its family every time a run starts, and a pinned
                id is a decision to stay on one generation. The pinned group is
                only there at all when the environment carries a credential the
                Models API accepts, so it is absent for most people rather than
                stale for all of them. */}
            <optgroup label="Always current">
              {models
                .filter((model) => model.floating)
                .map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
            </optgroup>
            {models.some((model) => !model.floating) && (
              <optgroup label="Pin to one version">
                {models
                  .filter((model) => !model.floating)
                  .map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
              </optgroup>
            )}
            {/* A saved setting naming something the list does not offer still
                has to be selectable, or the box silently shows a different
                model from the one the runs are using. */}
            {settings.defaultModel !== '' &&
              !models.some((model) => model.id === settings.defaultModel) && (
                <option value={settings.defaultModel}>{settings.defaultModel}</option>
              )}
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
