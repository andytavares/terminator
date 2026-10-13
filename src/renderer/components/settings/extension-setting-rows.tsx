import React, { useEffect, useRef, useState } from 'react'
import { ListInput, listItems } from '@terminator/extension-ui'
import { dispatchNotification } from '../../lib/notifications'

// One extension's settings, drawn from the schema it registered: a row per
// value, a button per action, and its notification switches as one table.

export type SettingPropDef = {
  type: string
  label: string
  description?: string
  default: unknown
  secret?: boolean
  options?: string[]
  min?: number
  max?: number
  workspaceScoped?: boolean
  channel?: string
  confirmMessage?: string
  danger?: boolean
}

export type ExtensionSchema = {
  extensionId: string
  label: string
  description?: string
  properties: Record<string, SettingPropDef>
}

/** Reads every extension's settings schema, and the global values set for them. */
export function readExtensionSettings(sink: {
  setSchemas: (schemas: ExtensionSchema[]) => void
  setValues: (values: Record<string, unknown>) => void
}): void {
  const extension = window.electronAPI.extension
  extension
    .getSettingsSchemas()
    .then((r) => sink.setSchemas(r.schemas ?? []))
    .catch(() => {})
  extension
    .getSettingsValues()
    .then((r) => sink.setValues(r.values ?? {}))
    .catch(() => {})
}

// A naming convention, `<extensionId>.notify.<notificationKey>.(system|center|toast)`, three
// booleans per notification kind, which the settings UI groups into one table. Core never knows an
// extension's notification keys.
const NOTIFICATION_SETTING_KEY_RE = /^(.+)\.notify\.([^.]+)\.(system|center|toast)$/

type DeliveryTarget = 'system' | 'center' | 'toast'

export interface NotificationSettingRow {
  notifKey: string
  label: string
  system: string
  center: string
  toast: string
}

/** The notification switches, grouped one row per notification, and every other setting. */
export function partitionNotificationSettings(properties: Record<string, SettingPropDef>): {
  rows: NotificationSettingRow[]
  rest: [string, SettingPropDef][]
} {
  const rowsByKey = new Map<string, NotificationSettingRow>()
  const rest: [string, SettingPropDef][] = []
  for (const [key, def] of Object.entries(properties)) {
    const match = NOTIFICATION_SETTING_KEY_RE.exec(key)
    if (!match) {
      rest.push([key, def])
      continue
    }
    const [, , notifKey, target] = match
    const row = rowsByKey.get(notifKey) ?? emptyRow(notifKey, def.label)
    row[target as DeliveryTarget] = key
    rowsByKey.set(notifKey, row)
  }
  return { rows: Array.from(rowsByKey.values()), rest }
}

/** A row named by the label's part before " → " (the target it ends with is the column). */
function emptyRow(notifKey: string, label: string): NotificationSettingRow {
  return { notifKey, label: label.split(' → ')[0], system: '', center: '', toast: '' }
}

type ActionOutcome = { type: 'error' | 'warning' | 'success'; message: string }

/** What a setting action's answer means: its error, an integrity problem, or done. */
function actionOutcome(result: unknown): ActionOutcome {
  const errMsg = (result as { error?: string } | null)?.error
  const integrity = (result as { data?: { integrity?: string } } | null)?.data?.integrity
  if (errMsg) return { type: 'error', message: errMsg }
  if (integrity && integrity !== 'ok') {
    return { type: 'warning', message: `Integrity issues — ${integrity}` }
  }
  return { type: 'success', message: 'Done' }
}

