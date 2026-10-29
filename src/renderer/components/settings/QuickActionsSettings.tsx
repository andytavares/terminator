import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { recordUse } from '../../usage/record'
import type { CustomAction, CustomActionKind, CustomActionTarget } from '../../../shared/types'
import './QuickActionsSettings.css'

type Props = { scope: 'global' } | { scope: 'workspace'; workspaceId: string }

const KIND_OPTIONS: Array<{ value: CustomActionKind; label: string }> = [
  { value: 'shell', label: 'Shell command' },
  { value: 'prompt', label: 'Agent prompt' },
]

const TARGET_OPTIONS: Record<
  CustomActionKind,
  Array<{ value: CustomActionTarget; label: string }>
> = {
  shell: [
    { value: 'focused', label: 'Focused terminal' },
    { value: 'new-tab', label: 'New tab on branch' },
  ],
  prompt: [{ value: 'agent', label: 'Focused agent session' }],
}

const VARIABLES = ['cwd', 'branch', 'worktree', 'repo', 'issue', 'selection']

function targetLabel(a: CustomAction): string {
  if (a.kind === 'prompt') return 'Focused agent session'
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

function draftOfAction(a: CustomAction): Draft {
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
  const { custom, save } = useCustomActions(props)
  const form = useActionDraft(custom, save)
  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Quick actions</h3>
      {custom.length === 0 && !form.draft && (
        <p className="settings-section__empty">No custom actions yet.</p>
      )}
      {custom.length > 0 && (
        <ActionList
          custom={custom}
          onEdit={form.startEdit}
          onRemove={(id) => save(custom.filter((a) => a.id !== id))}
        />
      )}
      {form.draft ? (
        <ActionForm form={form} draft={form.draft} />
      ) : (
        <button className="settings-section__btn" onClick={form.startAdd}>
          Add action
        </button>
      )}
    </div>
  )
}

/** The scope's custom actions, and writing the list back to that scope. */
function useCustomActions(props: Props) {
  const workspaceId = props.scope === 'workspace' ? props.workspaceId : null
  const custom =
    useSettingsStore((s) =>
      workspaceId === null
        ? s.globalSettings?.quickActions.custom
        : s.workspaceSettings.get(workspaceId)?.overrides.quickActions?.custom
    ) ?? NO_ACTIONS
  const saveCustomActions = (list: CustomAction[]): void => {
    const store = useSettingsStore.getState()
    if (workspaceId === null) void store.updateQuickActions({ custom: list })
    else void store.updateWorkspaceQuickActions(workspaceId, list)
  }
  return { custom, save: saveCustomActions }
}

const NO_ACTIONS: CustomAction[] = []

/** Why the draft cannot be saved, or null when it can. */
function validateDraft(d: Draft, custom: CustomAction[]): string | null {
  if (!d.label.trim()) return 'Label is required'
  if (!d.body.trim()) return 'Body is required'
  if (d.mnemonic.length > 1) return 'Key must be a single character'
  const clash = d.mnemonic ? custom.find((a) => a.id !== d.id && a.mnemonic === d.mnemonic) : null
  return clash ? `Key already used by ${clash.label}` : null
}

function actionFrom(draft: Draft): CustomAction {
  return {
    id: draft.id ?? crypto.randomUUID(),
    label: draft.label.trim(),
    mnemonic: draft.mnemonic || undefined,
    kind: draft.kind,
    target: draft.target,
    body: draft.body,
  }
}

/** The action being added or edited, its error, and saving it in place or at the end. */
function useActionDraft(custom: CustomAction[], save: (list: CustomAction[]) => void) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const openDraft = (next: Draft | null): void => {
    setDraft(next)
    setError(null)
  }
  function saveDraft(current: Draft): void {
    const err = validateDraft(current, custom)
    if (err) return setError(err)
    const action = actionFrom(current)
    save(current.id ? custom.map((a) => (a.id === current.id ? action : a)) : [...custom, action])
    if (!current.id) recordUse('core.quick-actions.custom-create')
    openDraft(null)
  }
  return {
    draft,
    error,
    update: (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d)),
    startAdd: () => openDraft(emptyDraft()),
    startEdit: (a: CustomAction) => openDraft(draftOfAction(a)),
    cancel: () => openDraft(null),
    saveDraft,
  }
}

