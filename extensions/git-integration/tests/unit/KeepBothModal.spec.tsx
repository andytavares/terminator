import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

const mockAddToast = vi.fn()
vi.mock('../../../../packages/core-renderer/src/stores/toast.store', () => ({
  useToastStore: () => ({ addToast: mockAddToast }),
}))

import { KeepBothModal } from '../../src/components/merge-flow/KeepBothModal'

const baseBlock = {
  blockId: 'src/foo.ts#0',
  index: 0,
  oursText: 'function doThing() {}',
  theirsText: 'function doThing() { return 42 }',
  baseText: '',
  contextBefore: [],
  contextAfter: [],
  originalConflictText:
    '<<<<<<< HEAD\nfunction doThing() {}\n=======\nfunction doThing() { return 42 }\n>>>>>>> branch',
  isResolved: false,
  oursAuthor: { name: 'Alice', commitHash: 'abc', timestamp: '2026-01-01T00:00:00Z' },
  theirsAuthor: { name: 'Bob', commitHash: 'def', timestamp: '2026-01-01T00:00:00Z' },
}

const uniqueBlock = {
  ...baseBlock,
  oursText: 'const x = 1',
  theirsText: 'const y = 2',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('KeepBothModal', () => {
  it('defaults to mine-first order', () => {
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const previewEl = screen.getByRole('group', { name: 'Merged result preview' })
    expect(previewEl.textContent).toContain('const x = 1')
    const text = previewEl.textContent ?? ''
    expect(text.indexOf('const x = 1')).toBeLessThan(text.indexOf('const y = 2'))
  })

  it('"Theirs first" toggle changes preview order', async () => {
    const user = userEvent.setup()
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: /Theirs first/i }))
    const previewEl = screen.getByRole('group', { name: 'Merged result preview' })
    const text = previewEl.textContent ?? ''
    expect(text.indexOf('const y = 2')).toBeLessThan(text.indexOf('const x = 1'))
  })
})

describe('KeepBothModal — Mine first toggle restores original order', () => {
  it('"Mine first" toggle restores original order', async () => {
    const user = userEvent.setup()
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: /Theirs first/i }))
    await user.click(screen.getByRole('radio', { name: /Mine first/i }))
    const previewEl = screen.getByRole('group', { name: 'Merged result preview' })
    const text = previewEl.textContent ?? ''
    expect(text.indexOf('const x = 1')).toBeLessThan(text.indexOf('const y = 2'))
  })

  it('calls onConfirm with both-ours-first strategy when confirming mine-first', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<KeepBothModal block={uniqueBlock} onConfirm={onConfirm} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Use this order' }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining('const x = 1'),
      'both-ours-first'
    )
  })
})

describe('KeepBothModal — calls onConfirm with both-theirs-first strategy when confirming theirs-first', () => {
  it('calls onConfirm with both-theirs-first strategy when confirming theirs-first', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    render(<KeepBothModal block={uniqueBlock} onConfirm={onConfirm} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('radio', { name: /Theirs first/i }))
    await user.click(screen.getByRole('button', { name: 'Use this order' }))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining('const y = 2'),
      'both-theirs-first'
    )
  })

  it('calls onCancel and not onConfirm when Cancel is clicked', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<KeepBothModal block={uniqueBlock} onConfirm={onConfirm} onCancel={onCancel} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('KeepBothModal — shows duplicate identifier warning when ours and theirs contain same function name', () => {
  it('shows duplicate identifier warning when ours and theirs contain same function name', () => {
    render(<KeepBothModal block={baseBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByRole('alert').textContent?.trim()).toBe(
      'This will produce a duplicate identifier. Consider using "Edit manually" to combine them.'
    )
  })

  it('does not show duplicate warning when identifiers are unique', () => {
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/duplicate/i)).toBeNull()
  })
})
