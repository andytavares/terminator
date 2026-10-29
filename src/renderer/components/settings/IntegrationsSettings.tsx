import { useShallow } from 'zustand/react/shallow'
import React, { useEffect, useState } from 'react'
import { Check, Link2, RefreshCw, X } from 'lucide-react'
import { useIntegrationsStore } from '../../stores/integrations.store'
import { recordUse } from '../../usage/record'
import type { TrackerConnection, TrackerId } from '../../../shared/types/index'
import './IntegrationsSettings.css'

// The one place a tracker credential is entered.
//
// Nothing here ever holds or displays a secret: the input is cleared the
// moment it is handed to the main process, and what comes back is a connected
// flag plus the account the credential proved to belong to.

const TRACKER_LABELS: Record<TrackerId, string> = { linear: 'Linear' }

function statusText(connection: TrackerConnection | undefined): string {
  if (connection === undefined || !connection.connected) return 'Not connected'
  if (connection.lastError === 'auth-failed') return 'Credential rejected — reconnect'
  if (connection.account === null) return 'Connected'
  const who = connection.account.email || connection.account.name
  return `Connected as ${who}`
}

function ConnectionDot({ connection }: { connection: TrackerConnection | undefined }): JSX.Element {
  // Shape and text carry the state; the dot only reinforces it, so this stays
  // readable in greyscale (WCAG 1.4.1).
  const state =
    connection?.connected !== true ? 'off' : connection.lastError === null ? 'on' : 'error'
  return <span className={`integrations__dot integrations__dot--${state}`} aria-hidden="true" />
}

type ConnectInput = Parameters<ReturnType<typeof useIntegrationsStore.getState>['connect']>[0]

/** Sending a credential for `tracker`: busy while main verifies it, and the error it gave back,
 * cleared as soon as the operator types again. */
function useConnect(tracker: TrackerId) {
  const error = useIntegrationsStore((s) => s.connectError[tracker])
  const [busy, setBusy] = useState(false)
  async function connectTracker(input: ConnectInput): Promise<boolean> {
    setBusy(true)
    const ok = await useIntegrationsStore.getState().connect(input)
    setBusy(false)
    if (ok) recordUse('core.issues.connect')
    return ok
  }
  const clearError = (): void => useIntegrationsStore.getState().clearConnectError(tracker)
  return { busy, error, connect: connectTracker, clearError }
}

interface FieldProps {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Masked, and kept out of autofill history. */
  secret?: boolean
}

