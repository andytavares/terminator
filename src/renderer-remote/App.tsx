import React, { useEffect, useState } from 'react'
import './Login.css'
import { forgetLegacyToken } from './api/remote-client'

export function App(): JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(forgetLegacyToken, [])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password }),
      })
      if (res.status === 401) {
        setError('Wrong password')
        setLoading(false)
        return
      }
      if (res.status === 403) {
        setError('Access denied')
        setLoading(false)
        return
      }
      if (res.status === 429) {
        setError('Too many attempts. Try again later')
        setLoading(false)
        return
      }
      if (!res.ok) {
        setError('Could not connect to server')
        setLoading(false)
        return
      }
      const isMobile = window.innerWidth < 1400
      const ticketEndpoint = isMobile ? '/api/mobile-ticket' : '/api/app-ticket'
      const ticketRes = await fetch(ticketEndpoint, {
        method: 'POST',
        credentials: 'same-origin',
      })
      const { ticket } = (await ticketRes.json()) as { ticket: string }
      const dest = isMobile ? '/mobile/' : '/app/'
      location.replace(`${dest}?t=${encodeURIComponent(ticket)}`)
    } catch {
      setError('Could not connect to server')
      setLoading(false)
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={(e) => void handleLogin(e)}>
        <h1 className="login__title">Terminator Remote</h1>
        <input
          className="login__input"
          type="password"
          placeholder="Password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="login__error">{error}</div>
        <button className="login__btn" type="submit" disabled={loading}>
          {loading ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}
