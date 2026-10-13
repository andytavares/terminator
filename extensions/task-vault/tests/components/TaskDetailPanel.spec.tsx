import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { installBridge, eventually } from './helpers/bridge'

vi.mock('../../src/utils/open-in-browser', () => ({ openInBrowser: vi.fn() }))

import { TaskDetailPanel } from '../../src/components/TaskDetailPanel'

vi.setConfig({ testTimeout: 30_000 })

let bridge: ReturnType<typeof installBridge>

beforeEach(() => {
  bridge = installBridge()
  bridge.responses['task-vault:vault:get-task-detail'] = {
    description: 'Ship **it**',
    acceptanceCriteria: '',
    devHints: 'see [docs](https://example.com)',
  }
})

afterEach(() => cleanup())

function renderPanel(taskId = 't1') {
  const onClose = vi.fn()
  const utils = render(<TaskDetailPanel taskId={taskId} taskText="Launch" onClose={onClose} />)
  return { onClose, ...utils }
}

const editButtons = () => screen.getAllByRole('button', { name: 'Edit' })
const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement

describe('TaskDetailPanel loading', loadingTests)
describe('TaskDetailPanel editing', editingTests)
describe('TaskDetailPanel keys and cancelling', keysTests)

function loadingTests() {
  it('shows each section, rendering markdown or the first line of the hint', async () => {
    renderPanel()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect((await screen.findByText('it')).tagName).toBe('STRONG')
    expect(screen.getByText('- [ ] Criterion one')).toBeTruthy()
    expect(screen.getByText('Acceptance criteria')).toBeTruthy()
  })

  it('shows an error, and closes from its header', async () => {
    bridge.responses['task-vault:vault:get-task-detail'] = { error: 'Task not found' }
    const { onClose } = renderPanel()
    expect(await screen.findByText('Task not found')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close detail panel' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows a thrown failure, and reloads for another task', async () => {
    bridge.responses['task-vault:vault:get-task-detail'] = () => {
      throw new Error('gone')
    }
    const { rerender } = renderPanel()
    expect(await screen.findByText('Error: gone')).toBeTruthy()
    bridge.responses['task-vault:vault:get-task-detail'] = { description: 'other' }
    rerender(<TaskDetailPanel taskId="t2" taskText="Other" onClose={vi.fn()} />)
    expect(await screen.findByText('other')).toBeTruthy()
  })
}

function editingTests() {
  describe('saving', editingSavingTests)
  describe('toggling and links', editingTogglingAndLinksTests)
}

function editingSavingTests() {
  it('edits a section and saves every field together', async () => {
    renderPanel()
    await screen.findByText('it')
    fireEvent.click(editButtons()[1])
    fireEvent.change(textarea(), { target: { value: '- [x] done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:save-task-detail')).toEqual([
        {
          taskId: 't1',
          description: 'Ship **it**',
          acceptanceCriteria: '- [x] done',
          devHints: 'see [docs](https://example.com)',
        },
      ])
    )
    expect(screen.queryByRole('textbox')).toBeNull()
  })
}

function editingTogglingAndLinksTests() {
  it('saves from the preview toggle, and starts editing by clicking the text', async () => {
    renderPanel()
    fireEvent.click(await screen.findByText('it'))
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:save-task-detail')).toHaveLength(1)
    )
  })

  it('opens a link in the text instead of editing', async () => {
    renderPanel()
    fireEvent.click(await screen.findByText('docs'))
    expect(screen.queryByRole('textbox')).toBeNull()
  })
}

function keysTests() {
  it('saves with Cmd+Enter and cancels with Escape', async () => {
    renderPanel()
    await screen.findByText('it')
    fireEvent.click(editButtons()[0])
    fireEvent.change(textarea(), { target: { value: 'changed' } })
    fireEvent.keyDown(textarea(), { key: 'Escape' })
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(editButtons()[0])
    expect(textarea().value).toBe('Ship **it**')
    fireEvent.keyDown(textarea(), { key: 'Enter', metaKey: true })
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:save-task-detail')).toHaveLength(1)
    )
  })

  it('discards a draft with Cancel', async () => {
    renderPanel()
    await screen.findByText('it')
    fireEvent.click(editButtons()[2])
    fireEvent.change(textarea(), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('docs')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:save-task-detail')).toEqual([])
  })
}
