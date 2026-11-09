import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { App } from '../../../src/App'

const mockFetch = vi.fn()
global.fetch = mockFetch

const mockReplace = vi.fn()
beforeEach(() => {
  vi.stubGlobal('location', { ...window.location, replace: mockReplace })
  vi.stubGlobal('innerWidth', 1024)
  mockFetch.mockReset()
  mockReplace.mockReset()
  localStorage.clear()
})

describe('App — says why a login failed', () => {
  it.each([
    ['401', () => Promise.resolve({ status: 401 }), 'Wrong password'],
    ['403', () => Promise.resolve({ status: 403 }), 'Access denied'],
    [
      'a fetch error',
      () => Promise.reject(new Error('Network failure')),
      'Could not connect to server',
    ],
    ['503', () => Promise.resolve({ status: 503, ok: false }), 'Could not connect to server'],
    [
      '429',
      () => Promise.resolve({ status: 429, ok: false }),
      'Too many attempts. Try again later',
    ],
  ])('names the failure on %s', async (_response, respond, message) => {
    mockFetch.mockImplementationOnce(respond)
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByPlaceholderText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText(message)
  })
})

describe('App — logs in once with the password in the body, keeps nothing, and redirects on success', () => {
  it('logs in once with the password in the body, keeps nothing, and redirects on success', async () => {
    vi.stubGlobal('innerWidth', 1440)
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true }).mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve({ ticket: 'tok-abc' }),
    })
    render(<App />)
    await userEvent.type(screen.getByPlaceholderText('Password'), 'correct')
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/app/?t=tok-abc'))
    expect(mockFetch.mock.calls[1][0]).toBe('/api/app-ticket')

    const [loginUrl, loginInit] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(loginUrl).toBe('/api/login')
    expect(loginInit.method).toBe('POST')
    expect(JSON.parse(loginInit.body as string)).toEqual({ password: 'correct' })

    const sent = (mockFetch.mock.calls as [string, RequestInit][]).map(([, init]) => ({
      authorization: new Headers(init.headers).has('Authorization'),
      credentials: init.credentials,
    }))
    expect(sent).toEqual([
      { authorization: false, credentials: 'same-origin' },
      { authorization: false, credentials: 'same-origin' },
    ])
    expect(JSON.stringify({ ...localStorage })).not.toContain('correct')
    expect(localStorage.length).toBe(0)
  })
})

describe('App — forgets passwords an older version kept', () => {
  it('removes a password an older version left in localStorage', () => {
    localStorage.setItem('remote_token', 'old-password')
    render(<App />)
    expect(localStorage.getItem('remote_token')).toBeNull()
  })
})

describe('App — redirects to /mobile/ when viewport is narrower than 1400px', () => {
  it('redirects to /mobile/ when viewport is narrower than 1400px', async () => {
    vi.stubGlobal('innerWidth', 375)
    mockFetch.mockResolvedValueOnce({ status: 200, ok: true }).mockResolvedValueOnce({
      status: 201,
      ok: true,
      json: () => Promise.resolve({ ticket: 'mob-tok' }),
    })
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByPlaceholderText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/mobile/?t=mob-tok'))
    expect(mockFetch.mock.calls[1][0]).toBe('/api/mobile-ticket')
  })
})

describe('App — disables button and shows "Connecting…" while loading', () => {
  it('disables button and shows "Connecting…" while loading', async () => {
    let resolvePromise: (v: unknown) => void
    mockFetch.mockReturnValueOnce(new Promise((r) => (resolvePromise = r)))
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByPlaceholderText('Password'), 'pw')
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    const button = await screen.findByRole<HTMLButtonElement>('button', { name: 'Connecting…' })
    expect(button.disabled).toBe(true)
    resolvePromise!({ status: 401 })
    await screen.findByText('Wrong password')
  })
})
