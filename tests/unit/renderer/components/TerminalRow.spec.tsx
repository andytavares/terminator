import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalRow } from '../../../../src/renderer/components/sidebar/TerminalRow'
import type { BranchTerminal } from '../../../../src/renderer/sidebar/branch-rows'

const terminal = (patch: Partial<BranchTerminal> = {}): BranchTerminal => ({
  sessionId: 'ses-1',
  title: 'Terminal 1',
  state: 'idle',
  bellCount: 0,
  panes: [],
  ...patch,
})

const renderRow = (patch: Partial<BranchTerminal> = {}, props: Record<string, unknown> = {}) =>
  render(
    <TerminalRow
      terminal={terminal(patch)}
      selected={false}
      onSelect={vi.fn()}
      onClose={vi.fn()}
      {...props}
    />
  )

describe('TerminalRow', () => {
  it('names the terminal', () => {
    renderRow()
    expect(screen.getByText('Terminal 1')).toBeTruthy()
  })

  /**
   * The reason this component exists: a split pane could be opened and never
   * shut except by a shortcut. Every terminal listed here carries its own way
   * out.
   */
  it('offers a way to close it, named after what it closes', () => {
    const onClose = vi.fn()
    renderRow({}, { onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 1' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('closing does not also select it', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderRow({}, { onSelect, onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal 1' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSelect, 'the close control must not fall through to the row').not.toHaveBeenCalled()
  })

  it('selects on click and on the keyboard', () => {
    const onSelect = vi.fn()
    const { container } = renderRow({}, { onSelect })
    const row = container.querySelector('.terminal-row')!
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'Enter' })
    fireEvent.keyDown(row, { key: ' ' })
    expect(onSelect).toHaveBeenCalledTimes(3)
  })

  it('draws the state in the gutter, by shape and opacity rather than colour', () => {
    const { container } = renderRow({ state: 'awaiting-input' })
    const gutter = container.querySelector('.terminal-row__gutter')!
    expect(gutter.className).toContain('terminal-row__state--awaiting-input')
    expect(container.querySelector<HTMLElement>('.terminal-row')!.style.color).toBe('')
  })

  it('shows unseen bells only when there are some', () => {
    expect(renderRow().container.querySelector('.terminal-row__bell')).toBeNull()
    const { container } = renderRow({ bellCount: 3 })
    expect(container.querySelector('.terminal-row__bell')!.textContent).toBe('3')
  })

  it('marks a pane as nested, so it reads as inside its terminal', () => {
    const flat = renderRow().container.querySelector('.terminal-row')!
    expect(flat.className).not.toContain('terminal-row--nested')
    const { container } = renderRow({}, { nested: true })
    expect(container.querySelector('.terminal-row')!.className).toContain('terminal-row--nested')
  })

  it('marks the terminal currently on screen', () => {
    const { container } = renderRow({}, { selected: true })
    expect(container.querySelector('.terminal-row')!.className).toContain('terminal-row--selected')
  })
})
