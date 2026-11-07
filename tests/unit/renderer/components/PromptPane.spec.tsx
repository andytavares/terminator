import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PromptPane } from '../../../../src/renderer/components/home/PromptPane'
import { startingWhen, type WhenValue } from '../../../../src/renderer/components/home/WhenChoices'
import { useStartWorkStore } from '../../../../src/renderer/components/home/start-work'
import { useHomeView } from '../../../../src/renderer/components/home/home-view'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
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

const list = vi.fn()
const once: WhenValue = { ...startingWhen('2099-01-02'), when: 'once' }

beforeEach(() => {
  list.mockResolvedValue({ data: [triage, { ...triage, id: 's2' }] })
  installElectronApi({ schedules: { list } })
  useStartWorkStore.getState().openLauncher('')
  useHomeView.setState({ view: 'desk' })
  useExtensionRegistry.setState({ activeGlobalTabId: null })
})

const shown = async (when: WhenValue) => {
  render(<PromptPane query="" onType={vi.fn()} when={when} onWhen={vi.fn()} />)
  await act(async () => {})
}

describe('PromptPane — the scheduled runs line', () => {
  it('counts the saved runs and its link opens them on Home', async () => {
    await shown(once)
    expect(screen.getByText(/2 scheduled runs ·/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Manage on Home' }))
    expect(useStartWorkStore.getState().open).toBe(false)
    expect(useHomeView.getState().view).toBe('scheduled')
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
  })

  it('says one scheduled run when only one is saved', async () => {
    list.mockResolvedValue({ data: [triage] })
    await shown(once)
    expect(screen.getByText(/1 scheduled run ·/)).toBeTruthy()
  })
})

describe('PromptPane — when the scheduled runs line is not shown', () => {
  it('is not shown for Now, with no saved runs, or while editing a run', async () => {
    const { unmount } = render(
      <PromptPane query="" onType={vi.fn()} when={startingWhen('2099-01-02')} onWhen={vi.fn()} />
    )
    await act(async () => {})
    expect(screen.queryByRole('button', { name: 'Manage on Home' })).toBeNull()
    unmount()
    useStartWorkStore.getState().openLauncher('', triage)
    await shown(once)
    expect(screen.queryByRole('button', { name: 'Manage on Home' })).toBeNull()
  })

  it('is not shown when no run is saved', async () => {
    list.mockResolvedValue({ data: [] })
    await shown(once)
    expect(screen.queryByRole('button', { name: 'Manage on Home' })).toBeNull()
  })
})
