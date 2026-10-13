import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { App } from '../../../src/renderer-remote/App'

const mockFetch = vi.fn()
global.fetch = mockFetch

const mockReplace = vi.fn()
Object.defineProperty(window, 'location', {
  value: { ...window.location, replace: mockReplace },
  writable: true,
})

// Allow tests to override innerWidth for mobile/desktop detection
Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1024 })

beforeEach(() => {
  mockFetch.mockReset()
  mockReplace.mockReset()
  localStorage.clear()
})

describe('App', () => {
  it('renders password input and Connect button', () => {
    render(<App />)
    expect(screen.getByPlaceholderText('Password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy()
  })

  it('shows "Wrong password" on 401 response', async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 })
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText('Wrong password')).toBeTruthy())
  })

  it('shows "Access denied" on 403 response', async () => {
    mockFetch.mockResolvedValueOnce({ status: 403 })
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText('Access denied')).toBeTruthy())
  })

  it('shows "Could not connect" on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'))
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText('Could not connect to server')).toBeTruthy())
  })

  it('shows "Could not connect" on non-success HTTP status (5xx)', async () => {
    mockFetch.mockResolvedValueOnce({ status: 503, ok: false })
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText('Could not connect to server')).toBeTruthy())
  })

  it('logs in once with the password in the body, keeps nothing, and redirects on success', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true }).mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve({ ticket: 'tok-abc' }),
    })
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'correct' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app/?t=tok-abc'))

    const [loginUrl, loginInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(loginUrl).toBe('/api/login')
    expect(loginInit.method).toBe('POST')
    expect(JSON.parse(loginInit.body as string)).toEqual({ password: 'correct' })

    for (const [, init] of mockFetch.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init?.headers).has('Authorization')).toBe(false)
      expect(init?.credentials).toBe('same-origin')
    }
    expect(JSON.stringify({ ...localStorage })).not.toContain('correct')
    expect(localStorage.length).toBe(0)
  })

  it('removes a password an older version left in localStorage', () => {
    localStorage.setItem('remote_token', 'old-password')
    render(<App />)
    expect(localStorage.getItem('remote_token')).toBeNull()
  })

  it('says to wait after too many attempts (429)', async () => {
    mockFetch.mockResolvedValueOnce({ status: 429, ok: false })
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(screen.getByText(/Too many attempts/)).toBeTruthy())
  })

  it('redirects to /mobile/ when viewport is narrower than 1400px', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true })
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true }).mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve({ ticket: 'mob-tok' }),
    })
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/mobile/?t=mob-tok'))
    expect(mockFetch.mock.calls[1][0]).toBe('/api/mobile-ticket')
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
  })

  it('redirects to /app/ when viewport is 1400px or wider', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true })
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true }).mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve({ ticket: 'desk-tok' }),
    })
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app/?t=desk-tok'))
    expect(mockFetch.mock.calls[1][0]).toBe('/api/app-ticket')
  })

  it('disables button and shows "Connecting…" while loading', async () => {
    let resolvePromise: (v: unknown) => void
    mockFetch.mockReturnValueOnce(new Promise((r) => (resolvePromise = r)))
    render(<App />)
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'pw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Connecting…' }).hasAttribute('disabled')).toBe(
        true
      )
    )
    resolvePromise!({ status: 401 })
  })
})
