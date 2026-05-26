import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'

const mockAddToast = vi.fn()
vi.mock('../../../../src/renderer/stores/toast.store', () => ({
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
  it('renders both code blocks in preview', () => {
    const { container } = render(
      <KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />
    )
    // Text may be split across highlight.js spans — check textContent
    expect(container.textContent).toContain('const x = 1')
    expect(container.textContent).toContain('const y = 2')
  })

  it('defaults to mine-first order', () => {
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const previewEl = document.querySelector('.keep-both-modal__preview') as HTMLElement
    expect(previewEl?.textContent).toContain('const x = 1')
    const text = previewEl?.textContent ?? ''
    expect(text.indexOf('const x = 1')).toBeLessThan(text.indexOf('const y = 2'))
  })

  it('"Theirs first" toggle changes preview order', () => {
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText(/Theirs first/i))
    const previewEl = document.querySelector('.keep-both-modal__preview') as HTMLElement
    const text = previewEl?.textContent ?? ''
    expect(text.indexOf('const y = 2')).toBeLessThan(text.indexOf('const x = 1'))
  })

  it('"Mine first" toggle restores original order', () => {
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText(/Theirs first/i))
    fireEvent.click(screen.getByLabelText(/Mine first/i))
    const previewEl = document.querySelector('.keep-both-modal__preview') as HTMLElement
    const text = previewEl?.textContent ?? ''
    expect(text.indexOf('const x = 1')).toBeLessThan(text.indexOf('const y = 2'))
  })

  it('calls onConfirm with both-ours-first strategy when confirming mine-first', () => {
    const onConfirm = vi.fn()
    render(<KeepBothModal block={uniqueBlock} onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText(/Confirm|Use this order/i))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining('const x = 1'),
      'both-ours-first'
    )
  })

  it('calls onConfirm with both-theirs-first strategy when confirming theirs-first', () => {
    const onConfirm = vi.fn()
    render(<KeepBothModal block={uniqueBlock} onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByLabelText(/Theirs first/i))
    fireEvent.click(screen.getByText(/Confirm|Use this order/i))
    expect(onConfirm).toHaveBeenCalledWith(
      expect.stringContaining('const y = 2'),
      'both-theirs-first'
    )
  })

  it('calls onCancel when Cancel button clicked', () => {
    const onCancel = vi.fn()
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByText(/Cancel/i))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not call onConfirm when Cancel clicked', () => {
    const onConfirm = vi.fn()
    render(<KeepBothModal block={uniqueBlock} onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByText(/Cancel/i))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows duplicate identifier warning when ours and theirs contain same function name', () => {
    render(<KeepBothModal block={baseBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText(/duplicate|same name|conflict/i)).toBeTruthy()
  })

  it('does not show duplicate warning when identifiers are unique', () => {
    render(<KeepBothModal block={uniqueBlock} onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByText(/duplicate/i)).toBeNull()
  })
})
