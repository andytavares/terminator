import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke, on: vi.fn(() => vi.fn()) } },
  writable: true,
  configurable: true,
})

import { DatabaseAdmin } from '../../src/components/DatabaseAdmin'

/** Answers the way task-vault:admin:run-query does: rows for a read, rows: [] and a count for a write. */
function answerQueries(result: { rows: unknown[]; changes: number }): void {
  mockInvoke.mockImplementation(async (channel: string) =>
    channel === 'task-vault:admin:table-stats' ? { stats: { tasks: 1 } } : result
  )
}

async function run(sql: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('SELECT * FROM tasks LIMIT 50'), {
    target: { value: sql },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Run' }))
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('DatabaseAdmin', () => {
  it('tells the vault to reload after a query that changed rows', async () => {
    answerQueries({ rows: [], changes: 1 })
    const onWrite = vi.fn()
    render(<DatabaseAdmin onWrite={onWrite} />)

    await run("UPDATE tasks SET text = 'x'")

    await waitFor(() => expect(onWrite).toHaveBeenCalledTimes(1))
    expect(document.querySelector('.db-admin__results')?.textContent).toContain('1 row affected')
  })

  it('does not reload after a read', async () => {
    answerQueries({ rows: [{ text: 'Water the plants' }], changes: 0 })
    const onWrite = vi.fn()
    render(<DatabaseAdmin onWrite={onWrite} />)

    await run('SELECT text FROM tasks')

    await waitFor(() => expect(screen.getByText('Water the plants')).toBeTruthy())
    expect(onWrite).not.toHaveBeenCalled()
  })
})
