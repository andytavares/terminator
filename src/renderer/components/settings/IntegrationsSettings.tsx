import { useShallow } from 'zustand/react/shallow'
import React, { useEffect, useState } from 'react'
import { Check, Link2, RefreshCw, X } from 'lucide-react'
import { useIntegrationsStore } from '../../stores/integrations.store'
import type { TrackerConnection, TrackerId } from '../../../shared/types/index'
import './IntegrationsSettings.css'

// The one place a tracker credential is entered.
//
// Nothing here ever holds or displays a secret: the input is cleared the
// moment it is handed to the main process, and what comes back is a connected
// flag plus the account the credential proved to belong to.

const TRACKER_LABELS: Record<TrackerId, string> = { linear: 'Linear', jira: 'Jira' }

function statusText(connection: TrackerConnection | undefined): string {
  if (connection === undefined || !connection.connected) return 'Not connected'
  if (connection.lastError === 'auth-failed') return 'Credential rejected — reconnect'
  if (connection.account === null) return 'Connected'
  const who = connection.account.email || connection.account.name
  return connection.site === null
    ? `Connected as ${who}`
    : `Connected as ${who} · ${connection.site}`
}

function StatusDot({ connection }: { connection: TrackerConnection | undefined }): JSX.Element {
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

const DEFAULT_JQL = 'assignee = currentUser() AND resolution = Unresolved'

type JiraDraft = { site: string; email: string; apiToken: string; jql: string }

/** The Jira form's fields and sending them. The token is cleared after every attempt, the site
 * and email only once connected. */
function useJiraForm() {
  const { connect, clearError, ...state } = useConnect('jira')
  const [draft, setDraft] = useState<JiraDraft>({
    site: '',
    email: '',
    apiToken: '',
    jql: DEFAULT_JQL,
  })
  const updateDraft = (patch: Partial<JiraDraft>): void => setDraft((d) => ({ ...d, ...patch }))
  async function submit(): Promise<void> {
    const { site, email, apiToken, jql } = draft
    const ok = await connect({
      tracker: 'jira',
      site: site.trim(),
      email: email.trim(),
      apiToken,
      jql,
    })
    updateDraft(ok ? { apiToken: '', site: '', email: '' } : { apiToken: '' })
  }
  const editDraft = (patch: Partial<JiraDraft>): void => {
    updateDraft(patch)
    clearError()
  }
  const ready =
    draft.site.trim().length > 0 && draft.email.trim().length > 0 && draft.apiToken.length > 0
  return { ...state, draft, update: updateDraft, edit: editDraft, ready, submit }
}

function JiraForm(): JSX.Element {
  const form = useJiraForm()
  const { draft, update } = form
  return (
    <div className="integrations__form">
      <JiraCredentialFields form={form} />
      <CredentialField
        id="jira-jql"
        label="My issues (JQL)"
        value={draft.jql}
        onChange={(jql) => update({ jql })}
      />
      <ConnectError error={form.error} />
      <ConnectButton
        label="Connect Jira"
        busy={form.busy}
        ready={form.ready}
        onConnect={form.submit}
      />
    </div>
  )
}

/** Site, account email and API token; editing the site or token clears a rejection. */
function JiraCredentialFields({ form }: { form: ReturnType<typeof useJiraForm> }) {
  const { draft, update, edit } = form
  return (
    <>
      <CredentialField
        id="jira-site"
        label="Site"
        value={draft.site}
        placeholder="your-team.atlassian.net"
        onChange={(site) => edit({ site })}
      />
      <CredentialField
        id="jira-email"
        label="Account email"
        value={draft.email}
        onChange={(email) => update({ email })}
      />
      <CredentialField
        id="jira-token"
        label="API token"
        secret
        value={draft.apiToken}
        onChange={(apiToken) => edit({ apiToken })}
      />
    </>
  )
}

/** What "my issues" means for a connection: an assignee email, or a JQL query. */
function mineText(connection: TrackerConnection | undefined): string {
  if (connection?.mine.kind === 'assignee') return connection.mine.email ?? ''
  return connection?.mine.kind === 'query' ? connection.mine.jql : ''
}

function ConnectedPanel({ tracker }: { tracker: TrackerId }): JSX.Element {
  const connection = useIntegrationsStore((s) => s.connectionFor(tracker))
  const [mineValue, setMineValue] = useState(() => mineText(connection))
  const isAssignee = connection?.mine.kind === 'assignee'

  return (
    <div className="integrations__form">
      <label className="settings-section__label" htmlFor={`${tracker}-mine`}>
        {isAssignee ? 'Assigned-issue lookup' : 'My issues (JQL)'}
      </label>
      <input
        id={`${tracker}-mine`}
        className="settings-section__input"
        value={mineValue}
        placeholder={isAssignee ? "Blank uses the key's own account" : ''}
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
    .setMine(
      tracker,
      connection.mine.kind === 'assignee'
        ? { kind: 'assignee', email: text.trim() || null }
        : { kind: 'query', jql: text.trim() }
    )
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
        <StatusDot connection={connection} />
        <span className="integrations__name">{TRACKER_LABELS[tracker]}</span>
        <span className="integrations__status">{statusText(connection)}</span>
        {connected && <Check className="integrations__check" />}
      </div>
      {connected ? (
        <ConnectedPanel tracker={tracker} />
      ) : tracker === 'linear' ? (
        <LinearForm />
      ) : (
        <JiraForm />
      )}
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
      <TrackerRow tracker="jira" />
    </div>
  )
}
