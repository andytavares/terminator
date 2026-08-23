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

function LinearForm(): JSX.Element {
  const { connect, connectError, clearConnectError } = useIntegrationsStore()
  const [apiKey, setApiKey] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    setBusy(true)
    const ok = await connect({ tracker: 'linear', apiKey, email: email.trim() || null })
    setBusy(false)
    // Cleared whatever happened — a key that was rejected should not sit in a
    // form field waiting to be screenshotted.
    setApiKey('')
    if (ok) setEmail('')
  }

  return (
    <div className="integrations__form">
      <label className="settings-section__label" htmlFor="linear-api-key">
        API key
      </label>
      <input
        id="linear-api-key"
        className="settings-section__input"
        type="password"
        autoComplete="off"
        value={apiKey}
        placeholder="lin_api_…"
        onChange={(e) => {
          setApiKey(e.target.value)
          clearConnectError('linear')
        }}
      />
      <label className="settings-section__label" htmlFor="linear-email">
        Assigned-issue lookup (optional)
      </label>
      <input
        id="linear-email"
        className="settings-section__input"
        value={email}
        placeholder="Leave blank to use the key's own account"
        onChange={(e) => setEmail(e.target.value)}
      />
      {connectError.linear !== undefined && (
        <p className="integrations__error" role="alert">
          {connectError.linear}
        </p>
      )}
      <button
        className="ext-btn"
        disabled={busy || apiKey.trim().length === 0}
        onClick={() => void submit()}
      >
        {busy ? 'Verifying…' : 'Connect Linear'}
      </button>
    </div>
  )
}

function JiraForm(): JSX.Element {
  const { connect, connectError, clearConnectError } = useIntegrationsStore()
  const [site, setSite] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')
  const [jql, setJql] = useState('assignee = currentUser() AND resolution = Unresolved')
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    setBusy(true)
    const ok = await connect({
      tracker: 'jira',
      site: site.trim(),
      email: email.trim(),
      apiToken,
      jql,
    })
    setBusy(false)
    setApiToken('')
    if (ok) {
      setSite('')
      setEmail('')
    }
  }

  const ready = site.trim().length > 0 && email.trim().length > 0 && apiToken.length > 0

  return (
    <div className="integrations__form">
      <label className="settings-section__label" htmlFor="jira-site">
        Site
      </label>
      <input
        id="jira-site"
        className="settings-section__input"
        value={site}
        placeholder="your-team.atlassian.net"
        onChange={(e) => {
          setSite(e.target.value)
          clearConnectError('jira')
        }}
      />
      <label className="settings-section__label" htmlFor="jira-email">
        Account email
      </label>
      <input
        id="jira-email"
        className="settings-section__input"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label className="settings-section__label" htmlFor="jira-token">
        API token
      </label>
      <input
        id="jira-token"
        className="settings-section__input"
        type="password"
        autoComplete="off"
        value={apiToken}
        onChange={(e) => {
          setApiToken(e.target.value)
          clearConnectError('jira')
        }}
      />
      <label className="settings-section__label" htmlFor="jira-jql">
        My issues (JQL)
      </label>
      <input
        id="jira-jql"
        className="settings-section__input"
        value={jql}
        onChange={(e) => setJql(e.target.value)}
      />
      {connectError.jira !== undefined && (
        <p className="integrations__error" role="alert">
          {connectError.jira}
        </p>
      )}
      <button className="ext-btn" disabled={busy || !ready} onClick={() => void submit()}>
        {busy ? 'Verifying…' : 'Connect Jira'}
      </button>
    </div>
  )
}

function ConnectedPanel({ tracker }: { tracker: TrackerId }): JSX.Element {
  const { connectionFor, disconnect, setMine, loadConnections } = useIntegrationsStore()
  const connection = connectionFor(tracker)
  const [mineValue, setMineValue] = useState(() => {
    if (connection?.mine.kind === 'assignee') return connection.mine.email ?? ''
    return connection?.mine.kind === 'query' ? connection.mine.jql : ''
  })

  function commitMine(): void {
    if (connection === undefined) return
    void setMine(
      tracker,
      connection.mine.kind === 'assignee'
        ? { kind: 'assignee', email: mineValue.trim() || null }
        : { kind: 'query', jql: mineValue.trim() }
    )
  }

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
        onBlur={commitMine}
      />
      <div className="integrations__actions">
        <button className="ext-btn" onClick={() => void loadConnections()} title="Re-check">
          <RefreshCw />
          <span>Test</span>
        </button>
        <button className="ext-btn ext-btn--danger" onClick={() => void disconnect(tracker)}>
          <X />
          <span>Disconnect</span>
        </button>
      </div>
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
  const { loadConnections, subscribe } = useIntegrationsStore()

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
