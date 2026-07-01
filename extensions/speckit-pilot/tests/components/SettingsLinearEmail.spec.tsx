import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const mockCredentialsStatus = vi.fn()
const mockCredentialsSet = vi.fn()

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    credentialsStatus: mockCredentialsStatus,
    credentialsSet: mockCredentialsSet,
  }),
}))

import { SettingsView } from '../../src/components/SettingsView.js'

describe('SettingsView — Linear email', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockCredentialsSet.mockResolvedValue({ ok: true })
  })

  it('prefills the stored Linear email so it persists across visits', async () => {
    mockCredentialsStatus.mockImplementation((p: { source: string }) =>
      p.source === 'linear'
        ? Promise.resolve({ connected: true, email: 'saved@example.com' })
        : Promise.resolve({ connected: false })
    )
    render(<SettingsView />)
    await waitFor(() => {
      const input = screen.getByLabelText('Linear user email') as HTMLInputElement
      expect(input.value).toBe('saved@example.com')
    })
  })

  it('can save the email alone once connected (no api key re-entry)', async () => {
    mockCredentialsStatus.mockImplementation((p: { source: string }) =>
      p.source === 'linear'
        ? Promise.resolve({ connected: true, email: 'old@example.com' })
        : Promise.resolve({ connected: false })
    )
    render(<SettingsView />)
    const input = (await screen.findByLabelText('Linear user email')) as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('old@example.com'))
    fireEvent.change(input, { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByLabelText('Save Linear credentials'))
    await waitFor(() =>
      expect(mockCredentialsSet).toHaveBeenCalledWith({
        source: 'linear',
        apiKey: undefined,
        email: 'new@example.com',
      })
    )
  })
})
