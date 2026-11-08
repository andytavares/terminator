import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { installVaultBridge, eventually } from './helpers/bridge'
import { DatabaseAdmin } from '../../src/components/DatabaseAdmin'
import { pressOutside } from '../../../../tests/support/modal'

let bridge: ReturnType<typeof installVaultBridge>

beforeEach(() => {
  bridge = installVaultBridge()
  bridge.responses['task-vault:admin:table-stats'] = { stats: { tasks: 3, areas: 1 } }
  bridge.responses['task-vault:admin:run-query'] = (payload: unknown) => {
    const { sql } = payload as { sql: string }
    if (sql.startsWith('SELECT'))
      return {
        rows: [
          { id: 't1', text: 'a' },
          { id: 2, text: null },
        ],
        changes: 0,
      }
    if (sql === 'bad') return { error: 'syntax error' }
    if (sql === 'throw') throw new Error('down')
    return { rows: undefined, changes: 1 }
  }
})

afterEach(() => cleanup())

const queriesRun = () =>
  bridge.calls('task-vault:admin:run-query').map((c) => (c as { sql: string }).sql)

function renderAdmin() {
  const onWrite = vi.fn()
  render(<DatabaseAdmin onWrite={onWrite} />)
  return onWrite
}

/** Waits for the result line to read `pattern`. */
function shows(pattern: RegExp) {
  return eventually(() =>
    expect(document.querySelector('.db-admin__result-meta')?.textContent).toMatch(pattern)
  )
}

/** The Run button of the confirmation dialog. */
function confirmRun(): HTMLElement {
  return within(document.querySelector('.db-admin__confirm') as HTMLElement).getByRole('button', {
    name: 'Run',
  })
}

const sqlBox = () => screen.getByPlaceholderText('SELECT * FROM tasks LIMIT 50')

async function typeSql(user: UserEvent, sql: string) {
  await user.clear(sqlBox())
  await user.type(sqlBox(), sql)
}

describe('DatabaseAdmin usage', () => {
  it('counts one view of the admin as it opens', async () => {
    renderAdmin()
    await screen.findByTitle('Browse tasks')
    expect(bridge.recordUsage.mock.calls).toEqual([['db-admin']])
  })
})

describe('DatabaseAdmin tables', tablesTests)
describe('DatabaseAdmin tables, continued', tablesTestsPart2)
describe('DatabaseAdmin queries', queryTests)
describe('DatabaseAdmin confirmations', confirmTests)
describe('DatabaseAdmin row deletes', rowDeleteTests)
describe('DatabaseAdmin reloading the vault', reloadTests)

function tablesTests() {
  it('shows Loading… until the table counts arrive', async () => {
    renderAdmin()
    expect(screen.getByText('Loading…')).toBeTruthy()
    await screen.findByTitle('Browse tasks')
    expect(screen.queryByText('Loading…')).toBeNull()
  })

  it('browses a table, with a delete button on each row', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByTitle('Browse tasks'))
    await shows(/^2 rows/)
    expect(queriesRun()).toEqual(['SELECT * FROM tasks LIMIT 100'])
    expect(screen.getAllByRole('button', { name: 'Delete this row' })).toHaveLength(2)
  })
}

function tablesTestsPart2() {
  it('reads the table counts again on Refresh tables', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await screen.findByTitle('Browse tasks')
    const readsBefore = bridge.calls('task-vault:admin:table-stats').length
    await user.click(screen.getByRole('button', { name: 'Refresh tables' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:admin:table-stats')).toHaveLength(readsBefore + 1)
    )
  })

  it('confirms before clearing a table', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByRole('button', { name: 'Clear all rows from areas' }))
    expect(screen.getByText('Clear all rows from "areas"?').textContent).toBe(
      'Clear all rows from "areas"?'
    )
    await user.click(confirmRun())
    await eventually(() => expect(queriesRun()).toEqual(['DELETE FROM areas']))
  })
}

function queryTests() {
  describe('writing and errors', queryWritingAndErrorsTests)
  describe('quick actions', queryQuickActionsTests)
}

