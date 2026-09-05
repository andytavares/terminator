import React, { useEffect, useState } from 'react'

interface RemoteStatus {
  enabled?: boolean
  port?: number
  publicUrl?: string | null
  lanUrl?: string | null
  ngrokInstalled?: boolean
  ngrokError?: string | null
  error?: string
}

export function RemoteControlSettings(): React.JSX.Element {
  const [status, setStatus] = useState<RemoteStatus>({})
  const [port, setPort] = useState(7681)
  const [maxSubscribers, setMaxSubscribers] = useState(5)
  const [passwordInput, setPasswordInput] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [ngrokTokenInput, setNgrokTokenInput] = useState('')

  useEffect(() => {
    // Subscribe to remote status events
    const unsub = window.electronAPI.extensionBridge.on('remote:status', (data) => {
      const s = data as RemoteStatus
      setStatus(s)
    })
    // Load initial settings
    void window.electronAPI.extensionBridge
      .invoke('remote:get-settings', {})
      .then((res) => {
        const s = res as {
          enabled: boolean
          port: number
          maxSubscribers: number
          password: string
          ngrokAuthToken: string
          lanUrl?: string
          publicUrl?: string | null
        }
        if (s) {
          setPort(s.port ?? 7681)
          setMaxSubscribers(s.maxSubscribers ?? 5)
          setPasswordInput(s.password ?? '')
          setNgrokTokenInput(s.ngrokAuthToken ?? '')
          if (s.lanUrl || s.publicUrl !== undefined) {
            setStatus((prev) => ({
              ...prev,
              ...(s.lanUrl && { lanUrl: s.lanUrl }),
              ...(s.publicUrl !== undefined && { publicUrl: s.publicUrl }),
            }))
          }
        }
      })
      .catch(() => {})
    return unsub
  }, [])

  return (
    <div className="settings-section">
      {/* No heading and no on/off control here: the status band above owns both.
          Two toggles for one thing is worse than none. */}

      {/* Required before optional (FR-018). Without an account token there is no
          public address at all, which is the whole point — it used to sit below
          two settings that have sensible defaults. */}
      <div className="settings-section__field">
        <label className="settings-section__label">Account token</label>
        <span className="settings-section__hint">
          Needed to reach your terminals from outside this network. Free from{' '}
          <code>dashboard.ngrok.com</code>.
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <input
            type="password"
            className="settings-section__input"
            value={ngrokTokenInput}
            onChange={(e) => setNgrokTokenInput(e.target.value)}
            onBlur={() => {
              void window.electronAPI.extensionBridge.invoke('remote:update-ngrok-token', {
                ngrokAuthToken: ngrokTokenInput.trim(),
              })
            }}
            placeholder="Paste your account token"
            style={{ flex: 1 }}
          />
        </div>
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Port</label>
        <input
          type="number"
          className="settings-section__input"
          style={{ width: '100%', maxWidth: 200 }}
          value={port}
          min={1024}
          max={65535}
          onChange={(e) => setPort(parseInt(e.target.value, 10) || 7681)}
          onBlur={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val >= 1024 && val <= 65535) {
              void window.electronAPI.extensionBridge.invoke('remote:port-change', { port: val })
            }
          }}
        />
        <span className="settings-section__hint">
          Which port to listen on. Changing it while running restarts it.
        </span>
      </div>

      <div className="settings-section__field">
        <label className="settings-section__label">Viewers per terminal</label>
        <input
          type="number"
          className="settings-section__input"
          style={{ width: '100%', maxWidth: 200 }}
          value={maxSubscribers}
          min={1}
          max={20}
          onChange={(e) => setMaxSubscribers(parseInt(e.target.value, 10) || 1)}
          onBlur={(e) => {
            const val = parseInt(e.target.value, 10)
            if (val >= 1 && val <= 20) {
              setMaxSubscribers(val)
              void window.electronAPI.extensionBridge.invoke('remote:update-max-subscribers', {
                maxSubscribers: val,
              })
            }
          }}
        />
        <span className="settings-section__hint">
          How many browsers can watch one terminal at once. Extra viewers are turned away.
        </span>
      </div>

      {(enabled || status.enabled) && (
        <>
          {status.publicUrl ? (
            <div className="settings-section__field">
              <label className="settings-section__label">Public URL (ngrok)</label>
              <div
                className="settings-section__hint"
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}
              >
                <code
                  style={{
                    flex: 1,
                    userSelect: 'all',
                    wordBreak: 'break-all',
                    alignSelf: 'stretch',
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 9px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {status.publicUrl}
                </code>
                <button
                  className="settings-section__btn"
                  style={{ marginBottom: 0, flexShrink: 0 }}
                  onClick={() => {
                    void navigator.clipboard.writeText(status.publicUrl!)
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ) : status.ngrokInstalled === false ? (
            <div className="settings-section__field">
              <div
                className="settings-section__hint"
                style={{
                  color: 'var(--accent-warn, #e6a817)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>
                  ngrok not installed — public URL unavailable. Install:{' '}
                  <code>brew install ngrok</code>
                </span>
                <button
                  className="settings-section__btn"
                  style={{ marginBottom: 0, flexShrink: 0 }}
                  onClick={() => {
                    void navigator.clipboard.writeText('brew install ngrok')
                  }}
                >
                  Copy
                </button>
              </div>
            </div>
          ) : status.ngrokError ? (
            <div className="settings-section__field">
              <span
                className="settings-section__hint"
                style={{ color: 'var(--accent-warn, #e6a817)' }}
              >
                {status.ngrokError}
              </span>
            </div>
          ) : null}

          {(status.lanUrl || enabled) && (
            <div className="settings-section__field">
              <label className="settings-section__label">LAN URL</label>
              <div
                className="settings-section__hint"
                style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}
              >
                <code
                  style={{
                    flex: 1,
                    userSelect: 'all',
                    alignSelf: 'stretch',
                    display: 'flex',
                    alignItems: 'center',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 9px',
                    fontSize: '11px',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--text-primary)',
                  }}
                >
                  {status.lanUrl ?? `http://…:${port}`}
                </code>
                {status.lanUrl && (
                  <>
                    <button
                      className="settings-section__btn"
                      style={{ marginBottom: 0, flexShrink: 0 }}
                      onClick={() => {
                        void navigator.clipboard.writeText(status.lanUrl!)
                      }}
                    >
                      Copy
                    </button>
                    <button
                      className="settings-section__btn"
                      style={{ marginBottom: 0, flexShrink: 0 }}
                      onClick={() => {
                        void window.electronAPI.extensionBridge
                          .invoke('remote:caddyfile', { port })
                          .then((caddyfile) => navigator.clipboard.writeText(caddyfile as string))
                      }}
                    >
                      Copy Caddyfile
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

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
                  void window.electronAPI.extensionBridge
                    .invoke('remote:update-password', { password: passwordInput.trim() })
                    .then((res) => {
                      const r = res as { password?: string }
                      if (r?.password) setPasswordInput(r.password)
                    })
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
                    .then((res) => {
                      const r = res as { password?: string }
                      if (r?.password) setPasswordInput(r.password)
                    })
                }}
              >
                Generate new
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
