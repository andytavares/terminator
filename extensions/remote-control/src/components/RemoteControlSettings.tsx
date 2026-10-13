import React, { useEffect, useId, useState } from 'react'
import { Button } from '@terminator/extension-ui'
import { PasswordField } from './PasswordField'

interface RemoteStatus {
  enabled?: boolean
  port?: number
  publicUrl?: string | null
  lanUrl?: string | null
  ngrokInstalled?: boolean
  ngrokError?: string | null
  error?: string
}

/** What `remote:get-settings` answers. */
interface StoredSettings {
  enabled: boolean
  port: number
  maxSubscribers: number
  hasPassword: boolean
  ngrokAuthToken: string
  lanUrl?: string
  publicUrl?: string | null
}

/** The values the form edits. */
interface SettingsForm {
  port: number
  maxSubscribers: number
  hasPassword: boolean
  ngrokTokenInput: string
}

type FormUpdate = (patch: Partial<SettingsForm>) => void

const DEFAULT_FORM: SettingsForm = {
  port: 7681,
  maxSubscribers: 5,
  hasPassword: false,
  ngrokTokenInput: '',
}

const ADDRESS_STYLE: React.CSSProperties = {
  flex: 1,
  userSelect: 'all',
  alignSelf: 'stretch',
  display: 'flex',
  alignItems: 'center',
  background: 'var(--tm-bg-input)',
  border: '1px solid var(--tm-border-strong)',
  borderRadius: 'var(--tm-radius-sm)',
  padding: '6px 9px',
  fontSize: '11px',
  fontFamily: 'var(--tm-font-mono)',
  color: 'var(--tm-text-primary)',
}

const ADDRESS_ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 6,
}

const WARNING_COLOR = 'var(--accent-warn, #e6a817)'

function formFromSettings(s: StoredSettings): SettingsForm {
  return {
    port: s.port ?? 7681,
    maxSubscribers: s.maxSubscribers ?? 5,
    hasPassword: s.hasPassword === true,
    ngrokTokenInput: s.ngrokAuthToken ?? '',
  }
}

function statusFromSettings(previous: RemoteStatus, s: StoredSettings): RemoteStatus {
  return {
    ...previous,
    enabled: s.enabled,
    ...(s.lanUrl && { lanUrl: s.lanUrl }),
    ...(s.publicUrl !== undefined && { publicUrl: s.publicUrl }),
  }
}

/** The server's status as broadcast, and the form's values as stored. */
function useRemoteSettings() {
  const [status, setStatus] = useState<RemoteStatus>({})
  const [form, setForm] = useState<SettingsForm>(DEFAULT_FORM)
  const updateForm: FormUpdate = (patch) => setForm((previous) => ({ ...previous, ...patch }))

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('remote:status', (data) => {
      setStatus(data as RemoteStatus)
    })
    void window.electronAPI.extensionBridge
      .invoke('remote:get-settings', {})
      .then((res) => {
        const s = res as StoredSettings
        if (!s) return
        setForm(formFromSettings(s))
        setStatus((previous) => statusFromSettings(previous, s))
      })
      .catch(() => {})
    return unsub
  }, [])

  return { status, form, updateForm }
}

interface RemoteControlSettingsProps {
  /** Called with a viewer limit once it is saved, so the status above can count against it. */
  onViewersSaved: (maxSubscribers: number) => void
}

export function RemoteControlSettings({
  onViewersSaved,
}: RemoteControlSettingsProps): React.JSX.Element {
  const { status, form, updateForm } = useRemoteSettings()
  return (
    <div className="settings-section">
      {/* No heading and no on/off control here: the status band above owns both.
          Two toggles for one thing is worse than none. */}

      {/* Required before optional (FR-018). Without an account token there is no
          public address at all, which is the whole point. */}
      <AccountTokenField form={form} updateForm={updateForm} />
      <PortField form={form} updateForm={updateForm} />
      <ViewersField form={form} updateForm={updateForm} onSaved={onViewersSaved} />
      <PasswordField
        hasPassword={form.hasPassword}
        onChanged={() => updateForm({ hasPassword: true })}
      />
      {status.enabled && <Addresses status={status} port={form.port} />}
    </div>
  )
}

const NUMBER_INPUT_STYLE: React.CSSProperties = { width: '100%', maxWidth: 200 }

/** A field's label, tied to its control so the control is named by it. */
function FieldLabel(props: { htmlFor: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <label className="settings-section__label" htmlFor={props.htmlFor}>
      {props.children}
    </label>
  )
}

interface FieldProps {
  form: SettingsForm
  updateForm: FormUpdate
}

function AccountTokenField({ form, updateForm }: FieldProps): React.JSX.Element {
  const saveToken = () => {
    void window.electronAPI.extensionBridge.invoke('remote:update-ngrok-token', {
      ngrokAuthToken: form.ngrokTokenInput.trim(),
    })
  }
  const id = useId()
  return (
    <div className="settings-section__field">
      <FieldLabel htmlFor={id}>Account token</FieldLabel>
      <span className="settings-section__hint">
        Needed to reach your terminals from outside this network. Free from{' '}
        <code>dashboard.ngrok.com</code>.
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
        <input
          id={id}
          type="password"
          className="settings-section__input"
          value={form.ngrokTokenInput}
          onChange={(e) => updateForm({ ngrokTokenInput: e.target.value })}
          onBlur={saveToken}
          placeholder="Paste your account token"
          style={{ flex: 1 }}
        />
      </div>
    </div>
  )
}

