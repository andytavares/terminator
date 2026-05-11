import React, { useState } from 'react'
import type { PhaseId, PilotSettings } from '../types/speckit.types.js'
import { PHASE_ORDER } from '../types/speckit.types.js'

interface SettingsPageProps {
  settings: PilotSettings
  onSave: (settings: PilotSettings) => Promise<void>
  onDismiss: () => void
}

type SettingsSection = 'general' | 'gates' | 'prompts' | 'cli' | 'audit' | 'telemetry'

const SECTION_LABELS: Record<SettingsSection, string> = {
  general: 'General',
  gates: 'Gates & auto-approval',
  prompts: 'Per-phase prompts',
  cli: 'CLI & binary path',
  audit: 'Audit log',
  telemetry: 'Telemetry',
}

const PHASE_LABELS: Record<PhaseId, string> = {
  constitution: 'Constitution',
  specify: 'Specify',
  clarify: 'Clarify',
  plan: 'Plan',
  checklist: 'Checklist',
  tasks: 'Tasks',
  analyze: 'Analyze',
  implement: 'Implement',
}

export function SettingsPage({ settings, onSave, onDismiss }: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>('gates')
  const [draft, setDraft] = useState<PilotSettings>(structuredClone(settings))
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  const updateGate = (phase: PhaseId, key: string, value: boolean) => {
    setDraft((prev) => ({
      ...prev,
      phaseGates: {
        ...prev.phaseGates,
        [phase]: { ...prev.phaseGates[phase], [key]: value },
      },
    }))
  }

  return (
    <div className="sk-settings">
      <div className="sk-settings__nav">
        {(Object.entries(SECTION_LABELS) as [SettingsSection, string][]).map(([key, label]) => (
          <button
            key={key}
            className={`sk-settings__nav-item${section === key ? ' sk-settings__nav-item--active' : ''}`}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="sk-settings__content">
        {section === 'general' && (
          <div className="sk-settings__section">
            <h2 className="sk-settings__section-title">General</h2>
            <div className="sk-settings__field">
              <label className="sk-form-label">Default model</label>
              <input
                className="sk-input"
                value={draft.defaultModel}
                onChange={(e) => setDraft((p) => ({ ...p, defaultModel: e.target.value }))}
              />
            </div>
            <div className="sk-settings__field">
              <label className="sk-checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.openSidebarOnStart}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, openSidebarOnStart: e.target.checked }))
                  }
                />
                Open SpecKit sidebar on project start
              </label>
            </div>
          </div>
        )}

        {section === 'gates' && (
          <div className="sk-settings__section">
            <h2 className="sk-settings__section-title">Gates &amp; auto-approval</h2>
            <p className="sk-settings__section-desc">
              Default: every phase requires an explicit human approval. You can relax this per
              phase. Implement always requires confirmation, even if "Auto-approve" is on globally.
            </p>

            <table className="sk-gates-table">
              <thead>
                <tr>
                  <th>PHASE</th>
                  <th>DEFAULT GATE</th>
                  <th>ALLOW AUTO-APPROVE</th>
                  <th>PER-FILE CONFIRM (IMPLEMENT ONLY)</th>
                </tr>
              </thead>
              <tbody>
                {PHASE_ORDER.map((phase) => {
                  const gate = draft.phaseGates[phase]
                  const isImplement = phase === 'implement'
                  const gateLabel = !gate.required
                    ? 'Optional'
                    : isImplement
                      ? 'Always required'
                      : 'Required'
                  return (
                    <tr key={phase}>
                      <td>{PHASE_LABELS[phase]}</td>
                      <td>{gateLabel}</td>
                      <td>
                        {isImplement ? (
                          '—'
                        ) : (
                          <input
                            type="checkbox"
                            checked={gate.autoApprove}
                            onChange={(e) => updateGate(phase, 'autoApprove', e.target.checked)}
                          />
                        )}
                      </td>
                      <td>
                        {isImplement ? (
                          <input
                            type="checkbox"
                            checked={gate.perFileConfirm}
                            onChange={(e) => updateGate(phase, 'perFileConfirm', e.target.checked)}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <h3 className="sk-settings__subsection-title">Hard limits</h3>
            <div className="sk-settings__grid-2">
              <div className="sk-settings__field">
                <label className="sk-form-label">MAX FILES WRITTEN PER IMPLEMENT RUN</label>
                <input
                  className="sk-input"
                  type="number"
                  value={draft.maxFilesPerImplementRun}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      maxFilesPerImplementRun: Number(e.target.value),
                    }))
                  }
                />
              </div>
              <div className="sk-settings__field">
                <label className="sk-form-label">MAX TOKENS PER COMMAND</label>
                <input
                  className="sk-input"
                  type="number"
                  value={draft.maxTokensPerCommand}
                  onChange={(e) =>
                    setDraft((p) => ({ ...p, maxTokensPerCommand: Number(e.target.value) }))
                  }
                />
              </div>
              <div className="sk-settings__field">
                <label className="sk-form-label">DISALLOWED PATHS (GLOB, NEWLINE-SEPARATED)</label>
                <textarea
                  className="sk-textarea"
                  rows={4}
                  value={draft.disallowedPaths.join('\n')}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      disallowedPaths: e.target.value.split('\n').filter(Boolean),
                    }))
                  }
                />
              </div>
            </div>

            <div className="sk-settings__checks">
              <label className="sk-checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.requireCleanTreeForImplement}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      requireCleanTreeForImplement: e.target.checked,
                    }))
                  }
                />
                Refuse to run implement on a dirty git tree
              </label>
              <label className="sk-checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.createCheckpointBeforeImplement}
                  onChange={(e) =>
                    setDraft((p) => ({
                      ...p,
                      createCheckpointBeforeImplement: e.target.checked,
                    }))
                  }
                />
                Create a checkpoint commit before each implement run
              </label>
            </div>
          </div>
        )}

        {section === 'audit' && (
          <div className="sk-settings__section">
            <h2 className="sk-settings__section-title">Audit log</h2>
            <div className="sk-settings__field">
              <label className="sk-form-label">Reviewer identity</label>
              <select
                className="sk-feature-select"
                value={draft.reviewerIdentity}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    reviewerIdentity: e.target.value as PilotSettings['reviewerIdentity'],
                  }))
                }
              >
                <option value="git">Git author (from git config)</option>
                <option value="os">OS username</option>
                <option value="custom">Custom name</option>
              </select>
            </div>
            {draft.reviewerIdentity === 'custom' && (
              <div className="sk-settings__field">
                <label className="sk-form-label">Custom reviewer name</label>
                <input
                  className="sk-input"
                  value={draft.customReviewerName ?? ''}
                  onChange={(e) => setDraft((p) => ({ ...p, customReviewerName: e.target.value }))}
                />
              </div>
            )}
          </div>
        )}

        {section === 'cli' && (
          <div className="sk-settings__section">
            <h2 className="sk-settings__section-title">CLI &amp; binary path</h2>
            <p className="sk-settings__section-desc">
              Configure how SpecKit commands are injected into Claude Code sessions.
            </p>
            <div className="sk-settings__field">
              <label className="sk-form-label">Command timeout (ms)</label>
              <input
                className="sk-input"
                type="number"
                value={draft.commandTimeoutMs}
                onChange={(e) =>
                  setDraft((p) => ({ ...p, commandTimeoutMs: Number(e.target.value) }))
                }
              />
            </div>
            <div className="sk-settings__field">
              <label className="sk-form-label">Run console position</label>
              <select
                className="sk-feature-select"
                value={draft.runConsolePosition}
                onChange={(e) =>
                  setDraft((p) => ({
                    ...p,
                    runConsolePosition: e.target.value as PilotSettings['runConsolePosition'],
                  }))
                }
              >
                <option value="bottom">Bottom</option>
                <option value="side">Side panel</option>
                <option value="tab">New tab</option>
              </select>
            </div>
          </div>
        )}

        {section === 'telemetry' && (
          <div className="sk-settings__section">
            <h2 className="sk-settings__section-title">Telemetry</h2>
            <p className="sk-settings__section-desc">
              SpecKit Pilot does not send any telemetry by default.
            </p>
          </div>
        )}

        {section === 'prompts' && (
          <div className="sk-settings__section">
            <h2 className="sk-settings__section-title">Per-phase prompts</h2>
            <p className="sk-settings__section-desc">
              Custom prompt prefixes injected before each phase command. Leave blank to use
              defaults.
            </p>
          </div>
        )}

        <div className="sk-settings__footer">
          <button
            className="sk-btn sk-btn--primary"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button className="sk-btn sk-btn--ghost" onClick={onDismiss}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
