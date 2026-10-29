import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
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

describe('FileToPicker', fileToPickerTests)
describe('FileToPicker keyboard', fileToPickerKeyboardTests)
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

  it('selects an existing destination by path, or a new one by name', async () => {
    const handlers = renderPicker('gar')
    fireEvent.mouseDown(await screen.findByText('Garden'))
    expect(handlers.onSelect).toHaveBeenCalledWith('projects/Garden.md')
    expect(bridge.recordUsage.mock.calls).toEqual([['file-to']])
    fireEvent.mouseDown(screen.getByText('Create area "gar"'))
    expect(handlers.onSelectNew).toHaveBeenCalledWith('area', 'gar')
  })

  it('says how to start when nothing matches and creating is not offered', async () => {
    render(<FileToPicker prefilledQuery="zzz" onSelect={vi.fn()} onClose={vi.fn()} />)
    expect(await screen.findByText('Type to search or create…')).toBeTruthy()
  })
}

function fileToPickerKeyboardTests() {
  it('moves the highlight with the arrows and picks it with Enter', async () => {
    const handlers = renderPicker()
    await screen.findByText('Launch')
    const input = screen.getByPlaceholderText('Search or create project / area…')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(screen.getAllByRole('listitem')[1].className).toContain('highlighted')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(handlers.onSelect).toHaveBeenCalledWith('projects/Garden.md')
  })

  it('highlights on hover, and closes on Escape or the close button', async () => {
    const handlers = renderPicker()
    fireEvent.mouseEnter(await screen.findByText('Work', { selector: '.file-to-picker__label' }))
    expect(screen.getAllByRole('listitem')[2].className).toContain('highlighted')
    fireEvent.keyDown(screen.getByPlaceholderText('Search or create project / area…'), {
      key: 'Escape',
    })
    expect(handlers.onClose).toHaveBeenCalled()
    const before = handlers.onClose.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(handlers.onClose).toHaveBeenCalledTimes(before + 1)
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
    renderProcessor()
    expect(screen.getByText('1 of 2')).toBeTruthy()
    expect(screen.getByText('@Home')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Do now — Today' }))
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
  it('finishes after the last item and keeps an item whose processing failed', async () => {
    bridge.responses['task-vault:vault:process-inbox-item'] = { error: 'boom' }
    const onDone = renderProcessor()
    fireEvent.click(screen.getByRole('button', { name: 'Trash it' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:process-inbox-item')).toHaveLength(1)
    )
    await eventually(() =>
      expect(bridge.recordUsage).toHaveBeenCalledWith('inbox-process', { failed: true })
    )
    await act(async () => undefined)
    expect(screen.getByText('1 of 2')).toBeTruthy()
    bridge.responses['task-vault:vault:process-inbox-item'] = { error: 'STALE_ID' }
    fireEvent.click(screen.getByRole('button', { name: 'Trash it' }))
    await screen.findByText('2 of 2')
    fireEvent.click(await screen.findByRole('button', { name: 'Incubate — Backlog' }))
    await eventually(() => expect(onDone).toHaveBeenCalled())
  })

  it('says when there is nothing to process', () => {
    render(<InboxProcessor items={[]} onDone={vi.fn()} />)
    expect(screen.getByText('All items processed!')).toBeTruthy()
  })
}

async function openDestination() {
  fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
  fireEvent.click(screen.getByRole('button', { name: 'No — File it' }))
  await screen.findByPlaceholderText('Search or create project / area…')
}

function inboxProcessorFilingTests() {
  describe('existing destinations', inboxProcessorFilingExistingDestinationsTests)
  describe('new destinations', inboxProcessorFilingNewDestinationsTests)
  describe('leaving', inboxProcessorFilingLeavingTests)
}

function inboxProcessorFilingExistingDestinationsTests() {
  it('files to a chosen destination', async () => {
    renderProcessor()
    await openDestination()
    fireEvent.change(screen.getByPlaceholderText('Search or create project / area…'), {
      target: { value: 'gar' },
    })
    fireEvent.mouseDown(await screen.findByText('Garden'))
    await screen.findByText('2 of 2')
    expect(bridge.calls('task-vault:vault:process-inbox-item')[0]).toMatchObject({
      action: 'file',
      destination: 'projects/Garden.md',
    })
  })
}

function inboxProcessorFilingNewDestinationsTests() {
  it('creates an area before filing to it, or files under a new project', async () => {
    renderProcessor()
    await openDestination()
    const input = screen.getByPlaceholderText('Search or create project / area…')
    fireEvent.change(input, { target: { value: 'Errands' } })
    fireEvent.mouseDown(await screen.findByText('Create area "Errands"'))
    await screen.findByText('2 of 2')
    expect(bridge.calls('task-vault:vault:create-area')).toEqual([{ name: 'Errands' }])
    await openDestination()
    fireEvent.change(screen.getByPlaceholderText('Search or create project / area…'), {
      target: { value: 'Move' },
    })
    fireEvent.mouseDown(await screen.findByText('Create project "Move"'))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:process-inbox-item')[1]).toMatchObject({
        newProjectName: 'Move',
      })
    )
  })
}

function inboxProcessorFilingLeavingTests() {
  it('goes back, or to the backlog, from the destination step', async () => {
    renderProcessor()
    await openDestination()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Can it be done in <2 minutes?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'No — File it' }))
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }))
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
    const onDone = vi.fn()
    const { rerender } = render(<InboxProcessor items={[FIRST, SECOND, THIRD]} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trash it' }))
    // What InboxView does when the vault broadcasts that the index changed.
    rerender(<InboxProcessor items={[SECOND, THIRD]} onDone={onDone} />)
    await screen.findByText(/^2 of/)
    expect(screen.getByText('Write a novel')).toBeTruthy()
  })

  it('finishes after the last item it was opened with', async () => {
    const onDone = vi.fn()
    render(<InboxProcessor items={[FIRST]} onDone={onDone} />)
    fireEvent.click(screen.getByRole('button', { name: 'Incubate — Backlog' }))
    await eventually(() => expect(onDone).toHaveBeenCalledTimes(1))
  })
}
