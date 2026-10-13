import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { installBridge, eventually, task } from './helpers/bridge'
import { invalidateSmartInputCache } from '../../src/components/SmartTaskInput'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'
import { useVaultDataStore } from '../../src/stores/vault-data.store'
import { InboxView } from '../../src/components/InboxView'

vi.setConfig({ testTimeout: 30_000 })

let bridge: ReturnType<typeof installBridge>

const ITEMS = [
  task('i1', 'buy stamps', {
    project: 'Home Admin',
    context: 'out',
    area: 'Life',
    dueDate: '2026-02-01',
  }),
  task('i2', 'idea'),
]

beforeEach(() => {
  invalidateSmartInputCache()
  bridge = installBridge({
    extension: { getSettingsValues: vi.fn().mockResolvedValue({ values: {} }) },
  })
  bridge.responses['task-vault:vault:get-inbox'] = { tasks: ITEMS }
  bridge.responses['task-vault:projects:list'] = { projects: [] }
  bridge.responses['task-vault:vault:list-areas'] = { areas: [] }
  bridge.responses['task-vault:vault:get-today'] = { date: '2026-01-05', tasks: [] }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const inboxLoads = () => bridge.calls('task-vault:vault:get-inbox').length

describe('InboxView list', inboxListTests)
describe('InboxView items', inboxItemTests)
describe('InboxView processing', inboxProcessingTests)

function inboxListTests() {
  describe('listing', inboxListListingTests)
  describe('capturing and reloading', inboxListCapturingAndReloadingTests)
}

function inboxListListingTests() {
  it('lists the items with their tags and keeps the sidebar count in step', async () => {
    render(<InboxView />)
    expect(await screen.findByText('2 items')).toBeTruthy()
    expect(screen.getByText('@Home Admin')).toBeTruthy()
    expect(screen.getByText('+out')).toBeTruthy()
    expect(screen.getByText('due:2026-02-01')).toBeTruthy()
    expect(useVaultDataStore.getState().inboxCount).toBe(2)
  })
}

function inboxListCapturingAndReloadingTests() {
  it('captures a new item and reloads', async () => {
    render(<InboxView />)
    await screen.findByText('2 items')
    const capture = screen.getByRole('button', { name: 'Capture' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  new thing ' } })
    fireEvent.click(capture)
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:capture')).toEqual([{ text: 'new thing' }])
    )
    await eventually(() => expect(inboxLoads()).toBeGreaterThanOrEqual(3))
  })

  it('shows the empty state, an error, and reloads on index changes', async () => {
    bridge.responses['task-vault:vault:get-inbox'] = { tasks: [task('i9', 'solo')] }
    render(<InboxView />)
    expect(await screen.findByText('1 item')).toBeTruthy()
    bridge.responses['task-vault:vault:get-inbox'] = { tasks: [] }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('Inbox is empty.')).toBeTruthy()
    bridge.responses['task-vault:vault:get-inbox'] = { error: 'locked' }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('locked')).toBeTruthy()
  })
}

function inboxItemTests() {
  describe('editing', inboxItemEditingTests)
  describe('moving', inboxItemMovingTests)
}

function inboxItemEditingTests() {
  it('edits an item from its raw tagged text on double-click', async () => {
    render(<InboxView />)
    fireEvent.doubleClick(await screen.findByText('buy stamps'))
    const field = screen.getAllByRole('textbox')[1] as HTMLInputElement
    expect(field.value).toBe('buy stamps @Home-Admin +out #Life due:2026-02-01')
    fireEvent.change(field, { target: { value: 'buy more stamps' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:edit-task')).toEqual([
        { taskId: 'i1', text: 'buy more stamps' },
      ])
    )
  })

  it('cancels an edit', async () => {
    render(<InboxView />)
    fireEvent.doubleClick(await screen.findByText('idea'))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
}

function inboxItemMovingTests() {
  it('moves an item to today, to the backlog, or deletes it', async () => {
    render(<InboxView />)
    await screen.findByText('2 items')
    fireEvent.click(screen.getAllByRole('button', { name: "Move to Today's log" })[0])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:process-inbox-item')[0]).toMatchObject({
        taskId: 'i1',
        action: 'file',
      })
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Move to backlog' })[1])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:process-inbox-item')[1]).toEqual({
        taskId: 'i2',
        action: 'someday',
      })
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 'i1' }])
    )
  })
}

function inboxProcessingTests() {
  it('processes the inbox and returns to the daily view when done', async () => {
    useVaultNavStore.setState({ activeView: 'inbox' })
    render(<InboxView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Process inbox (GTD clarify)' }))
    expect(await screen.findByText('1 of 2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Trash it' }))
    await screen.findByText('2 of 2')
    fireEvent.click(screen.getByRole('button', { name: 'Trash it' }))
    await eventually(() => expect(useVaultNavStore.getState().activeView).toBe('daily'))
  })

  it('goes back to the list from processing', async () => {
    render(<InboxView />)
    fireEvent.click(await screen.findByRole('button', { name: 'Process inbox (GTD clarify)' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to list' }))
    expect(await screen.findByRole('button', { name: 'Process inbox (GTD clarify)' })).toBeTruthy()
  })
}
