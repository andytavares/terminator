import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, fireEvent, within } from '@testing-library/react'
import { installVaultBridge, eventually, task } from './helpers/bridge'
import { buttonNamed, renderDailyLog } from './helpers/daily-log'
import type { IndexedTask } from '../../src/vault/types'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/SmartTaskInput', () => import('./helpers/input-stubs'))

import { DailyLog } from '../../src/components/DailyLog'
import { notify } from '../../src/utils/notify'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

vi.setConfig({ testTimeout: 30_000 })

let bridge: ReturnType<typeof installVaultBridge>

function withSubtasks(status: IndexedTask['status'] = 'open') {
  return task('p', 'Parent', {
    status,
    subtasks: [task('s1', 'Step one'), task('s2', 'Step two', { status: 'done' })],
  })
}

const subtask = (text: string) =>
  screen.getByText(text).closest('.daily-log__subtask') as HTMLElement

const SESSIONS = [
  { sessionId: 'sess-aaaaaaaa1', projectId: 'pr1', tabTitle: 'zsh' },
  { sessionId: 'sess-bbbbbbbb2', projectId: 'nowhere', tabTitle: '' },
]

function installTerminal(sessions: unknown[] = SESSIONS) {
  const listSessions = vi.fn(async () => sessions)
  bridge = installVaultBridge({
    terminal: { listSessions },
    workspace: { list: vi.fn(async () => ({ workspaces: [{ id: 'w1', name: 'Work' }] })) },
    project: { list: vi.fn(async () => ({ projects: [{ id: 'pr1', name: 'App' }] })) },
  })
  return listSessions
}

beforeEach(() => {
  vi.mocked(notify).mockClear()
  installTerminal()
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('DailyLog subtasks', subtaskTests)
describe('DailyLog subtasks, continued', subtaskTestsPart2)
describe('DailyLog subtask editing', subtaskEditTests)
describe('DailyLog adding subtasks', ghostTests)
describe('DailyLog adding subtasks, continued', ghostTestsPart2)
describe('DailyLog terminal links', linkTests)
describe('DailyLog terminal links, continued', linkTestsPart2)
describe('DailyLog terminal links the app cannot list', unlistableTests)
describe('DailyLog jumping to a linked terminal', jumpTests)
describe('DailyLog jumping to a linked terminal, continued', jumpTestsPart2)

function subtaskTests() {
  it('completes an open subtask with a notice that leads back to it', async () => {
    const { props } = renderDailyLog(withSubtasks())
    expect(screen.queryByRole('button', { name: 'Add subtask' })).toBeNull()
    fireEvent.click(within(subtask('Step one')).getByTitle('Complete subtask'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 's1' }])
    const [type, message, options] = vi.mocked(notify).mock.calls.at(-1)!
    expect([type, message]).toEqual(['success', 'Completed: Step one'])
    ;(options as { onClick: () => void }).onClick()
    expect(useVaultNavStore.getState().pendingTaskId).toBe('s1')
  })

  it('shows a finished subtask struck through, with only Delete', () => {
    renderDailyLog(withSubtasks())
    const done = subtask('Step two')
    expect(done.className).toContain('daily-log__subtask--done')
    expect(done.querySelector('.daily-log__task-text--strikethrough')).toBeTruthy()
    expect(within(done).queryByRole('button', { name: 'Edit' })).toBeNull()
    fireEvent.doubleClick(screen.getByText('Step two'))
    expect(screen.queryByLabelText('Task text')).toBeNull()
  })
}

function subtaskTestsPart2() {
  it('deletes a subtask only once confirmed', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { props } = renderDailyLog(withSubtasks())
    fireEvent.click(within(subtask('Step two')).getByRole('button', { name: 'Delete' }))
    expect(confirm).toHaveBeenCalledWith('Delete subtask: "Step two"?')
    fireEvent.click(within(subtask('Step one')).getByRole('button', { name: 'Delete' }))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 's1' }])
  })
}

