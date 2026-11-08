import React from 'react'
import { setImmediate as nextEventLoopTurn } from 'node:timers/promises'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, cleanup, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { installVaultBridge, eventually, task } from './helpers/bridge'
import { buttonNamed, renderDailyLog } from './helpers/daily-log'
import type { IndexedTask } from '../../src/vault/types'

vi.mock('../../src/utils/notify', () => ({ notify: vi.fn() }))
vi.mock('../../src/components/SmartTaskInput', () => import('./helpers/input-stubs'))

import { DailyLog } from '../../src/components/DailyLog'
import { notify } from '../../src/utils/notify'
import { useVaultNavStore } from '../../src/stores/vault-nav.store'

let bridge: ReturnType<typeof installVaultBridge>

function withSubtasks(status: IndexedTask['status'] = 'open') {
  return task('p', 'Parent', {
    status,
    subtasks: [task('s1', 'Step one'), task('s2', 'Step two', { status: 'done' })],
  })
}

const subtask = (text: string) => screen.getByRole('group', { name: text })

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
describe('DailyLog subtask editing, continued', subtaskEditTestsPart2)
describe('DailyLog adding subtasks', ghostTests)
describe('DailyLog adding subtasks, continued', ghostTestsPart2)
describe('DailyLog terminal links', linkTests)
describe('DailyLog terminal links, continued', linkTestsPart2)
describe('DailyLog terminal links with no session open', noSessionTests)
describe('DailyLog terminal links the app cannot list', unlistableTests)
describe('DailyLog terminal links the app cannot list, continued', unlistableTestsPart2)
describe('DailyLog jumping to a linked terminal', jumpTests)
describe('DailyLog jumping to a linked terminal, continued', jumpTestsPart2)

function subtaskTests() {
  it('completes an open subtask with a notice that leads back to it', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(withSubtasks())
    await user.click(within(subtask('Step one')).getByTitle('Complete subtask'))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:complete-task')).toEqual([{ taskId: 's1' }])
    const [type, message, options] = vi.mocked(notify).mock.calls.at(-1)!
    expect([type, message]).toEqual(['success', 'Completed: Step one'])
    ;(options as { onClick: () => void }).onClick()
    expect(useVaultNavStore.getState().pendingTaskId).toBe('s1')
  })

  it('shows a finished subtask struck through, with Delete but no Edit', () => {
    renderDailyLog(withSubtasks())
    const done = subtask('Step two')
    expect(done.className).toContain('daily-log__subtask--done')
    expect(screen.getByText('Step two').className).toContain('daily-log__task-text--strikethrough')
    expect(within(done).getByRole('button', { name: 'Delete' })).toBeTruthy()
    expect(within(done).queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('opens no editor when a finished subtask is double-clicked', async () => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks())
    await user.dblClick(screen.getByText('Step two'))
    expect(screen.queryByLabelText('Task text')).toBeNull()
  })
}

function subtaskTestsPart2() {
  it('keeps a subtask when the delete is not confirmed', async () => {
    const user = userEvent.setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderDailyLog(withSubtasks())
    await user.click(within(subtask('Step two')).getByRole('button', { name: 'Delete' }))
    expect(confirm).toHaveBeenCalledWith('Delete subtask: "Step two"?')
    expect(bridge.calls('task-vault:vault:delete-task')).toEqual([])
  })

  it('deletes a subtask once confirmed', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { props } = renderDailyLog(withSubtasks())
    await user.click(within(subtask('Step one')).getByRole('button', { name: 'Delete' }))
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:delete-task')).toEqual([{ taskId: 's1' }])
  })
}

function subtaskEditTests() {
  it('opens the editor, holding the subtask text, from the Edit button', async () => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks())
    await user.click(within(subtask('Step one')).getByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Task text')).toHaveProperty('value', 'Step one')
  })

  it('opens the editor on a double click of an open subtask', async () => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks())
    await user.dblClick(screen.getByText('Step one'))
    expect(screen.getByLabelText('Task text')).toHaveProperty('value', 'Step one')
  })

  it('closes the editor on Cancel edit', async () => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks())
    await user.dblClick(screen.getByText('Step one'))
    await user.click(buttonNamed('Cancel edit'))
    expect(screen.queryByLabelText('Task text')).toBeNull()
  })

  it('cancels an edit with Escape', async () => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks())
    await user.dblClick(screen.getByText('Step one'))
    await user.type(screen.getByLabelText('Task text'), '{Escape}')
    expect(screen.queryByLabelText('Task text')).toBeNull()
  })
}

