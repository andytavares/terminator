import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, within } from '@testing-library/react'
import { ScheduledView } from '../../../../src/renderer/components/home/ScheduledView'
import { useStartWorkStore } from '../../../../src/renderer/components/home/start-work'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { installElectronApi, pushedEvent } from '../../../support/electron-api'
import type { DueSchedule, Schedule } from '../../../../src/shared/schemas/schedules.schema'
import type { Workspace } from '../../../../src/shared/types/index'
import { useScheduledRunSessions } from '../../../../src/renderer/components/home/scheduled-run-sessions'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { terminalSessionOf } from '../../../support/renderer-stores'
import { SESSION_DRAG_TYPE } from '../../../../src/renderer/components/agent/session-drag'

const revealSession = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({ revealSession }))

const triage: Schedule = {
  id: 's1',
  repoRoot: '/work/payments-api',
  prompt: 'Triage the inbox',
  runAs: 'terminal',
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

const summarise: Schedule = {
  ...triage,
  id: 's2',
  repoRoot: null,
  newWorktree: false,
  runAs: 'agent',
  prompt: 'Summarise merged pull requests',
  lastRunAt: '2026-11-05T09:00:00',
  paused: true,
}

const payments: Workspace = {
  id: 'ws-1',
  name: 'Payments',
  folderPath: '/work/payments-api',
  color: '',
  tags: [],
  createdAt: '',
  updatedAt: '',
}

const schedules = {
  list: vi.fn(),
  delete: vi.fn(),
  pause: vi.fn(),
  runNow: vi.fn(),
}
const ran = pushedEvent<[DueSchedule]>()

beforeEach(() => {
  vi.clearAllMocks()
  schedules.list.mockResolvedValue({ data: [triage, summarise] })
  schedules.delete.mockResolvedValue({ data: true })
  schedules.pause.mockResolvedValue({ data: true })
  schedules.runNow.mockResolvedValue({ data: true })
  installElectronApi({
    schedules: { ...schedules, onRun: ran.addListener },
    agents: { list: async () => ({ data: [{ id: 'claude', label: 'Claude Code' }] }) },
  })
  useWorkspaceStore.setState({ workspaces: [payments] })
  useExtensionRegistry.setState({ startWorkOptions: new Map() })
  useStartWorkStore.getState().closeLauncher()
  useToastStore.setState({ toasts: [] })
  useScheduledRunSessions.setState({ sessions: new Map() })
  useSessionStore.setState({ sessions: new Map() })
})

const shown = async () => {
  render(<ScheduledView />)
  await act(async () => {})
}
const rowOf = (prompt: string) => screen.getByText(prompt).closest('tr') as HTMLElement
const openMenu = (prompt: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${prompt}` }))
const menuItems = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((item) => item.textContent)

describe('ScheduledView — the table', () => {
  it('groups runs under Global and then the workspace name, with a summary line', async () => {
    await shown()
    const table = screen.getByRole('table', { name: 'Scheduled runs' })
    const groups = within(table)
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
    expect(groups).toEqual([
      'Global — no workspace · runs in your home folder, shows in Scratch',
      'Payments · 1',
    ])
    const summary = /^2 scheduled runs · 1 paused · next: \w{3} \d+ \w{3} 09:00, Triage the inbox$/
    expect(
      screen.getByText((_, el) => el?.tagName === 'P' && summary.test(el.textContent ?? ''))
    ).toBeTruthy()
  })

  it('shows when, last run and how each run starts', async () => {
    await shown()
    const row = rowOf('Triage the inbox')
    expect(within(row).getByText('every day at 09:00')).toBeTruthy()
    expect(within(row).getByText('Never')).toBeTruthy()
    expect(within(row).getByText('Terminal only')).toBeTruthy()
    const global = rowOf('Summarise merged pull requests')
    expect(within(global).getByText('Thu 5 Nov 09:00')).toBeTruthy()
    expect(within(global).getByText('Claude Code in an agent tab')).toBeTruthy()
  })
})

describe('ScheduledView — the table, paused runs and editing', () => {
  it('marks a paused run Paused, and its menu offers Resume', async () => {
    await shown()
    expect(within(rowOf('Summarise merged pull requests')).getByText('Paused')).toBeTruthy()
    openMenu('Summarise merged pull requests')
    expect(menuItems()).toEqual(['Run now', 'Resume', 'Edit…', 'Remove…'])
  })

  it('offers Pause for a run that is not paused', async () => {
    await shown()
    expect(within(rowOf('Triage the inbox')).queryByText('Paused')).toBeNull()
    openMenu('Triage the inbox')
    expect(menuItems()).toEqual(['Run now', 'Pause', 'Edit…', 'Remove…'])
  })

  it('opens Start work to edit the run when its row is clicked', async () => {
    await shown()
    fireEvent.click(rowOf('Triage the inbox'))
    expect(useStartWorkStore.getState()).toMatchObject({ open: true, editing: triage })
  })
})

describe('ScheduledView — the row menu', () => {
  it('pauses a run and shows the list read again', async () => {
    await shown()
    schedules.list.mockResolvedValue({ data: [{ ...triage, paused: true }, summarise] })
    openMenu('Triage the inbox')
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Pause' })))
    expect(schedules.pause).toHaveBeenCalledWith({ id: 's1', paused: true })
    expect(within(rowOf('Triage the inbox')).getByText('Paused')).toBeTruthy()
  })

  it('resumes a paused run', async () => {
    await shown()
    schedules.list.mockResolvedValue({ data: [triage, { ...summarise, paused: false }] })
    openMenu('Summarise merged pull requests')
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Resume' })))
    expect(schedules.pause).toHaveBeenCalledWith({ id: 's2', paused: false })
    expect(within(rowOf('Summarise merged pull requests')).queryByText('Paused')).toBeNull()
  })

  it('runs a run now and shows its new last run', async () => {
    await shown()
    schedules.list.mockResolvedValue({
      data: [{ ...triage, lastRunAt: '2026-11-06T10:15:00' }, summarise],
    })
    openMenu('Triage the inbox')
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Run now' })))
    expect(schedules.runNow).toHaveBeenCalledWith({ id: 's1' })
    expect(within(rowOf('Triage the inbox')).getByText('Fri 6 Nov 10:15')).toBeTruthy()
  })
})

describe('ScheduledView — the row menu, editing and failures', () => {
  it('opens Start work to edit from Edit…', async () => {
    await shown()
    openMenu('Triage the inbox')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }))
    expect(useStartWorkStore.getState()).toMatchObject({ open: true, editing: triage })
  })

  it('says in plain words when a run could not start now', async () => {
    schedules.runNow.mockResolvedValue({ error: 'failed', message: 'ZodError: id' })
    await shown()
    openMenu('Triage the inbox')
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'Run now' })))
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'Triage the inbox could not be started now.',
    ])
  })

  it('reads the list again after a run comes due', async () => {
    await shown()
    schedules.list.mockResolvedValue({ data: [summarise] })
    await act(async () =>
      ran.deliver({
        ...triage,
        unattended: { settingsPath: '', systemPromptPath: '', systemPrompt: '' },
      })
    )
    expect(screen.queryByText('Triage the inbox')).toBeNull()
  })
})

describe('ScheduledView — removing a run', () => {
  it('asks first, and keeps the run when the question is cancelled', async () => {
    await shown()
    openMenu('Triage the inbox')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove…' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove this scheduled run?' })
    expect(within(dialog).getByText('Triage the inbox')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(schedules.delete).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('removes the run on confirm and shows the list without it', async () => {
    await shown()
    schedules.list.mockResolvedValue({ data: [summarise] })
    openMenu('Triage the inbox')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove…' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove this scheduled run?' })
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' })))
    expect(schedules.delete).toHaveBeenCalledWith({ id: 's1' })
    expect(screen.queryByText('Triage the inbox')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ScheduledView — no runs', () => {
  it('says there are none and offers a new scheduled run on a repeat', async () => {
    schedules.list.mockResolvedValue({ data: [] })
    await shown()
    expect(screen.getByRole('heading', { name: 'No scheduled runs' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'New scheduled run' }))
    expect(useStartWorkStore.getState()).toMatchObject({ open: true, repeat: true, editing: null })
  })
})

/** Run s1 opened session run-1, which is open in `agentState`. */
const live = (agentState: 'working' | 'awaiting-input' | 'idle') => {
  useScheduledRunSessions.getState().record('s1', 'run-1')
  useSessionStore.setState({
    sessions: new Map([['run-1', terminalSessionOf({ id: 'run-1', projectId: 'p', agentState })]]),
  })
}

describe('ScheduledView — a run that is going', () => {
  it('says Running while its agent works, and View opens its session', async () => {
    live('working')
    await shown()
    const row = rowOf('Triage the inbox')
    expect(within(row).getByText('Running')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: 'View' }))
    expect(revealSession).toHaveBeenCalledWith('run-1')
    // View is not a press on the row, which edits the run.
    expect(useStartWorkStore.getState().open).toBe(false)
  })

  it('says Needs you while it waits on the person', async () => {
    live('awaiting-input')
    await shown()
    expect(within(rowOf('Triage the inbox')).getByText('Needs you')).toBeTruthy()
  })
})

describe('ScheduledView — a run that has finished', () => {
  it('keeps View, with no state, once the run finished and its tab is still open', async () => {
    live('idle')
    await shown()
    const row = rowOf('Triage the inbox')
    expect(within(row).queryByText('Running')).toBeNull()
    expect(within(row).getByRole('button', { name: 'View' })).toBeTruthy()
  })

  it('shows no View for a run whose tab is closed', async () => {
    useScheduledRunSessions.getState().record('s1', 'gone')
    useSessionStore.setState({ sessions: new Map() })
    await shown()
    expect(within(rowOf('Triage the inbox')).queryByRole('button', { name: 'View' })).toBeNull()
  })
})

describe('ScheduledView — dragging a run to an agent tab', () => {
  it('carries the session of a run that is open, without editing the run', async () => {
    live('working')
    await shown()
    const lastRun = within(rowOf('Triage the inbox')).getByText('Running').closest('[draggable]')!
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    fireEvent.dragStart(lastRun, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, 'run-1')
    expect(dataTransfer.effectAllowed).toBe('copy')
    expect(useStartWorkStore.getState().open).toBe(false)
  })

  it('offers nothing to drag for a run with no open session', async () => {
    await shown()
    expect(rowOf('Triage the inbox').querySelector('[draggable="true"]')).toBeNull()
  })
})