type ActionDraft = ReturnType<typeof useActionDraft>

interface ActionListProps {
  custom: CustomAction[]
  onEdit: (action: CustomAction) => void
  onRemove: (id: string) => void
}

function ActionList({ custom, onEdit, onRemove }: ActionListProps): JSX.Element {
  return (
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
            <button className="ext-btn" onClick={() => onEdit(a)}>
              Edit
            </button>
            <button className="ext-btn ext-btn--danger" onClick={() => onRemove(a.id)}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  )
}

/** Label, key, kind and target, and the body, then Save and Cancel. */
function ActionForm({ form, draft }: { form: ActionDraft; draft: Draft }): JSX.Element {
  const { update } = form
  return (
    <div className="qa-settings-form">
      <TextField
        id="qa-action-label"
        label="Label"
        value={draft.label}
        onChange={(label) => update({ label })}
      />
      <TextField
        id="qa-action-key"
        label="Key"
        value={draft.mnemonic}
        maxLength={1}
        onChange={(text) => update({ mnemonic: text.slice(0, 1) })}
      />
      <KindAndTarget draft={draft} update={update} />
      <BodyField body={draft.body} onChange={(body) => update({ body })} />
      {form.error && <p className="qa-settings-form__error">{form.error}</p>}
      <FormButtons onSave={() => form.saveDraft(draft)} onCancel={form.cancel} />
    </div>
  )
}

export function FormButtons({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  return (
    <div className="qa-settings-form__actions">
      <button className="settings-section__btn" onClick={onSave}>
        Save
      </button>
      <button className="settings-section__btn-link" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

/** The kind, and a target that kind allows; changing kind resets the target to its first. */
function KindAndTarget({ draft, update }: { draft: Draft; update: ActionDraft['update'] }) {
  return (
    <>
      <SelectField
        id="qa-action-kind"
        label="Kind"
        value={draft.kind}
        options={KIND_OPTIONS}
        onChange={(kind) => update({ kind, target: TARGET_OPTIONS[kind][0].value })}
      />
      <SelectField
        id="qa-action-target"
        label="Target"
        value={draft.target}
        options={TARGET_OPTIONS[draft.kind]}
        onChange={(target) => update({ target })}
      />
    </>
  )
}

interface TextFieldProps {
  id: string
  label: string
  value: string
  maxLength?: number
  onChange: (value: string) => void
}

function TextField({ id, label, value, maxLength, onChange }: TextFieldProps): JSX.Element {
  return (
    <div className="settings-section__field">
      <label className="settings-section__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="settings-section__input"
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function BodyField({ body, onChange }: { body: string; onChange: (body: string) => void }) {
  return (
    <div className="settings-section__field">
      <label className="settings-section__label" htmlFor="qa-action-body">
        Body
      </label>
      <textarea
        id="qa-action-body"
        className="settings-section__input settings-section__textarea qa-settings-form__mono"
        rows={3}
        value={body}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="settings-section__hint">
        Variables: {VARIABLES.map((v) => `{${v}}`).join(' ')}
      </span>
    </div>
  )
}

interface SelectFieldProps<Value extends string> {
  id: string
  label: string
  value: Value
  options: ReadonlyArray<{ value: Value; label: string }>
  onChange: (value: Value) => void
}

/** A labelled drop-down of the custom-action form. */
function SelectField<Value extends string>({
  id,
  label,
  value,
  options,
  onChange,
}: SelectFieldProps<Value>): JSX.Element {
  return (
    <div className="settings-section__field">
      <label className="settings-section__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="settings-section__input"
        value={value}
        onChange={(e) => onChange(e.target.value as Value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
