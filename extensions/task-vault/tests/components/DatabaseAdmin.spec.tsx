import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { installVaultBridge, eventually } from './helpers/bridge'
import { DatabaseAdmin } from '../../src/components/DatabaseAdmin'
import { pressOutside } from '../../../../tests/support/modal'

vi.setConfig({ testTimeout: 30_000 })

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

function typeSql(sql: string) {
  fireEvent.change(screen.getByPlaceholderText('SELECT * FROM tasks LIMIT 50'), {
    target: { value: sql },
  })
}

describe('DatabaseAdmin tables', tablesTests)
describe('DatabaseAdmin queries', queryTests)
describe('DatabaseAdmin confirmations', confirmTests)
describe('DatabaseAdmin reloading the vault', reloadTests)

function tablesTests() {
  it('shows table counts, browses a table, and refreshes', async () => {
    renderAdmin()
    expect(screen.getByText('Loading…')).toBeTruthy()
    fireEvent.click(await screen.findByTitle('Browse tasks'))
    await shows(/^2 rows/)
    expect(queriesRun()).toEqual(['SELECT * FROM tasks LIMIT 100'])
    expect(screen.getAllByRole('button', { name: 'Delete this row' })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh tables' }))
    await eventually(() =>
      expect(bridge.calls('task-vault:admin:table-stats').length).toBeGreaterThanOrEqual(3)
    )
  })

  it('confirms before clearing a table', async () => {
    renderAdmin()
    fireEvent.click(await screen.findByRole('button', { name: 'Clear all rows from areas' }))
    expect(screen.getByText('Clear all rows from "areas"?')).toBeTruthy()
    fireEvent.click(confirmRun())
    await eventually(() => expect(queriesRun()).toEqual(['DELETE FROM areas']))
  })
}

function queryTests() {
  describe('writing and errors', queryWritingAndErrorsTests)
  describe('quick actions', queryQuickActionsTests)
}

function queryWritingAndErrorsTests() {
  it('runs typed SQL with Cmd+Enter and reports writes', async () => {
    const onWrite = renderAdmin()
    typeSql('UPDATE tasks SET text = 1')
    fireEvent.keyDown(screen.getByPlaceholderText('SELECT * FROM tasks LIMIT 50'), {
      key: 'Enter',
      metaKey: true,
    })
    await shows(/^1 row affected/)
    expect(onWrite).toHaveBeenCalled()
  })

  it('shows an error the query answered with, or one it threw', async () => {
    renderAdmin()
    typeSql('bad')
    fireEvent.click(screen.getByTitle('Run (⌘↵)'))
    expect(await screen.findByText('syntax error')).toBeTruthy()
    typeSql('throw')
    fireEvent.click(screen.getByTitle('Run (⌘↵)'))
    expect(await screen.findByText('Error: down')).toBeTruthy()
  })
}

function queryQuickActionsTests() {
  it('runs a safe quick action at once, without row deletes when there is no table', async () => {
    bridge.responses['task-vault:admin:run-query'] = { rows: [{ status: 'open', count: 2 }] }
    renderAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Count tasks by status' }))
    await shows(/^1 row /)
    expect(screen.queryByRole('button', { name: 'Delete this row' })).toBeNull()
    expect(screen.getByText('open')).toBeTruthy()
  })
}

function confirmTests() {
  it('asks before a destructive quick action, and can be cancelled', async () => {
    renderAdmin()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all cancelled tasks' }))
    expect(screen.getByText('Run destructive query?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Run destructive query?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete all cancelled tasks' }))
    pressOutside(screen.getByRole('dialog', { name: 'Run destructive query?' }))
    expect(queriesRun()).toEqual([])
  })

  it('deletes a row by its id, quoting string ids', async () => {
    renderAdmin()
    fireEvent.click(await screen.findByTitle('Browse tasks'))
    await shows(/^2 rows/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete this row' })[0])
    fireEvent.click(document.querySelector('.db-admin__confirm')!)
    fireEvent.click(confirmRun())
    await eventually(() => expect(queriesRun()).toContain("DELETE FROM tasks WHERE id = 't1'"))
    fireEvent.click(await screen.findByTitle('Browse tasks'))
    await shows(/^2 rows/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete this row' })[1])
    expect(screen.getByText('DELETE FROM tasks WHERE id = 2')).toBeTruthy()
  })
}

/** Answers the way task-vault:admin:run-query does: rows for a read, rows: [] and a count for a write. */
function answerQueries(result: { rows: unknown[]; changes: number }): void {
  bridge.responses['task-vault:admin:run-query'] = result
}

function reloadTests() {
  it('tells the vault to reload after a query that changed rows', async () => {
    answerQueries({ rows: [], changes: 1 })
    const onWrite = renderAdmin()
    typeSql("UPDATE tasks SET text = 'x'")
    fireEvent.click(screen.getByTitle('Run (⌘↵)'))
    await shows(/^1 row affected/)
    expect(onWrite).toHaveBeenCalledTimes(1)
  })

  it('does not reload after a read', async () => {
    answerQueries({ rows: [{ text: 'Water the plants' }], changes: 0 })
    const onWrite = renderAdmin()
    typeSql('SELECT text FROM tasks')
    fireEvent.click(screen.getByTitle('Run (⌘↵)'))
    expect(await screen.findByText('Water the plants')).toBeTruthy()
    expect(onWrite).not.toHaveBeenCalled()
  })
}
