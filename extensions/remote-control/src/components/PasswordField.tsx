import React, { useState } from 'react'

interface PasswordFieldProps {
  hasPassword: boolean
  onChanged: () => void
}

function updatePassword(password: string): Promise<{ password?: string }> {
  return window.electronAPI.extensionBridge
    .invoke('remote:update-password', { password })
    .then((result) => (result ?? {}) as { password?: string })
}

/**
 * Sets or generates the password. Only a hash is kept, so there is nothing to
 * reveal: a chosen password is known to the person who typed it, and a
 * generated one is shown here once, straight after it is made.
 */
export function PasswordField({ hasPassword, onChanged }: PasswordFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [generated, setGenerated] = useState<string | null>(null)

  async function setChosen(): Promise<void> {
    await updatePassword(draft.trim())
    setDraft('')
    onChanged()
  }

  async function generate(): Promise<void> {
    const result = await updatePassword('')
    setGenerated(result.password ?? null)
    onChanged()
  }

  return (
    <div className="settings-section__field">
      <label className="settings-section__label">Password</label>
      <span className="settings-section__hint">
        {hasPassword ? 'A password is set.' : 'No password is set, so Remote Control cannot start.'}{' '}
        It is stored only as a hash, so it cannot be shown again. Set your own or generate one.
      </span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
        <input
          type="password"
          className="settings-section__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="New password"
          style={{ flex: 1 }}
        />
        <button
          className="settings-section__btn"
          style={{ marginBottom: 0, flexShrink: 0 }}
          disabled={draft.trim() === ''}
          onClick={() => void setChosen()}
        >
          Set password
        </button>
        <button
          className="settings-section__btn"
          style={{ marginBottom: 0, flexShrink: 0 }}
          onClick={() => void generate()}
        >
          Generate new
        </button>
      </div>
      {generated !== null && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{generated}</code>
          <button
            className="settings-section__btn"
            style={{ marginBottom: 0, flexShrink: 0 }}
            onClick={() => void navigator.clipboard.writeText(generated)}
          >
            Copy
          </button>
          <button
            className="settings-section__btn"
            style={{ marginBottom: 0, flexShrink: 0 }}
            onClick={() => setGenerated(null)}
          >
            Done
          </button>
          <span className="settings-section__hint">Copy it now: it will not be shown again.</span>
        </div>
      )}
    </div>
  )
}