function CredentialField({ id, label, value, onChange, placeholder, secret = false }: FieldProps) {
  return (
    <>
      <label className="settings-section__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="settings-section__input"
        type={secret ? 'password' : undefined}
        autoComplete={secret ? 'off' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  )
}

function ConnectError({ error }: { error: string | undefined }) {
  if (error === undefined) return null
  return (
    <p className="integrations__error" role="alert">
      {error}
    </p>
  )
}

interface ConnectButtonProps {
  label: string
  busy: boolean
  ready: boolean
  onConnect: () => Promise<void>
}

function ConnectButton({ label, busy, ready, onConnect }: ConnectButtonProps): JSX.Element {
  return (
    <button className="ext-btn" disabled={busy || !ready} onClick={() => void onConnect()}>
      {busy ? 'Verifying…' : label}
    </button>
  )
}

/** The Linear key and optional lookup email; the key is cleared after every attempt. */
function useLinearForm() {
  const { connect, clearError, ...state } = useConnect('linear')
  const [apiKey, setApiKey] = useState('')
  const [email, setEmail] = useState('')
  async function submit(): Promise<void> {
    const ok = await connect({ tracker: 'linear', apiKey, email: email.trim() || null })
    // Cleared whatever happened — a key that was rejected should not sit in a
    // form field waiting to be screenshotted.
    setApiKey('')
    if (ok) setEmail('')
  }
  const typeKey = (value: string): void => {
    setApiKey(value)
    clearError()
  }
  return { ...state, apiKey, typeKey, email, setEmail, submit }
}

function LinearForm(): JSX.Element {
  const form = useLinearForm()
  return (
    <div className="integrations__form">
      <CredentialField
        id="linear-api-key"
        label="API key"
        secret
        value={form.apiKey}
        placeholder="lin_api_…"
        onChange={form.typeKey}
      />
      <CredentialField
        id="linear-email"
        label="Assigned-issue lookup (optional)"
        value={form.email}
        placeholder="Leave blank to use the key's own account"
        onChange={form.setEmail}
      />
      <ConnectError error={form.error} />
      <ConnectButton
        label="Connect Linear"
        busy={form.busy}
        ready={form.apiKey.trim().length > 0}
        onConnect={form.submit}
      />
    </div>
  )
}

/** What "my issues" means for a connection: the assignee email, blank for the key's own account. */
function mineText(connection: TrackerConnection | undefined): string {
  return connection?.mine.email ?? ''
}

function ConnectedPanel({ tracker }: { tracker: TrackerId }): JSX.Element {
  const connection = useIntegrationsStore((s) => s.connectionFor(tracker))
  const [mineValue, setMineValue] = useState(() => mineText(connection))

  return (
    <div className="integrations__form">
      <label className="settings-section__label" htmlFor={`${tracker}-mine`}>
        Assigned-issue lookup
      </label>
      <input
        id={`${tracker}-mine`}
        className="settings-section__input"
        value={mineValue}
        placeholder="Blank uses the key's own account"
        onChange={(e) => setMineValue(e.target.value)}
        onBlur={() => saveMine(tracker, connection, mineValue)}
      />
      <ConnectedActions tracker={tracker} />
    </div>
  )
}

/** Stores the edited lookup: a blank assignee email means the key's own account. */
function saveMine(tracker: TrackerId, connection: TrackerConnection | undefined, text: string) {
  if (connection === undefined) return
  void useIntegrationsStore
    .getState()
    .setMine(tracker, { kind: 'assignee', email: text.trim() || null })
}

function ConnectedActions({ tracker }: { tracker: TrackerId }): JSX.Element {
  const store = useIntegrationsStore.getState
  return (
    <div className="integrations__actions">
      <button className="ext-btn" onClick={() => void store().loadConnections()} title="Re-check">
        <RefreshCw />
        <span>Test</span>
      </button>
      <button className="ext-btn ext-btn--danger" onClick={() => void store().disconnect(tracker)}>
        <X />
        <span>Disconnect</span>
      </button>
    </div>
  )
}

function TrackerRow({ tracker }: { tracker: TrackerId }): JSX.Element {
  const connection = useIntegrationsStore((s) => s.connectionFor(tracker))
  const connected = connection?.connected === true

  return (
    <div className="integrations__tracker">
      <div className="integrations__header">
        <ConnectionDot connection={connection} />
        <span className="integrations__name">{TRACKER_LABELS[tracker]}</span>
        <span className="integrations__status">{statusText(connection)}</span>
        {connected && <Check className="integrations__check" />}
      </div>
      {connected ? <ConnectedPanel tracker={tracker} /> : <LinearForm />}
    </div>
  )
}

export function IntegrationsSettings(): JSX.Element {
  const { loadConnections, subscribe } = useIntegrationsStore(
    useShallow((s) => ({ loadConnections: s.loadConnections, subscribe: s.subscribe }))
  )

  useEffect(() => {
    void loadConnections()
    return subscribe()
  }, [loadConnections, subscribe])

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">
        <Link2 className="integrations__title-icon" />
        Integrations
      </h3>
      <p className="settings-section__hint">
        Credentials are verified before they are stored, encrypted with your OS keychain, and never
        leave this machine. Every part of the app reads this one connection.
      </p>
      <TrackerRow tracker="linear" />
    </div>
  )
}
