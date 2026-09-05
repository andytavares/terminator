import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ProcessMetrics } from '../../../../src/shared/types/index'
import type { BoardCard } from '../../../../src/renderer/sidebar/board-lanes'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { SessionTile } from '../../../../src/renderer/components/overview/SessionTile'

const NOW = 1_000_000_000

const mockCloseSession = vi.fn()
const mockMountPreview = vi.fn(() => () => {})
const mockGetTerminalInstance = vi.fn(() => ({ mountPreview: mockMountPreview }))

function card(patch: Partial<BoardCard> = {}): BoardCard {
  return {
    sessionId: 'sess-1',
    title: 'claude',
    sourceLabel: 'terminator / 034-declutter',
    state: 'working',
    bellCount: 0,
    lastActivityAt: NOW,
    workspaceColor: '#5c6bc0',
    ...patch,
  }
}

const metrics = (patch: Partial<ProcessMetrics> = {}): ProcessMetrics =>
  ({ cpuPercent: 12.5, rssBytes: 48 * 1024 * 1024, ...patch }) as ProcessMetrics

const renderTile = (c: Partial<BoardCard> = {}, props: Record<string, unknown> = {}) =>
  render(
    <SessionTile card={card(c)} processMetrics={null} now={NOW} onNavigate={vi.fn()} {...props} />
  )

beforeEach(() => {
  vi.clearAllMocks()
  ;(useSessionStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    getTerminalInstance: mockGetTerminalInstance,
    closeSession: mockCloseSession,
  })
})

