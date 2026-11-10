import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TerminalRow } from '../../../../src/components/sidebar/TerminalRow'
import { useBreakoutStore } from '../../../../src/stores/breakout.store'
import { resetStore } from '../../../../../test-support/src/renderer-stores'
import { SESSION_DRAG_TYPE } from '../../../../src/components/agent/session-drag'
import type { BranchTerminal } from '../../../../src/sidebar/branch-rows'

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

/** The row itself, a button that holds its own Close button. */
const row = () => screen.getByRole('button', { name: (name) => !name.startsWith('Close ') })

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
  it('closes from its own control, named after what it closes, without selecting it', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onClose = vi.fn()
    renderRow({}, { onSelect, onClose })
    await user.click(screen.getByRole('button', { name: 'Close Terminal 1' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSelect, 'the close control must not fall through to the row').not.toHaveBeenCalled()
  })

  it('selects on click and on the keyboard', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    renderRow({}, { onSelect })
    await user.click(row())
    expect(row().matches(':focus')).toBe(true)
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(3)
  })
})

describe('TerminalRow — draws the state in the gutter as a compact chip, named for a reader', () => {
  it('draws the state in the gutter as a compact chip, named for a reader', () => {
    renderRow({ state: 'awaiting-input' })
    const chip = screen.getByRole('img', { name: 'Waiting on you' })
    expect(chip.className).toContain('state-chip--compact')
    expect(chip.className).toContain('state-chip--awaiting-input')
    expect(row().style.color).toBe('')
  })

  it('shows unseen bells only when there are some', () => {
    const { unmount } = renderRow()
    expect(screen.queryByLabelText(/unseen/)).toBeNull()
    unmount()
    renderRow({ bellCount: 3 })
    expect(screen.getByLabelText('3 unseen').textContent).toBe('3')
  })

  it('marks a pane as nested, so it reads as inside its terminal', () => {
    const { unmount } = renderRow()
    expect(row().className).not.toContain('terminal-row--nested')
    unmount()
    renderRow({}, { nested: true })
    expect(row().className).toContain('terminal-row--nested')
  })

  it('marks the terminal currently on screen', () => {
    renderRow({}, { selected: true })
    expect(row().getAttribute('aria-current')).toBe('true')
  })
})

describe('TerminalRow — work item', () => {
  it('draws its own session link as a key', () => {
    renderRow({ workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-1' } } })
    expect(screen.getByText('ENG-1')).toBeTruthy()
  })

  it('does not draw an inherited branch link — the branch row above already shows it', () => {
    renderRow({
      workItem: { source: 'project', ref: { tracker: 'linear', key: 'ENG-1' } },
    })
    expect(screen.queryByText('ENG-1')).toBeNull()
  })

  it('offers only "Link ticket…" when the session has no link', async () => {
    const user = userEvent.setup()
    const onLinkIssue = vi.fn()
    renderRow({}, { onLinkIssue })
    fireEvent.contextMenu(row())
    expect(screen.getByText('Link ticket…')).toBeTruthy()
    expect(screen.queryByText('Change linked ticket…')).toBeNull()
    await user.click(screen.getByText('Link ticket…'))
    expect(onLinkIssue).toHaveBeenCalledOnce()
  })
})

describe('TerminalRow — work item — offers change and remove when the session has its own link', () => {
  it('offers change and remove when the session has its own link', async () => {
    const user = userEvent.setup()
    const onLinkIssue = vi.fn()
    const onRemoveLink = vi.fn()
    renderRow(
      { workItem: { source: 'session', ref: { tracker: 'linear', key: 'ENG-1' } } },
      { onLinkIssue, onRemoveLink }
    )
    fireEvent.contextMenu(row())
    expect(screen.getByText('Change linked ticket…')).toBeTruthy()
    await user.click(screen.getByText('Remove session link'))
    expect(onRemoveLink).toHaveBeenCalledOnce()
  })

  it('draws no menu at all when nothing can link', () => {
    renderRow()
    fireEvent.contextMenu(row())
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('TerminalRow — work item — dismissing the menu', () => {
  it('closes the menu on a click elsewhere, linking nothing', async () => {
    const user = userEvent.setup()
    const onLinkIssue = vi.fn()
    renderRow({}, { onLinkIssue })
    fireEvent.contextMenu(row())
    expect(screen.getByRole('menu', { name: 'Actions' })).toBeTruthy()
    await user.click(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onLinkIssue).not.toHaveBeenCalled()
  })
})

describe('TerminalRow — a terminal in its own window', () => {
  it('shows a window icon titled for it in place of the state chip', () => {
    resetStore(useBreakoutStore, { windows: new Map([['ses-1', window]]) })
    renderRow()
    expect(screen.getByTitle('In its own window')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'Idle' })).toBeNull()
  })
})

describe('TerminalRow — dragging it out', () => {
  it('carries its session id, as a copy, so an agent tab can attach it', () => {
    renderRow()
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    expect(row().draggable).toBe(true)
    fireEvent.dragStart(row(), { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith(SESSION_DRAG_TYPE, 'ses-1')
    expect(dataTransfer.effectAllowed).toBe('copy')
  })

  it('fades while it is dragged and comes back when the drag ends', () => {
    renderRow()
    fireEvent.dragStart(row(), { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    expect(row().classList.contains('terminal-row--dragging')).toBe(true)
    fireEvent.dragEnd(row())
    expect(row().classList.contains('terminal-row--dragging')).toBe(false)
  })
})