function subtaskEditTestsPart2() {
  it('saves nothing for blank text and keeps the editor open', async () => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks())
    await user.dblClick(screen.getByText('Step one'))
    await user.clear(screen.getByLabelText('Task text'))
    await user.type(screen.getByLabelText('Task text'), ' ')
    await user.click(buttonNamed('Save'))
    expect(screen.getByLabelText('Task text')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([])
  })

  it('saves the trimmed text on Enter', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(withSubtasks())
    await user.dblClick(screen.getByText('Step one'))
    await user.clear(screen.getByLabelText('Task text'))
    await user.type(screen.getByLabelText('Task text'), ' Step 1 {Enter}')
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:vault:edit-task')).toEqual([{ taskId: 's1', text: 'Step 1' }])
  })
}

function ghostTests() {
  it('adds another subtask from the ghost row', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(withSubtasks())
    await user.click(buttonNamed('· + Add subtask…'))
    expect(buttonNamed('Add')).toHaveProperty('disabled', true)
    await user.type(screen.getByLabelText('Subtask…'), ' three ')
    await user.click(buttonNamed('Add'))
    await screen.findByRole('button', { name: '· + Add subtask…' })
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([{ taskId: 'p', text: 'three' }])
    expect(props.onRefresh).toHaveBeenCalled()
  })

  it('adds nothing when Enter is pressed on a blank ghost row', async () => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks('blocked'))
    await user.click(buttonNamed('· + Add subtask…'))
    await user.type(screen.getByLabelText('Subtask…'), '{Enter}')
    expect(screen.getByLabelText('Subtask…')).toBeTruthy()
    expect(bridge.calls('task-vault:vault:add-subtask')).toEqual([])
  })
}

function ghostTestsPart2() {
  it.each([
    ['the Cancel button', (user: UserEvent) => user.click(buttonNamed('Cancel'))],
    ['Escape', (user: UserEvent) => user.type(screen.getByLabelText('Subtask…'), '{Escape}')],
  ])('closes the ghost row on %s', async (_how, close) => {
    const user = userEvent.setup()
    renderDailyLog(withSubtasks('blocked'))
    await user.click(buttonNamed('· + Add subtask…'))
    await close(user)
    expect(screen.queryByLabelText('Subtask…')).toBeNull()
    expect(screen.getByRole('button', { name: '· + Add subtask…' })).toBeTruthy()
  })

  it.each(['in-progress', 'done'] as const)('offers no ghost row under a %s task', (status) => {
    renderDailyLog(withSubtasks(status))
    expect(screen.queryByText('· + Add subtask…')).toBeNull()
  })
}

function linkTests() {
  it('links a session chosen by workspace, project and tab', async () => {
    const user = userEvent.setup()
    const { props } = renderDailyLog(task('t1', 'Write'))
    await user.click(buttonNamed('Link to terminal session'))
    expect(await screen.findByRole('option', { name: 'Work › App › zsh' })).toHaveProperty(
      'value',
      'sess-aaaaaaaa1'
    )
    expect(screen.getByRole('option', { name: 'sess-bbb' })).toHaveProperty(
      'value',
      'sess-bbbbbbbb2'
    )
    await user.selectOptions(screen.getByRole('combobox'), 'sess-aaaaaaaa1')
    await eventually(() => expect(props.onRefresh).toHaveBeenCalled())
    expect(bridge.calls('task-vault:links:create')).toEqual([
      { taskId: 't1', targetId: 'sess-aaaaaaaa1' },
    ])
    expect(bridge.recordUsage).toHaveBeenCalledWith('session-link')
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Jump to linked terminal' })).toBeTruthy()
  })
}

function linkTestsPart2() {
  it('reports a link the vault refused', async () => {
    const user = userEvent.setup()
    bridge.responses['task-vault:links:create'] = { error: 'nope' }
    renderDailyLog(task('t1', 'Write'))
    await user.click(buttonNamed('Link to terminal session'))
    await screen.findByRole('option', { name: 'Work › App › zsh' })
    await user.selectOptions(screen.getByRole('combobox'), 'sess-aaaaaaaa1')
    await eventually(() =>
      expect(vi.mocked(notify)).toHaveBeenCalledWith(
        'error',
        'Could not save terminal link: nope',
        'terminalLinkSaveFailed'
      )
    )
    expect(bridge.recordUsage).toHaveBeenCalledWith('session-link', { failed: true })
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.getByRole('button', { name: 'Link to terminal session' })).toBeTruthy()
  })
}

