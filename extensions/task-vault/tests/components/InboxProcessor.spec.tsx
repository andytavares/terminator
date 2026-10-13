import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

const mockInvoke = vi.fn()

Object.defineProperty(window, 'electronAPI', {
  value: { extensionBridge: { invoke: mockInvoke, on: vi.fn(() => vi.fn()) } },
  writable: true,
  configurable: true,
})

import { InboxProcessor } from '../../src/components/InboxProcessor'
import type { IndexedTask } from '../../src/vault/types'

function makeTask(id: string, text: string): IndexedTask {
  return { id, filePath: 'inbox.md', line: 0, status: 'open', text, terminatorLinks: [] }
}

const FIRST = makeTask('t1', 'Old flyer')
const SECOND = makeTask('t2', 'Write a novel')
const THIRD = makeTask('t3', 'Reply to Sam')

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  mockInvoke.mockResolvedValue({ success: true })
})

describe('InboxProcessor', () => {
  it('offers the next item when the inbox reloads without the one just processed', async () => {
    const onDone = vi.fn()
    const { rerender } = render(<InboxProcessor items={[FIRST, SECOND, THIRD]} onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Trash it' }))
    // What InboxView does when the vault broadcasts that the index changed.
    rerender(<InboxProcessor items={[SECOND, THIRD]} onDone={onDone} />)

    await waitFor(() => expect(screen.getByText(/^2 of/)).toBeTruthy())
    expect(screen.getByText('Write a novel')).toBeTruthy()
  })

  it('finishes after the last item it was opened with', async () => {
    const onDone = vi.fn()
    render(<InboxProcessor items={[FIRST]} onDone={onDone} />)

    fireEvent.click(screen.getByRole('button', { name: 'Incubate — Backlog' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1))
  })
})
