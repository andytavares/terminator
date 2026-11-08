import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installVaultBridge, eventually, task } from './helpers/bridge'
import { invalidateSmartInputCache } from '../../src/components/SmartTaskInput'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'
import { useVaultDataStore } from '../../src/stores/vault-data.store'
import { InboxView } from '../../src/components/InboxView'

let bridge: ReturnType<typeof installVaultBridge>

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
  bridge = installVaultBridge({
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
  it('captures the trimmed text of a new item and reloads the inbox', async () => {
    const user = userEvent.setup()
    render(<InboxView />)
    await screen.findByText('2 items')
    await user.type(screen.getByRole('textbox'), '  new thing ')
    await user.click(screen.getByRole('button', { name: 'Capture' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:capture')).toEqual([{ text: 'new thing' }])
    )
    await eventually(() => expect(inboxLoads()).toBeGreaterThanOrEqual(3))
  })

  it('shows the empty state when an index change leaves no items', async () => {
    bridge.responses['task-vault:vault:get-inbox'] = { tasks: [task('i9', 'solo')] }
    render(<InboxView />)
    expect(await screen.findByText('1 item')).toBeTruthy()
    bridge.responses['task-vault:vault:get-inbox'] = { tasks: [] }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('Inbox is empty.')).toBeTruthy()
  })

  it('shows the load error when the reload after an index change fails', async () => {
    render(<InboxView />)
    await screen.findByText('2 items')
    bridge.responses['task-vault:vault:get-inbox'] = { error: 'locked' }
    await act(async () => bridge.push('task-vault:push:index-updated', {}))
    expect(await screen.findByText('locked')).toBeTruthy()
  })
}

function inboxItemTests() {
  describe('editing', inboxItemEditingTests)
  describe('moving', inboxItemMovingTests)
  describe('deleting', inboxItemDeletingTests)
}

function inboxItemEditingTests() {
  it('edits an item from its raw tagged text on double-click and saves the new text', async () => {
    const user = userEvent.setup()
    render(<InboxView />)
    await user.dblClick(await screen.findByText('buy stamps'))
    const field = screen.getByDisplayValue('buy stamps @Home-Admin +out #Life due:2026-02-01')
    await user.clear(field)
    await user.type(field, 'buy more stamps')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:edit-task')).toEqual([
        { taskId: 'i1', text: 'buy more stamps' },
      ])
    )
  })

  it('closes the editor without saving when the edit is cancelled', async () => {
    const user = userEvent.setup()
    render(<InboxView />)
    await user.dblClick(await screen.findByText('idea'))
    await user.click(await screen.findByRole('button', { name: 'Cancel edit' }))
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })
}

function inboxItemMovingTests() {
  it("files an item on today's log", async () => {
    const user = userEvent.setup()
    render(<InboxView />)
    await screen.findByText('2 items')
    await user.click(screen.getAllByRole('button', { name: "Move to Today's log" })[0])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:process-inbox-item')).toEqual([
        expect.objectContaining({ taskId: 'i1', action: 'file' }),
      ])
    )
  })

  it('moves an item to the backlog as someday', async () => {
    const user = userEvent.setup()
    render(<InboxView />)
    await screen.findByText('2 items')
    await user.click(screen.getAllByRole('button', { name: 'Move to backlog' })[1])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:process-inbox-item')).toEqual([
        { taskId: 'i2', action: 'someday' },
      ])
    )
  })
}

function inboxItemDeletingTests() {
  it('deletes an item after confirming', async () => {
    const user = userEvent.setup()
    render(<InboxView />)
    await screen.findByText('2 items')
    await user.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 'i1' }])
    )
  })
}

function inboxProcessingTests() {
  it('processes the inbox and returns to the daily view when done', async () => {
    const user = userEvent.setup()
    useVaultNavStore.setState({ activeView: 'inbox' })
    render(<InboxView />)
    await user.click(await screen.findByRole('button', { name: 'Process inbox (GTD clarify)' }))
    expect(await screen.findByText('1 of 2')).toBeTruthy()
    await user.click(await screen.findByRole('button', { name: 'Trash it' }))
    await screen.findByText('2 of 2')
    await user.click(await screen.findByRole('button', { name: 'Trash it' }))
    await eventually(() => expect(useVaultNavStore.getState().activeView).toBe('daily'))
  })

  it('goes back to the list from processing', async () => {
    const user = userEvent.setup()
    render(<InboxView />)
    await user.click(await screen.findByRole('button', { name: 'Process inbox (GTD clarify)' }))
    await user.click(await screen.findByRole('button', { name: 'Back to list' }))
    expect(await screen.findByRole('button', { name: 'Process inbox (GTD clarify)' })).toBeTruthy()
  })
}
