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

  it('stores token in localStorage and redirects on success', async () => {
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
    expect(localStorage.getItem('remote_token')).toBe('correct')
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
    const [[, mobileTicketOpts]] = mockFetch.mock.calls.slice(-1) as [[string, RequestInit]]
    expect(
      (mobileTicketOpts as RequestInit & { url?: string }) || mockFetch.mock.calls[1][0]
    ).toBeTruthy()
    // Verify mobile-ticket endpoint was called (second fetch call)
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