function subtaskEditTests() {
  it('edits an open subtask by its button or a double click', async () => {
    const { props } = renderDailyLog(withSubtasks())
    fireEvent.click(within(subtask('Step one')).getByRole('button', { name: 'Edit' }))
    fireEvent.click(buttonNamed('Cancel edit'))
    fireEvent.doubleClick(screen.getByText('Step one'))
    const input = screen.getByLabelText('Task text') as HTMLInputElement
    expect(input.value).toBe('Step one')
    fireEvent.change(input, { target: { value: ' ' } })
    fireEvent.click(buttonNamed('Save'))
    fireEvent.change(input, { target: { value: ' Step 1 ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([{ taskId: 's1', text: 'Step 1' }])
  })

  it('cancels an edit with Escape', () => {
    renderDailyLog(withSubtasks())
    fireEvent.doubleClick(screen.getByText('Step one'))
    fireEvent.keyDown(screen.getByLabelText('Task text'), { key: 'Escape' })
    expect(screen.queryByLabelText('Task text')).toBeNull()
  })
}

function ghostTests() {
  it('adds another subtask from the ghost row', async () => {
    const { props } = renderDailyLog(withSubtasks())
    fireEvent.click(screen.getByText('· + Add subtask…'))
    expect(buttonNamed('Add')).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText('Subtask…'), { target: { value: ' three ' } })
    fireEvent.click(buttonNamed('Add'))
    await eventually(() => expect(screen.getByText('· + Add subtask…')).toBeTruthy())
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([{ taskId: 'p', text: 'three' }])
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('cancels the ghost row by button or Escape, ignoring a blank submit', () => {
    renderDailyLog(withSubtasks('blocked'))
    fireEvent.click(screen.getByText('· + Add subtask…'))
    fireEvent.keyDown(screen.getByLabelText('Subtask…'), { key: 'Enter' })
    fireEvent.click(buttonNamed('Cancel'))
    fireEvent.click(screen.getByText('· + Add subtask…'))
    fireEvent.keyDown(screen.getByLabelText('Subtask…'), { key: 'Escape' })
    expect(screen.queryByLabelText('Subtask…')).toBeNull()
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([])
  })
}

function ghostTestsPart2() {
  it('offers no ghost row under an in-progress or finished task', () => {
    renderDailyLog(withSubtasks('in-progress'))
    expect(screen.queryByText('· + Add subtask…')).toBeNull()
    cleanup()
    renderDailyLog(withSubtasks('done'))
    expect(screen.queryByText('· + Add subtask…')).toBeNull()
  })
}

function linkTests() {
  it('links a session chosen by workspace, project and tab', async () => {
    const { props } = renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Link to terminal session'))
    expect(await screen.findByRole('option', { name: 'Work › App › zsh' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'sess-bbb' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sess-aaaaaaaa1' } })
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:links:create')).toEqual([
      { taskId: 't1', targetId: 'sess-aaaaaaaa1' },
    ])
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(buttonNamed('Jump to linked terminal')).toBeTruthy()
  })
}

function linkTestsPart2() {
  it('reports a link the vault refused', async () => {
    bridge.responses['task-vault:links:create'] = { error: 'nope' }
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Link to terminal session'))
    await screen.findByRole('option', { name: 'Work › App › zsh' })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sess-aaaaaaaa1' } })
    await eventually(() =>
      expect(vi.mocked(notify)).toHaveBeenCalledWith(
        'error',
        'Could not save terminal link: nope',
        'terminalLinkSaveFailed'
      )
    )
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(buttonNamed('Link to terminal session')).toBeTruthy()
  })

  it('says when no session is open, and closes', () => {
    installTerminal([])
    renderDailyLog(task('t1', 'Write'))
    fireEvent.click(buttonNamed('Link to terminal session'))
    expect(screen.getByText('No active terminal sessions.')).toBeTruthy()
    fireEvent.click(buttonNamed('Close'))
    expect(screen.queryByText('No active terminal sessions.')).toBeNull()
  })
}

function jumpTests() {
  it('jumps to the linked session when it is still open', async () => {
    renderDailyLog(task('t1', 'Write', { terminatorLinks: ['sess-aaaaaaaa1'] }))
    fireEvent.click(buttonNamed('Jump to linked terminal'))
    await eventually(() =>
      expect(bridge.calls('task-vault:navigate-to-terminal')).toEqual([
        { sessionId: 'sess-aaaaaaaa1', projectId: 'pr1' },
      ])
    )
  })

  it('offers to relink when the session is gone or the lookup fails', async () => {
    renderDailyLog(task('t1', 'Write', { terminatorLinks: ['gone'] }))
    fireEvent.click(buttonNamed('Jump to linked terminal'))
    expect(await screen.findByRole('combobox')).toBeTruthy()
    cleanup()
    installTerminal().mockRejectedValueOnce(new Error('down'))
    renderDailyLog(task('t1', 'Write', { terminatorLinks: ['gone'] }))
    fireEvent.click(buttonNamed('Jump to linked terminal'))
    await eventually(() => expect(document.querySelector('.daily-log__link-picker')).toBeTruthy())
    expect(bridge.calls('task-vault:navigate-to-terminal')).toEqual([])
  })
}

function jumpTestsPart2() {
  it('follows the links the task arrives with', async () => {
    const { view, props } = renderDailyLog(task('t1', 'Write'))
    const linked = task('t1', 'Write', { terminatorLinks: ['sess-aaaaaaaa1'] })
    view.rerender(
      React.createElement(DailyLog, { ...props, log: { ...props.log, tasks: [linked] } })
    )
    fireEvent.click(buttonNamed('Jump to linked terminal'))
    await eventually(() => expect(bridge.calls('task-vault:navigate-to-terminal')).toHaveLength(1))
  })
}

/** Collects the promise rejections nothing handled while `run` and a macrotask after it ran. */
async function unhandledRejectionsDuring(run: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = []
  const recordReason = (reason: unknown) => void reasons.push(reason)
  process.on('unhandledRejection', recordReason)
  try {
    await run()
    await new Promise((resolve) => setTimeout(resolve, 0))
  } finally {
    process.off('unhandledRejection', recordReason)
  }
  return reasons
}

function unlistableTests() {
  it('says no session is open when the session list fails, leaving no rejection unhandled', async () => {
    bridge = installVaultBridge({
      terminal: { listSessions: vi.fn(async () => Promise.reject(new Error('host gone'))) },
      workspace: { list: vi.fn(async () => Promise.reject(new Error('host gone'))) },
      project: { list: vi.fn(async () => ({ projects: [] })) },
    })
    const reasons = await unhandledRejectionsDuring(async () => {
      renderDailyLog(task('t1', 'Write'))
      fireEvent.click(buttonNamed('Link to terminal session'))
    })
    expect(reasons).toEqual([])
    expect(screen.getByText('No active terminal sessions.')).toBeTruthy()
  })

  it('still lists the sessions, by tab, when the workspaces cannot be read', async () => {
    bridge = installVaultBridge({
      terminal: { listSessions: vi.fn(async () => SESSIONS) },
      workspace: { list: vi.fn(async () => Promise.reject(new Error('host gone'))) },
      project: { list: vi.fn(async () => ({ projects: [] })) },
    })
    const reasons = await unhandledRejectionsDuring(async () => {
      renderDailyLog(task('t1', 'Write'))
      fireEvent.click(buttonNamed('Link to terminal session'))
    })
    expect(reasons).toEqual([])
    expect(await screen.findByRole('option', { name: 'zsh' })).toBeTruthy()
  })
}
