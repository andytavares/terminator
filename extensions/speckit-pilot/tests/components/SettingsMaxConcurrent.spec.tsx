import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

vi.mock('../../src/types/electron.js', () => ({
  getSpeckitAPI: () => ({
    credentialsStatus: vi.fn().mockResolvedValue({ connected: false }),
    credentialsSet: vi.fn().mockResolvedValue({ ok: true }),
  }),
}))

import { SettingsView } from '../../src/components/SettingsView.js'

describe('SettingsView — max concurrent runs', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('defaults to 3 and writes changes to the core settings bridge', async () => {
    const set = vi.fn()
    ;(window as unknown as Record<string, unknown>).electronAPI = { settings: { set } }
    render(<SettingsView />)
    const input = (await screen.findByLabelText(
      'Maximum cards running in parallel'
    )) as HTMLInputElement
    expect(input.value).toBe('3')
    fireEvent.change(input, { target: { value: '5' } })
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('terminator.speckit-pilot.maxConcurrentRuns', 5)
    )
  })

  it('coerces values below 1 up to 1', async () => {
    const set = vi.fn()
    ;(window as unknown as Record<string, unknown>).electronAPI = { settings: { set } }
    render(<SettingsView />)
    const input = (await screen.findByLabelText(
      'Maximum cards running in parallel'
    )) as HTMLInputElement
    fireEvent.change(input, { target: { value: '0' } })
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('terminator.speckit-pilot.maxConcurrentRuns', 1)
    )
  })

  it('defaults log retention to 30 days and persists changes', async () => {
    const set = vi.fn()
    ;(window as unknown as Record<string, unknown>).electronAPI = { settings: { set } }
    render(<SettingsView />)
    const input = (await screen.findByLabelText(
      'Days to keep persisted step logs'
    )) as HTMLInputElement
    expect(input.value).toBe('30')
    fireEvent.change(input, { target: { value: '7' } })
    await waitFor(() =>
      expect(set).toHaveBeenCalledWith('terminator.speckit-pilot.logRetentionDays', 7)
    )
  })
})
