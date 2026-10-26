import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import type { AgentsSettings as AgentsValue } from '../../../shared/types'
import './QuickActionsSettings.css'

type CustomAgent = AgentsValue['custom'][number]

const BUILT_IN_ID = 'claude'

interface Draft {
  id: string
  label: string
  commandLine: string
}

const EMPTY_DRAFT: Draft = { id: '', label: '', commandLine: '' }

/** The command, then its arguments, from one space-separated line. */
function agentFrom(draft: Draft): CustomAgent {
  const [command, ...args] = draft.commandLine.trim().split(/\s+/)
  return { id: draft.id.trim(), label: draft.label.trim(), command, args }
}

/** Why the draft cannot be saved, or null when it can. */
function problemWith(draft: Draft, custom: CustomAgent[]): string | null {
  if (!draft.id.trim()) return 'Id is required'
  if (!draft.label.trim()) return 'Label is required'
  if (!draft.commandLine.trim()) return 'Command line is required'
  const id = draft.id.trim()
  return id === BUILT_IN_ID || custom.some((a) => a.id === id) ? 'That id is already used' : null
}

export function AgentsSettings(): JSX.Element {
  const agents = useSettingsStore((s) => s.globalSettings?.agents)
  const update = useSettingsStore((s) => s.updateAgents)
  if (!agents) return <></>
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Agents</h3>
      <p className="settings-section__hint">
        Any agent that speaks the Agent Client Protocol works. Add it with the command that starts
        it, for example <code>opencode acp</code>.
      </p>
      <DefaultAgentField agents={agents} onPick={(id) => void update({ default: id })} />
      <AgentList agents={agents} update={(patch) => void update(patch)} />
      <AgentForm custom={agents.custom} onSave={(custom) => void update({ custom })} />
    </div>
  )
}

function DefaultAgentField(props: {
  agents: AgentsValue
  onPick: (id: string) => void
}): JSX.Element {
  const { agents, onPick } = props
  return (
    <div className="settings-section__field">
      <label className="settings-section__label" htmlFor="agents-default">
        Default agent
      </label>
      <select
        id="agents-default"
        className="settings-section__input"
        value={agents.default}
        onChange={(e) => onPick(e.target.value)}
      >
        <option value={BUILT_IN_ID}>Claude Code</option>
        {agents.custom.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
    </div>
  )
}

interface AgentListProps {
  agents: AgentsValue
  update: (patch: Partial<AgentsValue>) => void
}

function AgentList({ agents, update }: AgentListProps): JSX.Element | null {
  if (agents.custom.length === 0) return null
  const remove = (id: string): void =>
    update({
      custom: agents.custom.filter((a) => a.id !== id),
      ...(agents.default === id ? { default: BUILT_IN_ID } : {}),
    })
  return (
    <ul className="qa-settings-list">
      {agents.custom.map((a) => (
        <li key={a.id} className="qa-settings-list__row">
          <span className="qa-settings-list__label">{a.label}</span>
          <code className="qa-settings-list__body">{[a.command, ...a.args].join(' ')}</code>
          <button className="ext-btn ext-btn--danger" onClick={() => remove(a.id)}>
            Delete
          </button>
        </li>
      ))}
    </ul>
  )
}

/** Validates the draft; on a problem returns it, otherwise saves the agent and returns null. */
function trySave(draft: Draft, custom: CustomAgent[], onSave: (c: CustomAgent[]) => void) {
  const problem = problemWith(draft, custom)
  if (problem === null) onSave([...custom, agentFrom(draft)])
  return problem
}

function AgentForm(props: {
  custom: CustomAgent[]
  onSave: (custom: CustomAgent[]) => void
}): JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (draft === null) {
    return (
      <button className="settings-section__btn" onClick={() => setDraft(EMPTY_DRAFT)}>
        Add agent
      </button>
    )
  }
  const save = (): void => {
    const problem = trySave(draft, props.custom, props.onSave)
    setError(problem)
    if (problem === null) setDraft(null)
  }
  return (
    <div className="qa-settings-form">
      <DraftFields draft={draft} onChange={setDraft} />
      {error && <p className="qa-settings-form__error">{error}</p>}
      <FormButtons onSave={save} onCancel={() => setDraft(null)} />
    </div>
  )
}

function FormButtons(props: { onSave: () => void; onCancel: () => void }): JSX.Element {
  return (
    <div className="qa-settings-form__actions">
      <button className="settings-section__btn" onClick={props.onSave}>
        Save
      </button>
      <button className="settings-section__btn-link" onClick={props.onCancel}>
        Cancel
      </button>
    </div>
  )
}

const FIELDS: Array<{ key: keyof Draft; label: string }> = [
  { key: 'id', label: 'Id' },
  { key: 'label', label: 'Label' },
  { key: 'commandLine', label: 'Command line' },
]

function DraftFields(props: { draft: Draft; onChange: (draft: Draft) => void }): JSX.Element {
  return (
    <>
      {FIELDS.map(({ key, label }) => (
        <div className="settings-section__field" key={key}>
          <label className="settings-section__label" htmlFor={`agent-${key}`}>
            {label}
          </label>
          <input
            id={`agent-${key}`}
            className="settings-section__input"
            value={props.draft[key]}
            onChange={(e) => props.onChange({ ...props.draft, [key]: e.target.value })}
          />
        </div>
      ))}
    </>
  )
}
