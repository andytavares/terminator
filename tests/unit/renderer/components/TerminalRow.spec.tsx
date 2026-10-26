import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TerminalRow } from '../../../../src/renderer/components/sidebar/TerminalRow'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { resetStore } from '../../../support/renderer-stores'
import type { BranchTerminal } from '../../../../src/renderer/sidebar/branch-rows'

const terminal = (patch: Partial<BranchTerminal> = {}): BranchTerminal => ({
  sessionId: 'ses-1',
  title: 'Terminal 1',
  state: 'idle',
  bellCount: 0,
  panes: [],
  workItem: null,
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

beforeEach(() => resetStore(useBreakoutStore))

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
})

describe('TerminalRow — draws the state in the gutter as a compact chip, named for a reader', () => {
  it('draws the state in the gutter as a compact chip, named for a reader', () => {
    const { container } = renderRow({ state: 'awaiting-input' })
    const gutter = container.querySelector('.terminal-row__gutter')!
    const chip = gutter.querySelector('.state-chip')!
    expect(chip.className).toContain('state-chip--compact')
    expect(chip.className).toContain('state-chip--awaiting-input')
    expect(chip.getAttribute('aria-label')).toBe('Waiting on you')
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

describe('TerminalRow — work item', () => {
  it('draws its own session link as a key', () => {
    renderRow({ workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-1' } } })
    expect(screen.getByText('ENG-1')).toBeTruthy()
  })

  it('does not draw an inherited branch link — the branch row above already shows it', () => {
    const { container } = renderRow({
      workItem: { source: 'project', ref: { tracker: 'linear', key: 'ENG-1' } },
    })
    expect(container.querySelector('.terminal-row__key')).toBeNull()
  })

  it('draws nothing when there is no work item', () => {
    const { container } = renderRow()
    expect(container.querySelector('.terminal-row__key')).toBeNull()
  })

  it('offers only "Link issue…" when the session has no link', () => {
    const onLinkIssue = vi.fn()
    const { container } = renderRow({}, { onLinkIssue })
    fireEvent.contextMenu(container.querySelector('.terminal-row')!)
    expect(screen.getByText('Link issue…')).toBeTruthy()
    expect(screen.queryByText('Change linked issue…')).toBeNull()
    fireEvent.click(screen.getByText('Link issue…'))
    expect(onLinkIssue).toHaveBeenCalledOnce()
  })
})

describe('TerminalRow — work item — offers change and remove when the session has its own link', () => {
  it('offers change and remove when the session has its own link', () => {
    const onLinkIssue = vi.fn()
    const onRemoveLink = vi.fn()
    const { container } = renderRow(
      { workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-1' } } },
      { onLinkIssue, onRemoveLink }
    )
    fireEvent.contextMenu(container.querySelector('.terminal-row')!)
    expect(screen.getByText('Change linked issue…')).toBeTruthy()
    fireEvent.click(screen.getByText('Remove session link'))
    expect(onRemoveLink).toHaveBeenCalledOnce()
  })

  it('draws no menu at all when nothing can link', () => {
    const { container } = renderRow()
    fireEvent.contextMenu(container.querySelector('.terminal-row')!)
    expect(document.querySelector('.ctx-menu')).toBeNull()
  })
})

describe('TerminalRow — work item — dismissing the menu', () => {
  it('closes the menu on a click elsewhere, linking nothing', () => {
    const onLinkIssue = vi.fn()
    const { container } = renderRow({}, { onLinkIssue })
    fireEvent.contextMenu(container.querySelector('.terminal-row')!)
    expect(document.querySelector('.ctx-menu')).toBeTruthy()
    fireEvent.click(document.body)
    expect(document.querySelector('.ctx-menu')).toBeNull()
    expect(onLinkIssue).not.toHaveBeenCalled()
  })
})

describe('TerminalRow — a terminal in its own window', () => {
  it('shows a window icon titled for it in place of the state chip', () => {
    resetStore(useBreakoutStore, { windows: new Map([['ses-1', window]]) })
    const { container } = renderRow()
    expect(screen.getByTitle('In its own window')).toBeTruthy()
    expect(container.querySelector('.terminal-row__gutter .state-chip')).toBeNull()
  })

  it('keeps the state chip for a terminal that is not', () => {
    const { container } = renderRow()
    expect(screen.queryByTitle('In its own window')).toBeNull()
    expect(container.querySelector('.terminal-row__gutter .state-chip')).not.toBeNull()
  })
})
