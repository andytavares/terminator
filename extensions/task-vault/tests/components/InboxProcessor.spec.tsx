import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { installVaultBridge, eventually, indexedProject, task } from './helpers/bridge'
import { FileToPicker } from '../../src/components/FileToPicker'
import { InboxProcessor } from '../../src/components/InboxProcessor'

let bridge: ReturnType<typeof installVaultBridge>

beforeEach(() => {
  bridge = installVaultBridge()
  bridge.responses['task-vault:projects:list'] = {
    projects: [indexedProject('Launch', { area: 'Work' }), indexedProject('Garden')],
  }
  bridge.responses['task-vault:vault:list-areas'] = { areas: [{ filePath: 'Work', name: 'Work' }] }
  bridge.responses['task-vault:vault:get-inbox'] = { tasks: [] }
})

afterEach(() => cleanup())

function renderPicker(query = '') {
  const handlers = { onSelect: vi.fn(), onSelectNew: vi.fn(), onClose: vi.fn() }
  render(<FileToPicker prefilledQuery={query} {...handlers} />)
  return handlers
}

const listedOptions = () => screen.getAllByRole('listitem').map((li) => li.textContent)

const searchBox = () => screen.getByPlaceholderText('Search or create project / area…')

describe('FileToPicker', fileToPickerTests)
describe('FileToPicker choosing', fileToPickerChoosingTests)
describe('FileToPicker keyboard', fileToPickerKeyboardTests)
describe('FileToPicker hover and closing', fileToPickerClosingTests)
describe('InboxProcessor', inboxProcessorTests)
describe('InboxProcessor filing', inboxProcessorFilingTests)
describe('InboxProcessor while the inbox reloads', inboxProcessorReloadTests)

function fileToPickerTests() {
  it('lists projects with their area, then areas', async () => {
    renderPicker()
    await screen.findByText('Launch')
    expect(listedOptions()).toEqual(['@Launch#Work', '@Garden', '#Work'])
    expect(bridge.calls('task-vault:projects:list')).toEqual([{ status: ['active', 'someday'] }])
  })

  it('filters by name or area and offers to create what does not exist', async () => {
    renderPicker('@gard')
    await screen.findByText('Garden')
    expect(listedOptions()).toEqual(['@Garden', '@Create project "@gard"', '#Create area "@gard"'])
  })

  it('offers only the missing kind when the name matches exactly', async () => {
    renderPicker('work')
    await screen.findByText('Launch')
    expect(listedOptions()).toEqual(['@Launch#Work', '#Work', '@Create project "work"'])
  })

  it('says how to start when nothing matches and creating is not offered', async () => {
    render(<FileToPicker prefilledQuery="zzz" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect((await screen.findByText('Type to search or create…')).textContent).toBe(
      'Type to search or create…'
    )
  })
}

function fileToPickerChoosingTests() {
  it('selects an existing destination by its path, counting the use', async () => {
    const user = userEvent.setup()
    const handlers = renderPicker('gar')
    await user.click(await screen.findByText('Garden'))
    expect(handlers.onSelect).toHaveBeenCalledWith('projects/Garden.md')
    expect(bridge.recordUsage.mock.calls).toEqual([['file-to']])
  })

  it('selects a new destination by its kind and name', async () => {
    const user = userEvent.setup()
    const handlers = renderPicker('gar')
    await user.click(await screen.findByText('Create area "gar"'))
    expect(handlers.onSelectNew).toHaveBeenCalledWith('area', 'gar')
  })
}

function fileToPickerKeyboardTests() {
  it('moves the highlight with the arrows and picks it with Enter', async () => {
    const user = userEvent.setup()
    const handlers = renderPicker()
    await screen.findByText('Launch')
    await user.click(searchBox())
    expect(searchBox().matches(':focus')).toBe(true)
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}')
    expect(screen.getAllByRole('listitem')[1].className).toContain('highlighted')
    await user.keyboard('{Enter}')
    expect(handlers.onSelect).toHaveBeenCalledWith('projects/Garden.md')
  })
}

