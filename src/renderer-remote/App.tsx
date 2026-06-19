import React, { useState } from 'react'
import './Login.css'
import { setToken } from './api/remote-client'

export function App(): JSX.Element {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/workspaces', {
        headers: { Authorization: `Bearer ${password}` },
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
      if (!res.ok) {
        setError('Could not connect to server')
        setLoading(false)
        return
      }
      const isMobile = window.innerWidth < 768
      const ticketEndpoint = isMobile ? '/api/mobile-ticket' : '/api/app-ticket'
      const ticketRes = await fetch(ticketEndpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${password}` },
      })
      const { ticket } = (await ticketRes.json()) as { ticket: string }
      setToken(password)
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
