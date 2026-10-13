import React, { useState } from 'react'
import { Button } from '@terminator/extension-ui'

interface PasswordFieldProps {
  hasPassword: boolean
  onChanged: () => void
}

interface PasswordEntryProps {
  onSet: (password: string) => Promise<void>
  onGenerate: () => Promise<void>
}

interface GeneratedPasswordProps {
  password: string
  onDone: () => void
}

const ROW_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  marginTop: 6,
}
const NO_SHRINK: React.CSSProperties = { flexShrink: 0 }

/** What `remote:update-password` answers: the password, when it generated one. */
interface PasswordUpdate {
  password?: string
}

function updatePassword(password: string): Promise<PasswordUpdate> {
  return window.electronAPI.extensionBridge
    .invoke('remote:update-password', { password })
    .then((result) => (result ?? {}) as PasswordUpdate)
}

/**
 * Sets or generates the password. Only a hash is kept, so there is nothing to
 * reveal: a chosen password is known to the person who typed it, and a
 * generated one is shown here once, straight after it is made.
 */
export function PasswordField({ hasPassword, onChanged }: PasswordFieldProps): React.JSX.Element {
  const [generated, setGenerated] = useState<string | null>(null)

  async function setChosen(password: string): Promise<void> {
    await updatePassword(password)
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
      <PasswordHint hasPassword={hasPassword} />
      <PasswordEntry onSet={setChosen} onGenerate={generate} />
      {generated !== null && (
        <GeneratedPassword password={generated} onDone={() => setGenerated(null)} />
      )}
    </div>
  )
}

/** A draft password to set, or a request to generate one. */
function PasswordEntry({ onSet, onGenerate }: PasswordEntryProps): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const setChosen = () => onSet(draft.trim()).then(() => setDraft(''))

  return (
    <div style={ROW_STYLE}>
      <input
        type="password"
        className="settings-section__input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="New password"
        style={{ flex: 1 }}
      />
      <Button
        size="sm"
        style={NO_SHRINK}
        disabled={draft.trim() === ''}
        onClick={() => void setChosen()}
      >
        Set password
      </Button>
      <Button size="sm" style={NO_SHRINK} onClick={() => void onGenerate()}>
        Generate new
      </Button>
    </div>
  )
}

function PasswordHint({ hasPassword }: { hasPassword: boolean }): React.JSX.Element {
  return (
    <span className="settings-section__hint">
      {hasPassword ? 'A password is set.' : 'No password is set, so Remote Control cannot start.'}{' '}
      It is stored only as a hash, so it cannot be shown again. Set your own or generate one.
    </span>
  )
}

/** A generated password, shown once with a way to copy it. */
function GeneratedPassword(props: GeneratedPasswordProps): React.JSX.Element {
  const { password, onDone } = props
  return (
    <div style={ROW_STYLE}>
      <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{password}</code>
      <Button
        size="sm"
        style={NO_SHRINK}
        onClick={() => void navigator.clipboard.writeText(password)}
      >
        Copy
      </Button>
      <Button size="sm" style={NO_SHRINK} onClick={onDone}>
        Done
      </Button>
      <span className="settings-section__hint">Copy it now: it will not be shown again.</span>
    </div>
  )
}