function fileToPickerClosingTests() {
  it('highlights the option under the pointer', async () => {
    const user = userEvent.setup()
    renderPicker()
    await user.hover(await screen.findByText('Work', { selector: '.file-to-picker__label' }))
    expect(screen.getAllByRole('listitem')[2].className).toContain('highlighted')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const handlers = renderPicker()
    await user.click(searchBox())
    expect(searchBox().matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on the close button', async () => {
    const user = userEvent.setup()
    const handlers = renderPicker()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })
}

const ITEMS = [task('i1', 'buy stamps', { project: 'Home', area: 'Life' }), task('i2', 'idea')]

function renderProcessor() {
  const onDone = vi.fn()
  render(<InboxProcessor items={ITEMS} onDone={onDone} />)
  return onDone
}

function inboxProcessorTests() {
  describe('clarifying', inboxProcessorClarifyingTests)
  describe('finishing', inboxProcessorFinishingTests)
}

function inboxProcessorClarifyingTests() {
  it('walks each item through the clarify questions', async () => {
    const user = userEvent.setup()
    renderProcessor()
    expect(screen.getByText('1 of 2')).toBeTruthy()
    expect(screen.getByText('@Home')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Yes' }))
    await user.click(screen.getByRole('button', { name: 'Do now — Today' }))
    await screen.findByText('2 of 2')
    expect(bridge.recordUsage.mock.calls).toEqual([['inbox-process']])
    expect(bridge.calls('task-vault:vault:process-inbox-item')[0]).toEqual({
      taskId: 'i1',
      action: 'do-now',
      destination: undefined,
      newProjectName: undefined,
    })
  })
}

function inboxProcessorFinishingTests() {
  it('keeps an item whose processing failed', async () => {
    const user = userEvent.setup()
    bridge.responses['task-vault:vault:process-inbox-item'] = { error: 'boom' }
    renderProcessor()
    await user.click(screen.getByRole('button', { name: 'Trash it' }))
    await eventually(() =>
      expect(bridge.recordUsage).toHaveBeenCalledWith('inbox-process', { failed: true })
    )
    await act(async () => undefined)
    expect(screen.getByText('1 of 2')).toBeTruthy()
  })

  it('moves on from an item the vault no longer has, and finishes after the last', async () => {
    const user = userEvent.setup()
    bridge.responses['task-vault:vault:process-inbox-item'] = { error: 'STALE_ID' }
    const onDone = renderProcessor()
    await user.click(screen.getByRole('button', { name: 'Trash it' }))
    await screen.findByText('2 of 2')
    await user.click(await screen.findByRole('button', { name: 'Incubate — Backlog' }))
    await eventually(() => expect(onDone).toHaveBeenCalled())
  })

  it('says when there is nothing to process', () => {
    render(<InboxProcessor items={[]} onDone={vi.fn()} />)
    expect(screen.getByText('All items processed!')).toBeTruthy()
  })
}

async function openDestination(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: 'Yes' }))
  await user.click(screen.getByRole('button', { name: 'No — File it' }))
  await screen.findByPlaceholderText('Search or create project / area…')
}

function inboxProcessorFilingTests() {
  describe('existing destinations', inboxProcessorFilingExistingDestinationsTests)
  describe('new destinations', inboxProcessorFilingNewDestinationsTests)
  describe('leaving', inboxProcessorFilingLeavingTests)
}

function inboxProcessorFilingExistingDestinationsTests() {
  it('files to a chosen destination', async () => {
    const user = userEvent.setup()
    renderProcessor()
    await openDestination(user)
    await user.clear(searchBox())
    await user.type(searchBox(), 'gar')
    await user.click(await screen.findByText('Garden'))
    await screen.findByText('2 of 2')
    expect(bridge.calls('task-vault:vault:process-inbox-item')[0]).toMatchObject({
      action: 'file',
      destination: 'projects/Garden.md',
    })
  })
}

function inboxProcessorFilingNewDestinationsTests() {
  it('creates an area before filing to it', async () => {
    const user = userEvent.setup()
    renderProcessor()
    await openDestination(user)
    await user.clear(searchBox())
    await user.type(searchBox(), 'Errands')
    await user.click(await screen.findByText('Create area "Errands"'))
    await screen.findByText('2 of 2')
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Errands' }])
  })

  it('files under a new project by its name', async () => {
    const user = userEvent.setup()
    renderProcessor()
    await openDestination(user)
    await user.clear(searchBox())
    await user.type(searchBox(), 'Move')
    await user.click(await screen.findByText('Create project "Move"'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:process-inbox-item')[0]).toMatchObject({
        newProjectName: 'Move',
      })
    )
  })
}

function inboxProcessorFilingLeavingTests() {
  it('goes back to the two-minute question from the destination step', async () => {
    const user = userEvent.setup()
    renderProcessor()
    await openDestination(user)
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Can it be done in <2 minutes?')).toBeTruthy()
  })

  it('sends the item to the backlog from the destination step', async () => {
    const user = userEvent.setup()
    renderProcessor()
    await openDestination(user)
    await user.click(screen.getByRole('button', { name: 'Backlog' }))
    await screen.findByText('2 of 2')
    expect(bridge.calls('task-vault:vault:process-inbox-item')[0]).toMatchObject({
      action: 'someday',
    })
  })
}

const FIRST = task('t1', 'Old flyer')
const SECOND = task('t2', 'Write a novel')
const THIRD = task('t3', 'Reply to Sam')

function inboxProcessorReloadTests() {
  it('offers the next item when the inbox reloads without the one just processed', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    const { rerender } = render(<InboxProcessor items={[FIRST, SECOND, THIRD]} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Trash it' }))
    // What InboxView does when the vault broadcasts that the index changed.
    rerender(<InboxProcessor items={[SECOND, THIRD]} onDone={onDone} />)
    await screen.findByText(/^2 of/)
    expect(screen.getByText('Write a novel')).toBeTruthy()
  })

  it('finishes after the last item it was opened with', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    render(<InboxProcessor items={[FIRST]} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Incubate — Backlog' }))
    await eventually(() => expect(onDone).toHaveBeenCalledTimes(1))
  })
}
