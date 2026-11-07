import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { ScheduledRuns } from '../../../../src/renderer/components/home/WhenChoices'
import { installElectronApi } from '../../../support/electron-api'
import type { Schedule } from '../../../../src/shared/schemas/schedules.schema'

const triage: Schedule = {
  id: 's1',
  repoRoot: '/work/payments-api',
  prompt: 'Triage the inbox',
  runAs: 'agent',
  kind: 'repeat',
  repeat: { every: 1, unit: 'day', days: [], between: null, overlap: 'skip' },
  branch: null,
  time: '09:00',
  date: null,
  newWorktree: true,
  agentId: null,
  lastRunAt: null,
  paused: false,
  createdAt: '2026-11-04T08:00:00.000Z',
}

const schedules = { list: vi.fn(), delete: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  schedules.list.mockResolvedValue({ data: [triage] })
  schedules.delete.mockResolvedValue({ data: true })
  installElectronApi({ schedules })
})

describe('ScheduledRuns', () => {
  it('lists the saved runs with when they run and where', async () => {
    render(<ScheduledRuns />)
    await act(async () => {})
    expect(screen.getByText('Triage the inbox')).toBeTruthy()
    expect(screen.getByText('every day at 09:00 · payments-api')).toBeTruthy()
  })

  it('says Global for a run that belongs to no workspace', async () => {
    schedules.list.mockResolvedValue({ data: [{ ...triage, repoRoot: null, newWorktree: false }] })
    render(<ScheduledRuns />)
    await act(async () => {})
    expect(screen.getByText('every day at 09:00 · Global')).toBeTruthy()
  })

  it('removes a saved run', async () => {
    render(<ScheduledRuns />)
    await act(async () => {})
    schedules.list.mockResolvedValue({ data: [] })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove Triage the inbox' }))
    })
    expect(schedules.delete).toHaveBeenCalledWith({ id: 's1' })
    expect(screen.queryByText('Triage the inbox')).toBeNull()
  })

  it('shows nothing when no run is saved', async () => {
    schedules.list.mockResolvedValue({ data: [] })
    const { container } = render(<ScheduledRuns />)
    await act(async () => {})
    expect(container.textContent).toBe('')
  })
})
