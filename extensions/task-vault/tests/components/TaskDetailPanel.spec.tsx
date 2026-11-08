import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installVaultBridge, eventually } from './helpers/bridge'

import { TaskDetailPanel } from '../../src/components/TaskDetailPanel'

const openExternal = vi.fn(async () => ({ ok: true as const }))

let bridge: ReturnType<typeof installVaultBridge>

beforeEach(() => {
  bridge = installVaultBridge({ shell: { openExternal } })
  bridge.responses['task-vault:vault:get-task-detail'] = {
    description: 'Ship **it**',
    acceptanceCriteria: '',
    devHints: 'see [docs](https://example.com)',
  }
})

afterEach(() => cleanup())

function renderDetailPanel(taskId = 't1') {
  const onClose = vi.fn()
  const utils = render(<TaskDetailPanel taskId={taskId} taskText="Launch" onClose={onClose} />)
  return { onClose, ...utils }
}

const editButtons = () => screen.getAllByRole('button', { name: 'Edit' })
const textarea = () => screen.getByRole('textbox') as HTMLTextAreaElement

describe('TaskDetailPanel loading', detailLoadingTests)
describe('TaskDetailPanel load errors', detailLoadErrorTests)
describe('TaskDetailPanel editing', editingTests)
describe('TaskDetailPanel keys', detailKeysTests)
describe('TaskDetailPanel cancelling', detailCancelTests)

function detailLoadingTests() {
  it('shows each section, rendering markdown or the first line of the hint', async () => {
    renderDetailPanel()
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect((await screen.findByText('it')).tagName).toBe('STRONG')
    expect(screen.getByText('- [ ] Criterion one')).toBeTruthy()
    expect(screen.getByText('Acceptance criteria')).toBeTruthy()
  })
}

function detailLoadErrorTests() {
  it('shows the load error', async () => {
    bridge.responses['task-vault:vault:get-task-detail'] = { error: 'Task not found' }
    renderDetailPanel()
    expect(await screen.findByText('Task not found')).toBeTruthy()
  })

  it('closes from the header of the error view', async () => {
    const user = userEvent.setup()
    bridge.responses['task-vault:vault:get-task-detail'] = { error: 'Task not found' }
    const { onClose } = renderDetailPanel()
    await user.click(await screen.findByRole('button', { name: 'Close detail panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows a thrown failure, and reloads for another task', async () => {
    bridge.responses['task-vault:vault:get-task-detail'] = () => {
      throw new Error('gone')
    }
    const { rerender } = renderDetailPanel()
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
    const user = userEvent.setup()
    renderDetailPanel()
    await screen.findByText('it')
    await user.click(editButtons()[1])
    await user.clear(textarea())
    await user.type(textarea(), '- [[x] done')
    await user.click(screen.getByRole('button', { name: 'Save' }))
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
  it('starts editing the section when its text is clicked', async () => {
    const user = userEvent.setup()
    renderDetailPanel()
    await user.click(await screen.findByText('it'))
    expect(textarea().value).toBe('Ship **it**')
  })

  it('saves when the Preview toggle is pressed', async () => {
    const user = userEvent.setup()
    renderDetailPanel()
    await user.click(await screen.findByText('it'))
    await user.click(await screen.findByRole('button', { name: 'Preview' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:save-task-detail')).toHaveLength(1)
    )
  })

  it('opens a link in the text instead of editing', async () => {
    const user = userEvent.setup()
    renderDetailPanel()
    await user.click(await screen.findByText('docs'))
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    expect(screen.queryByRole('textbox')).toBeNull()
  })
}

function detailKeysTests() {
  it('closes the editor without keeping the draft on Escape', async () => {
    const user = userEvent.setup()
    renderDetailPanel()
    await screen.findByText('it')
    await user.click(editButtons()[0])
    await user.clear(textarea())
    await user.type(textarea(), 'changed')
    expect(textarea().matches(':focus')).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('textbox')).toBeNull()
    await user.click(editButtons()[0])
    expect(textarea().value).toBe('Ship **it**')
  })

  it('saves with Cmd+Enter', async () => {
    const user = userEvent.setup()
    renderDetailPanel()
    await screen.findByText('it')
    await user.click(editButtons()[0])
    await user.click(textarea())
    expect(textarea().matches(':focus')).toBe(true)
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await eventually(() =>
      expect(bridge.calls('task-vault:vault:save-task-detail')).toHaveLength(1)
    )
  })
}

function detailCancelTests() {
  it('discards a draft with Cancel', async () => {
    const user = userEvent.setup()
    renderDetailPanel()
    await screen.findByText('it')
    await user.click(editButtons()[2])
    await user.clear(textarea())
    await user.type(textarea(), 'nope')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('docs')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:save-task-detail')).toEqual([])
  })
}