function PortField({ form, updateForm }: FieldProps): React.JSX.Element {
  const savePort = (e: React.FocusEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10)
    if (val >= 1024 && val <= 65535) {
      void window.electronAPI.extensionBridge.invoke('remote:port-change', { port: val })
    }
  }
  const id = useId()
  return (
    <div className="settings-section__field">
      <FieldLabel htmlFor={id}>Port</FieldLabel>
      <input
        id={id}
        type="number"
        className="settings-section__input"
        style={NUMBER_INPUT_STYLE}
        value={form.port}
        min={1024}
        max={65535}
        onChange={(e) => updateForm({ port: parseInt(e.target.value, 10) || 7681 })}
        onBlur={savePort}
      />
      <span className="settings-section__hint">
        Which port to listen on. Changing it while running restarts it.
      </span>
    </div>
  )
}

/** Saves a typed viewer limit; null when it is out of range and nothing was saved. */
function saveViewerLimit(text: string): number | null {
  const maxSubscribers = parseInt(text, 10)
  if (!(maxSubscribers >= 1 && maxSubscribers <= 20)) return null
  void window.electronAPI.extensionBridge.invoke('remote:update-max-subscribers', {
    maxSubscribers,
  })
  return maxSubscribers
}

function ViewersField(props: FieldProps & { onSaved: (max: number) => void }): React.JSX.Element {
  const { form, updateForm, onSaved } = props
  const saveViewers = (e: React.FocusEvent<HTMLInputElement>) => {
    const saved = saveViewerLimit(e.target.value)
    if (saved === null) return
    updateForm({ maxSubscribers: saved })
    onSaved(saved)
  }
  const id = useId()
  return (
    <div className="settings-section__field">
      <FieldLabel htmlFor={id}>Viewers per terminal</FieldLabel>
      <input
        id={id}
        type="number"
        className="settings-section__input"
        style={NUMBER_INPUT_STYLE}
        value={form.maxSubscribers}
        min={1}
        max={20}
        onChange={(e) => updateForm({ maxSubscribers: parseInt(e.target.value, 10) || 1 })}
        onBlur={saveViewers}
      />
      <span className="settings-section__hint">
        How many browsers can watch one terminal at once. Extra viewers are turned away.
      </span>
    </div>
  )
}

function Addresses({ status, port }: { status: RemoteStatus; port: number }): React.JSX.Element {
  return (
    <>
      <PublicReach status={status} />
      <LocalAddress lanUrl={status.lanUrl} port={port} />
      {status.error === 'PORT_IN_USE' && (
        <div className="settings-section__field">
          <span
            className="settings-section__hint"
            style={{ color: 'var(--accent-danger, #e05252)' }}
          >
            Port {port} is already in use. Change the port above.
          </span>
        </div>
      )}
    </>
  )
}

/** The public address, or what stands in the way of one. */
function PublicReach({ status }: { status: RemoteStatus }): React.JSX.Element | null {
  if (status.publicUrl) return <PublicAddress publicUrl={status.publicUrl} />
  if (status.ngrokInstalled === false) return <NgrokMissing />
  if (!status.ngrokError) return null
  return (
    <div className="settings-section__field">
      <span className="settings-section__hint" style={{ color: WARNING_COLOR }}>
        {status.ngrokError}
      </span>
    </div>
  )
}

function PublicAddress({ publicUrl }: { publicUrl: string }): React.JSX.Element {
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Public address</label>
      <div className="settings-section__hint" style={ADDRESS_ROW_STYLE}>
        <code style={{ ...ADDRESS_STYLE, wordBreak: 'break-all' }}>{publicUrl}</code>
        <CopyTextButton text={publicUrl} />
      </div>
    </div>
  )
}

function NgrokMissing(): React.JSX.Element {
  return (
    <div className="settings-section__field">
      <div
        className="settings-section__hint"
        style={{ color: WARNING_COLOR, display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span>
          A public address needs one more program. Install it with: <code>brew install ngrok</code>
        </span>
        <CopyTextButton text="brew install ngrok" />
      </div>
    </div>
  )
}

function LocalAddress(props: { lanUrl?: string | null; port: number }): React.JSX.Element {
  const { lanUrl, port } = props
  const copyCaddyfile = () => {
    void window.electronAPI.extensionBridge
      .invoke('remote:caddyfile', { port })
      .then((caddyfile) => navigator.clipboard.writeText(caddyfile as string))
  }
  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Local address</label>
      <div className="settings-section__hint" style={ADDRESS_ROW_STYLE}>
        <code style={ADDRESS_STYLE}>{lanUrl ?? `http://…:${port}`}</code>
        {lanUrl && (
          <>
            <CopyTextButton text={lanUrl} />
            <Button size="sm" style={{ flexShrink: 0 }} onClick={copyCaddyfile}>
              Copy Caddyfile
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

function CopyTextButton({ text }: { text: string }): React.JSX.Element {
  return (
    <Button
      size="sm"
      style={{ flexShrink: 0 }}
      onClick={() => {
        void navigator.clipboard.writeText(text)
      }}
    >
      Copy
    </Button>
  )
}