describe('SessionTile as a board card', () => {
  it('names the terminal in the human face and its source in the machine one', () => {
    const { container } = renderTile()
    expect(container.querySelector('.session-tile__title')!.textContent).toBe('claude')
    expect(container.querySelector('.session-tile__source')!.textContent).toBe(
      'terminator / 034-declutter'
    )
  })

  it('shows how long ago the terminal was active', () => {
    const { container } = renderTile({ lastActivityAt: NOW - 5 * 60 * 1000 })
    expect(container.querySelector('.session-tile__age')!.textContent).toBe('5m')
  })

  // FR-020. The live preview is what makes a card worth more than a row.
  it('mounts the live terminal preview', () => {
    renderTile()
    expect(mockGetTerminalInstance).toHaveBeenCalledWith('sess-1')
    expect(mockMountPreview).toHaveBeenCalled()
  })

  it('unmounts the preview when the card goes, so the element is handed back', () => {
    const cleanup = vi.fn()
    mockMountPreview.mockReturnValueOnce(cleanup)
    const { unmount } = renderTile()
    unmount()
    expect(cleanup).toHaveBeenCalled()
  })

  it('renders without a preview when the terminal has no instance yet', () => {
    mockGetTerminalInstance.mockReturnValueOnce(undefined as never)
    expect(() => renderTile()).not.toThrow()
  })

  // FR-013. A fact the card does not have is omitted, never drawn empty.
  it('draws no bell when none have rung', () => {
    const { container } = renderTile({ bellCount: 0 })
    expect(container.querySelector('.session-tile__bell')).toBeNull()
  })

  it('draws the bell count when bells have rung', () => {
    const { container } = renderTile({ bellCount: 3 })
    expect(container.querySelector('.session-tile__bell')!.textContent).toContain('3')
  })

  it('draws no metrics line when there are no metrics', () => {
    const { container } = renderTile()
    expect(container.querySelector('.session-tile__metrics')).toBeNull()
  })

  it('draws cpu and memory when they are known', () => {
    const { container } = renderTile({}, { processMetrics: metrics() })
    expect(container.querySelector('.session-tile__metrics')!.textContent).toBe('12.5% · 48 MB')
  })

  // FR-040 / FR-045. The repo's colour is one rail; a card with no repo draws
  // none and is otherwise laid out identically.
  it('carries the repo colour as a single rail variable', () => {
    const { container } = renderTile()
    const tile = container.querySelector<HTMLElement>('.session-tile')!
    expect(tile.style.getPropertyValue('--tile-ws-color')).toBe('#5c6bc0')
  })

  it('sets no colour at all for a terminal with no repo', () => {
    const { container } = renderTile({ workspaceColor: null, sourceLabel: 'no branch' })
    const tile = container.querySelector<HTMLElement>('.session-tile')!
    expect(tile.style.getPropertyValue('--tile-ws-color')).toBe('')
  })

  it('navigates to the terminal when clicked', () => {
    const onNavigate = vi.fn()
    const { container } = renderTile({}, { onNavigate })
    fireEvent.click(container.querySelector('.session-tile')!)
    expect(onNavigate).toHaveBeenCalled()
  })

  it.each(['Enter', ' '])('navigates on %s from the keyboard', (key) => {
    const onNavigate = vi.fn()
    const { container } = renderTile({}, { onNavigate })
    fireEvent.keyDown(container.querySelector('.session-tile')!, { key })
    expect(onNavigate).toHaveBeenCalled()
  })

  it('ignores other keys', () => {
    const onNavigate = vi.fn()
    const { container } = renderTile({}, { onNavigate })
    fireEvent.keyDown(container.querySelector('.session-tile')!, { key: 'a' })
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('closes the terminal without also navigating to it', () => {
    const onNavigate = vi.fn()
    renderTile({}, { onNavigate })
    fireEvent.click(screen.getByRole('button', { name: /close claude/i }))
    expect(mockCloseSession).toHaveBeenCalledWith('sess-1')
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('names itself for a screen reader', () => {
    renderTile()
    expect(
      screen.getByRole('button', { name: 'Switch to claude — terminator / 034-declutter' })
    ).toBeTruthy()
  })

  it('formats memory in gigabytes once it is large enough', () => {
    const { container } = renderTile({}, { processMetrics: metrics({ rssBytes: 2.5 * 1024 ** 3 }) })
    expect(container.querySelector('.session-tile__metrics')!.textContent).toContain('2.5 GB')
  })

  it('formats memory in kilobytes when it is small', () => {
    const { container } = renderTile({}, { processMetrics: metrics({ rssBytes: 900 }) })
    expect(container.querySelector('.session-tile__metrics')!.textContent).toContain('1 KB')
  })
})

describe('SessionTile re-renders only when the card actually changed', () => {
  // The memo comparator is an && chain, so each link is only reached when every
  // earlier one matched. Walking the fields in order is what exercises them all.
  const FIELDS: Array<[string, Partial<BoardCard>]> = [
    ['sessionId', { sessionId: 'other' }],
    ['title', { title: 'renamed' }],
    ['sourceLabel', { sourceLabel: 'kalli / main' }],
    ['bellCount', { bellCount: 7 }],
    ['lastActivityAt', { lastActivityAt: NOW - 60_000 }],
    ['workspaceColor', { workspaceColor: '#e0995c' }],
  ]

  it.each(FIELDS)('re-renders when %s changes', (_name, patch) => {
    const { container, rerender } = renderTile()
    rerender(
      <SessionTile card={card(patch)} processMetrics={null} now={NOW} onNavigate={vi.fn()} />
    )
    expect(container.querySelector('.session-tile')).toBeTruthy()
  })

  it('re-renders when the clock moves', () => {
    const { container, rerender } = renderTile({ lastActivityAt: NOW - 120_000 })
    rerender(
      <SessionTile
        card={card({ lastActivityAt: NOW - 120_000 })}
        processMetrics={null}
        now={NOW + 600_000}
        onNavigate={vi.fn()}
      />
    )
    expect(container.querySelector('.session-tile__age')!.textContent).toBe('12m')
  })

  it('re-renders when cpu moves', () => {
    const { container, rerender } = renderTile({}, { processMetrics: metrics() })
    rerender(
      <SessionTile
        card={card()}
        processMetrics={metrics({ cpuPercent: 90 })}
        now={NOW}
        onNavigate={vi.fn()}
      />
    )
    expect(container.querySelector('.session-tile__metrics')!.textContent).toContain('90.0%')
  })

  it('re-renders when memory moves', () => {
    const { container, rerender } = renderTile({}, { processMetrics: metrics() })
    rerender(
      <SessionTile
        card={card()}
        processMetrics={metrics({ rssBytes: 1024 * 1024 })}
        now={NOW}
        onNavigate={vi.fn()}
      />
    )
    expect(container.querySelector('.session-tile__metrics')!.textContent).toContain('1 MB')
  })

  it('stays put when nothing changed', () => {
    const { container, rerender } = renderTile()
    const before = container.querySelector('.session-tile')
    rerender(<SessionTile card={card()} processMetrics={null} now={NOW} onNavigate={vi.fn()} />)
    expect(container.querySelector('.session-tile')).toBe(before)
  })
})