function queryWritingAndErrorsTests() {
  it('runs typed SQL with Cmd+Enter and reports writes', async () => {
    const user = userEvent.setup()
    const onWrite = renderAdmin()
    await typeSql(user, 'UPDATE tasks SET text = 1')
    expect(sqlBox().matches(':focus')).toBe(true)
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await shows(/^1 row affected/)
    expect(onWrite).toHaveBeenCalled()
  })

  it.each([
    ['answered with', 'bad', 'syntax error'],
    ['threw', 'throw', 'Error: down'],
  ])('shows an error the query %s', async (_how, sql, error) => {
    const user = userEvent.setup()
    renderAdmin()
    await typeSql(user, sql)
    await user.click(screen.getByTitle('Run (⌘↵)'))
    expect((await screen.findByText(error)).textContent).toBe(error)
  })
}

function queryQuickActionsTests() {
  it('runs a safe quick action at once, without row deletes when there is no table', async () => {
    const user = userEvent.setup()
    bridge.responses['task-vault:admin:run-query'] = { rows: [{ status: 'open', count: 2 }] }
    renderAdmin()
    await user.click(screen.getByRole('button', { name: 'Count tasks by status' }))
    await shows(/^1 row /)
    expect(screen.queryByRole('button', { name: 'Delete this row' })).toBeNull()
    expect(screen.getByText('open')).toBeTruthy()
  })
}

function confirmTests() {
  it('asks before a destructive quick action', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole('button', { name: 'Delete all cancelled tasks' }))
    expect(screen.getByRole('dialog', { name: 'Run destructive query?' })).toBeTruthy()
    expect(queriesRun()).toEqual([])
  })

  it('closes the destructive query dialog on Cancel, running nothing', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole('button', { name: 'Delete all cancelled tasks' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Run destructive query?')).toBeNull()
    expect(queriesRun()).toEqual([])
  })

  it('closes the destructive query dialog on a press outside, running nothing', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(screen.getByRole('button', { name: 'Delete all cancelled tasks' }))
    pressOutside(screen.getByRole('dialog', { name: 'Run destructive query?' }))
    expect(screen.queryByText('Run destructive query?')).toBeNull()
    expect(queriesRun()).toEqual([])
  })
}

function rowDeleteTests() {
  it('deletes a row with a string id by its quoted id', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByTitle('Browse tasks'))
    await shows(/^2 rows/)
    await user.click(screen.getAllByRole('button', { name: 'Delete this row' })[0])
    await user.click(screen.getByRole('dialog'))
    await user.click(confirmRun())
    await eventually(() => expect(queriesRun()).toContain("DELETE FROM tasks WHERE id = 't1'"))
  })

  it('asks to delete a row with a number id by its unquoted id', async () => {
    const user = userEvent.setup()
    renderAdmin()
    await user.click(await screen.findByTitle('Browse tasks'))
    await shows(/^2 rows/)
    await user.click(screen.getAllByRole('button', { name: 'Delete this row' })[1])
    expect(screen.getByText('DELETE FROM tasks WHERE id = 2')).toBeTruthy()
  })
}

/** Answers the way task-vault:admin:run-query does: rows for a read, rows: [] and a count for a write. */
function answerQueries(result: { rows: unknown[]; changes: number }): void {
  bridge.responses['task-vault:admin:run-query'] = result
}

function reloadTests() {
  it('tells the vault to reload after a query that changed rows', async () => {
    const user = userEvent.setup()
    answerQueries({ rows: [], changes: 1 })
    const onWrite = renderAdmin()
    await typeSql(user, "UPDATE tasks SET text = 'x'")
    await user.click(screen.getByTitle('Run (⌘↵)'))
    await shows(/^1 row affected/)
    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  it('does not reload after a read', async () => {
    const user = userEvent.setup()
    answerQueries({ rows: [{ text: 'Water the plants' }], changes: 0 })
    const onWrite = renderAdmin()
    await typeSql(user, 'SELECT text FROM tasks')
    await user.click(screen.getByTitle('Run (⌘↵)'))
    expect((await screen.findByText('Water the plants')).tagName).toBe('TD')
    expect(onWrite).not.toHaveBeenCalled()
  })
}