function noSessionTests() {
  it('says when no session is open', async () => {
    const user = userEvent.setup()
    installTerminal([])
    renderDailyLog(task('t1', 'Write'))
    await user.click(buttonNamed('Link to terminal session'))
    expect(await screen.findByText('No active terminal sessions.')).toHaveProperty(
      'textContent',
      'No active terminal sessions.'
    )
  })

  it('closes the no-session notice on Close', async () => {
    const user = userEvent.setup()
    installTerminal([])
    renderDailyLog(task('t1', 'Write'))
    await user.click(buttonNamed('Link to terminal session'))
    await user.click(await screen.findByRole('button', { name: 'Close' }))
    expect(screen.queryByText('No active terminal sessions.')).toBeNull()
  })
}

function jumpTests() {
  it('jumps to the linked session when it is still open', async () => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write', { terminatorLinks: ['sess-aaaaaaaa1'] }))
    await user.click(buttonNamed('Jump to linked terminal'))
    await eventually(() =>
      expect(bridge.calls('task-vault:navigate-to-terminal')).toEqual([
        { sessionId: 'sess-aaaaaaaa1', projectId: 'pr1' },
      ])
    )
  })

  it('offers to relink when the linked session is gone', async () => {
    const user = userEvent.setup()
    renderDailyLog(task('t1', 'Write', { terminatorLinks: ['gone'] }))
    await user.click(buttonNamed('Jump to linked terminal'))
    expect(await screen.findByRole('combobox')).toHaveProperty('value', '')
    expect(bridge.calls('task-vault:navigate-to-terminal')).toEqual([])
  })
}

function jumpTestsPart2() {
  it('offers to relink when the session lookup fails', async () => {
    const user = userEvent.setup()
    installTerminal().mockRejectedValueOnce(new Error('down'))
    renderDailyLog(task('t1', 'Write', { terminatorLinks: ['gone'] }))
    await user.click(buttonNamed('Jump to linked terminal'))
    expect(await screen.findByRole('combobox')).toBeTruthy()
    expect(bridge.calls('task-vault:navigate-to-terminal')).toEqual([])
  })

  it('follows the links the task arrives with', async () => {
    const user = userEvent.setup()
    const { view, props } = renderDailyLog(task('t1', 'Write'))
    const linked = task('t1', 'Write', { terminatorLinks: ['sess-aaaaaaaa1'] })
    view.rerender(
      React.createElement(DailyLog, { ...props, log: { ...props.log, tasks: [linked] } })
    )
    await user.click(buttonNamed('Jump to linked terminal'))
    await eventually(() => expect(bridge.calls('task-vault:navigate-to-terminal')).toHaveLength(1))
  })
}

/** Collects the promise rejections nothing handled while `run` and the event-loop turn after it ran. */
async function unhandledRejectionsDuring(run: () => Promise<void>): Promise<unknown[]> {
  const reasons: unknown[] = []
  const recordReason = (reason: unknown) => void reasons.push(reason)
  process.on('unhandledRejection', recordReason)
  try {
    await run()
    // Node reports an unhandled rejection once the microtask queue has drained, on the next turn.
    await nextEventLoopTurn()
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
      await userEvent.setup().click(buttonNamed('Link to terminal session'))
    })
    expect(reasons).toEqual([])
    expect(await screen.findByText('No active terminal sessions.')).toHaveProperty(
      'textContent',
      'No active terminal sessions.'
    )
  })
}

function unlistableTestsPart2() {
  it('still lists the sessions, by tab, when the workspaces cannot be read', async () => {
    bridge = installVaultBridge({
      terminal: { listSessions: vi.fn(async () => SESSIONS) },
      workspace: { list: vi.fn(async () => Promise.reject(new Error('host gone'))) },
      project: { list: vi.fn(async () => ({ projects: [] })) },
    })
    const reasons = await unhandledRejectionsDuring(async () => {
      renderDailyLog(task('t1', 'Write'))
      await userEvent.setup().click(buttonNamed('Link to terminal session'))
    })
    expect(reasons).toEqual([])
    expect(await screen.findByRole('option', { name: 'zsh' })).toHaveProperty(
      'value',
      'sess-aaaaaaaa1'
    )
  })
}
