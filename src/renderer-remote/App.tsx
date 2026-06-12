import React, { useState } from 'react'

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
      // Fetch a one-time ticket so the /app/ page can verify access without exposing credentials
      const ticketRes = await fetch('/api/app-ticket', {
        method: 'POST',
        headers: { Authorization: `Bearer ${password}` },
      })
      const { ticket } = (await ticketRes.json()) as { ticket: string }
      // Store token so the shim can pick it up, then navigate to the full app
      sessionStorage.setItem('remoteToken', password)
      location.replace(`/app/?t=${encodeURIComponent(ticket)}`)
    } catch {
      setError('Could not connect to server')
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#1a1a1a',
      }}
    >
      <form
        onSubmit={(e) => void handleLogin(e)}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 280 }}
      >
        <h2 style={{ color: '#e0e0e0', textAlign: 'center', marginBottom: 8 }}>
          Terminator Remote
        </h2>
        <input
          type="password"
          placeholder="Password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: 10,
            background: '#2a2a2a',
            border: '1px solid #444',
            color: '#e0e0e0',
            borderRadius: 4,
            fontSize: 14,
          }}
        />
        {error && <span style={{ color: '#ff6b6b', fontSize: 13 }}>{error}</span>}
        <button
          type="submit"
          disabled={loading}
          style={{
            padding: 10,
            background: loading ? '#2a5a9a' : '#4a9eff',
            border: 'none',
            color: '#fff',
            borderRadius: 4,
            cursor: loading ? 'default' : 'pointer',
            fontSize: 14,
          }}
        >
          {loading ? 'Connecting…' : 'Connect'}
        </button>
      </form>
    </div>
  )
}
