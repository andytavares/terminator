import React, { useEffect, useState } from 'react'
import { useSettingsStore } from '../../stores/settings.store'
import { useToastStore } from '../../stores/toast.store'
import './SettingsPanel.css'

interface RemoteStatus {
  enabled?: boolean
  port?: number
  publicUrl?: string | null
  lanUrl?: string | null
  ngrokInstalled?: boolean
  ngrokError?: string | null
  error?: string
}

export function GlobalSettings(): JSX.Element {
  const {
    globalSettings,
    updateGlobalTheme,
    updateScrollbackLimit,
    updateWorktreeBaseDir,
    updateShowMetricsBar,
    updateRemoteControlEnabled,
    updateRemoteControlPort,
  } = useSettingsStore()
  const { addToast } = useToastStore()
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus>({})
  const [showPassword, setShowPassword] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [ngrokTokenInput, setNgrokTokenInput] = useState('')

  useEffect(() => {
    setPasswordInput(globalSettings?.remoteControl?.password ?? '')
  }, [globalSettings?.remoteControl?.password])

  useEffect(() => {
    setNgrokTokenInput(globalSettings?.remoteControl?.ngrokAuthToken ?? '')
  }, [globalSettings?.remoteControl?.ngrokAuthToken])

  useEffect(() => {
    const unsub = window.electronAPI.extensionBridge.on('remote:status', (data) => {
      setRemoteStatus(data as RemoteStatus)
    })
    return unsub
  }, [])

  if (!globalSettings) return <div>Loading...</div>

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Appearance</h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Theme</label>
        <div className="settings-section__radio-group">
          {(['dark', 'light'] as const).map((t) => (
            <label key={t} className="settings-section__radio">
              <input
                type="radio"
                value={t}
                checked={globalSettings.appearance.theme === t}
                onChange={() => updateGlobalTheme(t)}
              />
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </label>
          ))}
        </div>
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Terminal
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Scrollback Limit (1,000–100,000 lines)</label>
        <input
          type="number"
          className="settings-section__input"
          value={globalSettings.terminal.scrollbackLimit}
          min={1000}
          max={100000}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val >= 1000 && val <= 100000) updateScrollbackLimit(val)
          }}
        />
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Default Shell</label>
        <input
          type="text"
          className="settings-section__input"
          defaultValue={globalSettings.terminal.defaultShell}
          onBlur={(e) => {
            const val = e.target.value.trim()
            if (val) {
              window.electronAPI.settings.updateGlobal({ terminal: { defaultShell: val } })
            }
          }}
        />
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Interface
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label settings-section__label--inline">
          <input
            type="checkbox"
            checked={globalSettings.ui?.showMetricsBar ?? false}
            onChange={(e) => void updateShowMetricsBar(e.target.checked)}
          />
          Show CPU / Memory / Network bar
        </label>
        <span className="settings-section__hint">
          Displays a system metrics bar at the bottom of every screen.
        </span>
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Git
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label">Worktree Base Directory</label>
        <input
          type="text"
          className="settings-section__input"
          defaultValue={globalSettings.git.worktreeBaseDir}
          placeholder="Leave empty to use <repo>/.worktrees"
          onBlur={(e) => updateWorktreeBaseDir(e.target.value.trim())}
        />
        <span className="settings-section__hint">
          Where new git worktrees are created. Leave empty for the default (<code>.worktrees</code>{' '}
          inside the repo).
        </span>
      </div>

      <h3 className="settings-section__title" style={{ marginTop: 20 }}>
        Remote Control
      </h3>

      <div className="settings-section__field">
        <label className="settings-section__label settings-section__label--inline">
          <input
            type="checkbox"
            checked={globalSettings.remoteControl?.enabled ?? false}
            onChange={(e) => void updateRemoteControlEnabled(e.target.checked)}
          />
          Enable Remote Control
        </label>
        <span className="settings-section__hint">
          Starts a local server and an ngrok tunnel so you can access terminals from any browser.
        </span>
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Port (1024–65535)</label>
        <input
          type="number"
          className="settings-section__input"
          defaultValue={globalSettings.remoteControl?.port ?? 7681}
          min={1024}
          max={65535}
          disabled={globalSettings.remoteControl?.enabled ?? false}
          onBlur={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val >= 1024 && val <= 65535) {
              void updateRemoteControlPort(val)
            }
          }}
        />
        <span className="settings-section__hint">
          Local server port. Change requires re-enable.
        </span>
      </div>

      {(globalSettings.remoteControl?.enabled || remoteStatus.enabled) && (
        <>
          {remoteStatus.publicUrl ? (
            <div className="settings-section__field">
              <label className="settings-section__label">Public URL (ngrok)</label>
              <div
                className="settings-section__hint"
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}
              >
                <code style={{ flex: 1, wordBreak: 'break-all', userSelect: 'all' }}>
                  {remoteStatus.publicUrl}
                </code>
                <button
                  className="settings-section__btn"
                  style={{ marginBottom: 0, flexShrink: 0 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(remoteStatus.publicUrl!)
                    addToast({ type: 'success', message: 'Public URL copied' })
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ) : remoteStatus.ngrokInstalled === false ? (
            <div className="settings-section__field">
              <span
                className="settings-section__hint"
                style={{ color: 'var(--accent-warn, #e6a817)' }}
              >
                ngrok not installed — public URL unavailable. Install:{' '}
                <code>brew install ngrok</code>
              </span>
            </div>
          ) : remoteStatus.ngrokError ? (
            <div className="settings-section__field">
              <span
                className="settings-section__hint"
                style={{ color: 'var(--accent-warn, #e6a817)' }}
              >
                {remoteStatus.ngrokError}
              </span>
            </div>
          ) : null}

          {remoteStatus.lanUrl && (
            <div className="settings-section__field">
              <label className="settings-section__label">LAN URL</label>
              <div
                className="settings-section__hint"
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}
              >
                <code style={{ flex: 1, userSelect: 'all' }}>{remoteStatus.lanUrl}</code>
                <button
                  className="settings-section__btn"
                  style={{ marginBottom: 0, flexShrink: 0 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(remoteStatus.lanUrl!)
                    addToast({ type: 'success', message: 'LAN URL copied' })
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          )}

          {remoteStatus.error === 'PORT_IN_USE' && (
            <div className="settings-section__field">
              <span
                className="settings-section__hint"
                style={{ color: 'var(--accent-danger, #e05252)' }}
              >
                Port {globalSettings.remoteControl?.port} is already in use. Change the port above.
              </span>
            </div>
          )}

          <div className="settings-section__field">
            <label className="settings-section__label">Password</label>
            <span className="settings-section__hint">
              Used to authenticate browser access. Set your own or generate a random one.
            </span>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
              <input
                type={showPassword ? 'text' : 'password'}
                className="settings-section__input"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onBlur={() => {
                  const trimmed = passwordInput.trim()
                  if (trimmed !== (globalSettings.remoteControl?.password ?? '')) {
                    void window.electronAPI.extensionBridge
                      .invoke('remote:update-password', { password: trimmed })
                      .then(() => addToast({ type: 'success', message: 'Password saved' }))
                  }
                }}
                placeholder="Enter a password or generate one"
                style={{ flex: 1 }}
              />
              <button
                className="settings-section__btn"
                style={{ marginBottom: 0, flexShrink: 0 }}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
              <button
                className="settings-section__btn"
                style={{ marginBottom: 0, flexShrink: 0 }}
                onClick={() => {
                  void navigator.clipboard.writeText(passwordInput)
                  addToast({ type: 'success', message: 'Password copied' })
                }}
              >
                Copy
              </button>
              <button
                className="settings-section__btn"
                style={{ marginBottom: 0, flexShrink: 0 }}
                onClick={() => {
                  void window.electronAPI.extensionBridge
                    .invoke('remote:update-password', { password: '' })
                    .then(() => addToast({ type: 'success', message: 'New password generated' }))
                }}
              >
                Generate new
              </button>
            </div>
          </div>
        </>
      )}

      <div className="settings-section__field">
        <label className="settings-section__label">ngrok Auth Token</label>
        <span className="settings-section__hint">
          Required for public tunnel URL. Get yours free at <code>dashboard.ngrok.com</code>.
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <input
            type="password"
            className="settings-section__input"
            value={ngrokTokenInput}
            onChange={(e) => setNgrokTokenInput(e.target.value)}
            onBlur={() => {
              const trimmed = ngrokTokenInput.trim()
              if (trimmed !== (globalSettings.remoteControl?.ngrokAuthToken ?? '')) {
                void window.electronAPI.settings
                  .updateGlobal({ remoteControl: { ngrokAuthToken: trimmed } })
                  .then(() =>
                    addToast({ type: 'success', message: 'ngrok token saved — re-enable to apply' })
                  )
              }
            }}
            placeholder="Paste your ngrok auth token"
            style={{ flex: 1 }}
          />
        </div>
      </div>
    </div>
  )
}
