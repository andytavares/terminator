import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import type { CustomAction, CustomActionKind, CustomActionTarget } from '../../../shared/types'
import './QuickActionsSettings.css'

type Props = { scope: 'global' } | { scope: 'workspace'; workspaceId: string }

const KIND_OPTIONS: Array<{ value: CustomActionKind; label: string }> = [
  { value: 'shell', label: 'Shell command' },
  { value: 'prompt', label: 'Claude prompt' },
]

const TARGET_OPTIONS: Record<
  CustomActionKind,
  Array<{ value: CustomActionTarget; label: string }>
> = {
  shell: [
    { value: 'focused', label: 'Focused terminal' },
    { value: 'new-tab', label: 'New tab on branch' },
  ],
  prompt: [{ value: 'agent', label: 'Focused Claude session' }],
}

const VARIABLES = ['cwd', 'branch', 'worktree', 'repo', 'issue', 'selection']

function targetLabel(a: CustomAction): string {
  if (a.kind === 'prompt') return 'Focused Claude session'
  return a.target === 'new-tab' ? 'New tab on branch' : 'Focused terminal'
}

interface Draft {
  id: string | null
  label: string
  mnemonic: string
  kind: CustomActionKind
  target: CustomActionTarget
  body: string
}

function emptyDraft(): Draft {
  return { id: null, label: '', mnemonic: '', kind: 'shell', target: 'focused', body: '' }
}

function draftFrom(a: CustomAction): Draft {
  return {
    id: a.id,
    label: a.label,
    mnemonic: a.mnemonic ?? '',
    kind: a.kind,
    target: a.target,
    body: a.body,
  }
}

export function QuickActionsSettings(props: Props): JSX.Element {
  const { globalSettings, workspaceSettings, updateQuickActions, updateWorkspaceQuickActions } =
    useSettingsStore()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)

  const custom: CustomAction[] =
    props.scope === 'global'
      ? (globalSettings?.quickActions.custom ?? [])
      : (workspaceSettings.get(props.workspaceId)?.overrides.quickActions?.custom ?? [])

  function save(list: CustomAction[]): void {
    if (props.scope === 'global') void updateQuickActions({ custom: list })
    else void updateWorkspaceQuickActions(props.workspaceId, list)
  }

  function startAdd(): void {
    setDraft(emptyDraft())
    setError(null)
  }

  function startEdit(a: CustomAction): void {
    setDraft(draftFrom(a))
    setError(null)
  }

  function cancel(): void {
    setDraft(null)
    setError(null)
  }

  function remove(id: string): void {
    save(custom.filter((a) => a.id !== id))
  }

  function validate(d: Draft): string | null {
    if (!d.label.trim()) return 'Label is required'
    if (!d.body.trim()) return 'Body is required'
    if (d.mnemonic.length > 1) return 'Key must be a single character'
    if (d.mnemonic) {
      const clash = custom.find((a) => a.id !== d.id && a.mnemonic === d.mnemonic)
      if (clash) return `Key already used by ${clash.label}`
    }
    return null
  }

  function handleSave(): void {
    if (!draft) return
    const err = validate(draft)
    if (err) {
      setError(err)
      return
    }
    const action: CustomAction = {
      id: draft.id ?? crypto.randomUUID(),
      label: draft.label.trim(),
      mnemonic: draft.mnemonic || undefined,
      kind: draft.kind,
      target: draft.target,
      body: draft.body,
    }
    const next = draft.id
      ? custom.map((a) => (a.id === draft.id ? action : a))
      : [...custom, action]
    save(next)
    setDraft(null)
    setError(null)
  }

  function handleKindChange(kind: CustomActionKind): void {
    if (!draft) return
    setDraft({ ...draft, kind, target: TARGET_OPTIONS[kind][0].value })
  }

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Quick actions</h3>

      {custom.length === 0 && !draft && (
        <p className="settings-section__empty">No custom actions yet.</p>
      )}

      {custom.length > 0 && (
        <ul className="qa-settings-list">
          {custom.map((a) => (
            <li key={a.id} className="qa-settings-list__row">
              <span className="qa-settings-list__key">{a.mnemonic ?? ''}</span>
              <span className="qa-settings-list__label">{a.label}</span>
              <span className="qa-settings-list__chip">{a.kind}</span>
              <span className="qa-settings-list__target">{targetLabel(a)}</span>
              <code className="qa-settings-list__body" title={a.body}>
                {a.body}
              </code>
              <div className="qa-settings-list__actions">
                <button className="ext-btn" onClick={() => startEdit(a)}>
                  Edit
                </button>
                <button className="ext-btn ext-btn--danger" onClick={() => remove(a.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!draft && (
        <button className="settings-section__btn" onClick={startAdd}>
          Add action
        </button>
      )}

      {draft && (
        <div className="qa-settings-form">
          <div className="settings-section__field">
            <label className="settings-section__label" htmlFor="qa-action-label">
              Label
            </label>
            <input
              id="qa-action-label"
              className="settings-section__input"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            />
          </div>

          <div className="settings-section__field">
            <label className="settings-section__label" htmlFor="qa-action-key">
              Key
            </label>
            <input
              id="qa-action-key"
              className="settings-section__input"
              maxLength={1}
              value={draft.mnemonic}
              onChange={(e) => setDraft({ ...draft, mnemonic: e.target.value.slice(0, 1) })}
            />
          </div>

          <div className="settings-section__field">
            <label className="settings-section__label" htmlFor="qa-action-kind">
              Kind
            </label>
            <select
              id="qa-action-kind"
              className="settings-section__input"
              value={draft.kind}
              onChange={(e) => handleKindChange(e.target.value as CustomActionKind)}
            >
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-section__field">
            <label className="settings-section__label" htmlFor="qa-action-target">
              Target
            </label>
            <select
              id="qa-action-target"
              className="settings-section__input"
              value={draft.target}
              onChange={(e) => setDraft({ ...draft, target: e.target.value as CustomActionTarget })}
            >
              {TARGET_OPTIONS[draft.kind].map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-section__field">
            <label className="settings-section__label" htmlFor="qa-action-body">
              Body
            </label>
            <textarea
              id="qa-action-body"
              className="settings-section__input settings-section__textarea qa-settings-form__mono"
              rows={3}
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <span className="settings-section__hint">
              Variables: {VARIABLES.map((v) => `{${v}}`).join(' ')}
            </span>
          </div>

          {error && <p className="qa-settings-form__error">{error}</p>}

          <div className="qa-settings-form__actions">
            <button className="settings-section__btn" onClick={handleSave}>
              Save
            </button>
            <button className="settings-section__btn-link" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
