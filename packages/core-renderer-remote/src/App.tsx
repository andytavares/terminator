import React, { useEffect, useState } from 'react'
import './Login.css'
import { forgetLegacyToken } from './api/remote-client'

export function App(): React.JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(forgetLegacyToken, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const failure = await logIn(password).catch(() => UNREACHABLE)
    if (failure === null) return
    setError(failure)
    setLoading(false)
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={(e) => void handleLogin(e)}>
        <h1 className="login__title">Terminator Remote</h1>
        <PasswordInput value={password} onChange={setPassword} />
        <div className="login__error">{error}</div>
        <LoginButton loading={loading} />
      </form>
    </div>
  )
}

function PasswordInput({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <input
      className="login__input"
      type="password"
      placeholder="Password"
      value={value}
      autoFocus
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function LoginButton({ loading }: { loading: boolean }): React.JSX.Element {
  return (
    <button className="login__btn" type="submit" disabled={loading}>
      {loading ? 'Connecting…' : 'Connect'}
    </button>
  )
}

const UNREACHABLE = 'Could not connect to server'

const REFUSALS: Record<number, string> = {
  401: 'Wrong password',
  403: 'Access denied',
  429: 'Too many attempts. Try again later',
}

/** Logs in, then swaps the session for a one-time ticket to the mobile or the desktop app and
 * goes there. Resolves to why it could not, or null once it has left the page. */
async function logIn(password: string): Promise<string | null> {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password }),
  })
  const refusal = REFUSALS[res.status] ?? (res.ok ? null : UNREACHABLE)
  if (refusal !== null) return refusal
  const isMobile = window.innerWidth < 1400
  const ticketEndpoint = isMobile ? '/api/mobile-ticket' : '/api/app-ticket'
  const ticketRes = await fetch(ticketEndpoint, {
    method: 'POST',
    credentials: 'same-origin',
  })
  const { ticket } = (await ticketRes.json()) as { ticket: string }
  const dest = isMobile ? '/mobile/' : '/app/'
  location.replace(`${dest}?t=${encodeURIComponent(ticket)}`)
  return null
}