/** Runs the action on its channel and says how it went. */
async function runSettingAction(def: SettingPropDef): Promise<void> {
  const notify = ({ type, message }: ActionOutcome): void =>
    dispatchNotification({ type, title: def.label, message, key: 'extensionSettingAction' })
  try {
    notify(actionOutcome(await window.electronAPI.extensionBridge.invoke(def.channel!, {})))
  } catch (err) {
    notify({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

/** A button that runs an extension's action, after its confirmation if it has one. */
export function ActionSettingRow({ def }: { def: SettingPropDef }): JSX.Element {
  const [busy, setBusy] = useState(false)

  async function run(): Promise<void> {
    if (def.confirmMessage && !window.confirm(def.confirmMessage)) return
    setBusy(true)
    await runSettingAction(def)
    setBusy(false)
  }

  return (
    <div className="extension-setting-row">
      {def.description && (
        <span className="extension-setting-row__label">
          <span className="extension-setting-row__desc">{def.description}</span>
        </span>
      )}
      <button
        className={`ext-btn${def.danger ? ' ext-btn--danger' : ''}`}
        onClick={() => void run()}
        disabled={busy}
      >
        {busy ? '…' : def.label}
      </button>
    </div>
  )
}

/** A typed value as the setting stores it: a number, a boolean, a list of lines, or the text. */
function coerce(type: string, text: string): unknown {
  if (type === 'number') return Number(text)
  if (type === 'list') return listItems(text)
  return type === 'boolean' ? text === 'true' : text
}

/** A stored value as the row edits it: a list one item per line, anything else as text. */
function settingText(value: unknown): string {
  return Array.isArray(value) ? value.join('\n') : String(value ?? '')
}

type Save = (key: string, value: unknown) => Promise<void>

/** The setting's text as edited, saved 400ms after the last edit, and saved at once if the panel
 * closes first so closing does not lose it. */
function useDebouncedSetting(propKey: string, def: SettingPropDef, save: Save) {
  const [text, setText] = useState(settingText(def.default))
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; text: string } | null>(null)
  const flush = (): void => {
    if (!pending.current) return
    clearTimeout(pending.current.timer)
    const value = pending.current.text
    pending.current = null
    void save(propKey, coerce(def.type, value))
  }
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  })
  useEffect(() => {
    const latest = flushRef
    return () => latest.current()
  }, [])
  function edit(next: string): void {
    setText(next)
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { timer: setTimeout(() => flushRef.current(), 400), text: next }
  }
  return { text, edit }
}

interface ExtensionSettingRowProps {
  propKey: string
  def: SettingPropDef
  value: unknown
  onChange: Save
}

/** One value setting: its label, description, and the control its type calls for. */
export function ExtensionSettingRow({ propKey, def, value, onChange }: ExtensionSettingRowProps) {
  const setting = useDebouncedSetting(propKey, { ...def, default: value ?? def.default }, onChange)
  const stacked = def.type === 'list' ? ' extension-setting-row--stacked' : ''
  return (
    <div className={`extension-setting-row${stacked}`}>
      <label className="extension-setting-row__label">
        {def.label}
        {def.description && <span className="extension-setting-row__desc">{def.description}</span>}
        {def.type === 'folder' && (
          <span className="ext-folder-row__path">
            {setting.text || <span className="ext-folder-row__placeholder">Not set</span>}
          </span>
        )}
      </label>
      <SettingControl def={def} text={setting.text} edit={setting.edit} />
    </div>
  )
}

interface ControlProps {
  def: SettingPropDef
  text: string
  edit: (text: string) => void
}

/** A switch, a segmented choice, a folder picker, a list box, or a text or number box. */
function SettingControl({ def, text, edit }: ControlProps): JSX.Element {
  if (def.type === 'boolean') {
    return (
      <button
        className={`ext-toggle${text === 'true' ? ' ext-toggle--on' : ''}`}
        role="switch"
        aria-checked={text === 'true'}
        aria-label={def.label}
        onClick={() => edit(text === 'true' ? 'false' : 'true')}
      />
    )
  }
  if (def.type === 'enum' && def.options) {
    return <EnumChoice options={def.options} text={text} edit={edit} />
  }
  if (def.type === 'folder') return <FolderButton edit={edit} />
  if (def.type === 'list') return <ListControl def={def} text={text} edit={edit} />
  return <TextControl def={def} text={text} edit={edit} />
}

/** A list, one item per line; the row keeps it as those lines. */
function ListControl({ def, text, edit }: ControlProps): JSX.Element {
  const save = (items: string[]) => edit(items.join('\n'))
  return <ListInput label={def.label} value={listItems(text)} onChange={save} />
}

/** A text box, masked for a secret, or a number box within the setting's bounds. */
function TextControl({ def, text, edit }: ControlProps): JSX.Element {
  return (
    <input
      className="extension-setting-row__input"
      type={def.secret ? 'password' : def.type === 'number' ? 'number' : 'text'}
      value={text}
      min={def.min}
      max={def.max}
      onChange={(e) => edit(e.target.value)}
    />
  )
}

function EnumChoice({ options, text, edit }: Omit<ControlProps, 'def'> & { options: string[] }) {
  return (
    <div className="ext-segmented">
      {options.map((opt) => (
        <button
          key={opt}
          className={`ext-segmented__btn${text === opt ? ' ext-segmented__btn--active' : ''}`}
          onClick={() => edit(opt)}
        >
          {opt.charAt(0).toUpperCase() + opt.slice(1)}
        </button>
      ))}
    </div>
  )
}

function FolderButton({ edit }: Pick<ControlProps, 'edit'>): JSX.Element {
  async function pick(): Promise<void> {
    const result = await window.electronAPI.dialog.openDirectory()
    if ('cancelled' in result) return
    edit(result.filePath)
  }
  return (
    <button className="ext-btn ext-folder-row__btn" onClick={() => void pick()}>
      Choose…
    </button>
  )
}

const NOTIFICATION_TABLE_TARGETS = [
  { target: 'system' as const, label: 'System' },
  { target: 'center' as const, label: 'In-App' },
  { target: 'toast' as const, label: 'Toast' },
]

interface NotificationTableProps {
  rows: NotificationSettingRow[]
  values: Record<string, unknown>
  onChange: Save
}

/** Each notification an extension sends, with a delivery checkbox per target. */
export function NotificationSettingsTable({ rows, values, onChange }: NotificationTableProps) {
  return (
    <div className="notification-settings">
      <label className="settings-section__label">Notifications</label>
      <table className="notification-settings-table">
        <thead>
          <tr>
            <th>Notification</th>
            {NOTIFICATION_TABLE_TARGETS.map(({ target, label }) => (
              <th key={target}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <NotificationRow key={row.notifKey} row={row} values={values} onChange={onChange} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A notification's row; a target with no stored value is on. */
function NotificationRow({
  row,
  values,
  onChange,
}: Omit<NotificationTableProps, 'rows'> & {
  row: NotificationSettingRow
}) {
  return (
    <tr>
      <td className="notification-settings-table__label">{row.label}</td>
      {NOTIFICATION_TABLE_TARGETS.map(({ target }) => {
        const fullKey = row[target]
        const checked = Boolean(values[fullKey] ?? true)
        return (
          <td key={target} className="notification-settings-table__checkbox-cell">
            <input
              type="checkbox"
              checked={checked}
              aria-label={`${row.label} → ${target}`}
              onChange={() => void onChange(fullKey, !checked)}
            />
          </td>
        )
      })}
    </tr>
  )
}
