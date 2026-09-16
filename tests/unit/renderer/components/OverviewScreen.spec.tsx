import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { fact } from '../sidebar/fixtures/facts'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'

const state = vi.hoisted(() => ({ facts: [] as SessionFacts[] }))
const navigate = vi.hoisted(() => vi.fn())
const setDescription = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const setActiveGlobalTab = vi.hoisted(() => vi.fn())
const startScratch = vi.hoisted(() => vi.fn())
const closeFromFacts = vi.hoisted(() => vi.fn())
const metrics = vi.hoisted(() => ({
  processesBySessionId: new Map(),
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
}))

vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => state.facts,
  useIssue: () => undefined,
  useIssueTitles: () => new Map(),
}))
vi.mock('../../../../src/renderer/components/session/LivePreview', () => ({
  LivePreview: ({ sessionId }: { sessionId: string }) => (
    <div data-testid={`preview-${sessionId}`} />
  ),
}))
vi.mock('../../../../src/renderer/stores/metrics.store', () => ({
  useMetricsStore: () => metrics,
}))
vi.mock('../../../../src/renderer/stores/session-records.store', () => ({
  useSessionRecordsStore: (select: (s: unknown) => unknown) => select({ setDescription }),
}))
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({
  navigateToSession: navigate,
}))
vi.mock('../../../../src/renderer/terminal/start-session', () => ({
  resumeSession: vi.fn(),
  startScratchSession: startScratch,
  startSessionInBranch: vi.fn(),
}))
vi.mock('../../../../src/renderer/terminal/close-session', () => ({
  closeSessionFromFacts: closeFromFacts,
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: { getState: () => ({ setActiveGlobalTab }) },
}))

vi.mock('../../../../src/renderer/components/session/SessionLinkDialog', () => ({
  SessionLinkDialog: ({ facts, onClose }: { facts: { name: string }; onClose: () => void }) => (
    <div role="dialog" aria-label={`Link ${facts.name}`}>
      <button type="button" onClick={onClose}>
        Close link
      </button>
    </div>
  ),
}))

import { OverviewScreen } from '../../../../src/renderer/components/overview/OverviewScreen'

const getPids = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  getPids.mockResolvedValue({ data: [{ sessionId: 'b', pid: 42 }] })
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { metrics: { getPids } }
  state.facts = [
    fact({ sessionId: 'a', name: 'claude', state: 'awaiting-input', lastActivityAt: 2 }),
    fact({ sessionId: 'b', name: 'vitest', state: 'working', lastActivityAt: 5 }),
    fact({ sessionId: 'c', name: 'zsh', state: 'idle', description: 'Ghostty keybinds' }),
    fact({
      sessionId: 'x',
      name: 'gone',
      isClosed: true,
      state: 'exited',
      closedAt: '2026-09-15T00:00:00.000Z',
    }),
  ]
})

const tiles = () => screen.getAllByRole('article')

describe('OverviewScreen — the Monitor wall', () => {
  it('draws every open session as a tile, and no closed history', () => {
    render(<OverviewScreen />)
    expect(tiles().map((t) => t.getAttribute('aria-label'))).toEqual([
      'Personal / terminator / main, claude',
      'Personal / terminator / main, vitest',
      'Personal / terminator / main, zsh',
    ])
  })

  it('pins sessions that need you in a band, double width, before everything else', () => {
    render(<OverviewScreen />)
    const heading = screen.getByRole('heading', { name: 'Needs you' })
    expect(heading.style.order).toBe('0')
    const needs = tiles().find((t) => t.getAttribute('aria-label')?.endsWith('claude'))!
    expect(needs.style.gridColumn).toBe('span 2')
    expect(screen.getByRole('heading', { name: 'Everything else' }).style.order).toBe('2')
  })

  it('draws no band when nothing needs you', () => {
    state.facts = state.facts.filter((f) => f.state !== 'awaiting-input')
    render(<OverviewScreen />)
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Everything else' })).toBeNull()
  })

  it('keeps every tile in one grid, so a state change moves a tile without remounting it', () => {
    const { rerender, container } = render(<OverviewScreen />)
    const grid = container.querySelector('.wall__grid')!
    expect(tiles().every((t) => t.parentElement === grid)).toBe(true)
    const preview = screen.getByTestId('preview-b')
    state.facts = state.facts.map((f) =>
      f.sessionId === 'b' ? { ...f, state: 'awaiting-input' as const } : f
    )
    rerender(<OverviewScreen />)
    expect(screen.getByTestId('preview-b')).toBe(preview)
    const moved = tiles().find((t) => t.getAttribute('aria-label')?.endsWith('vitest'))!
    expect(moved.getAttribute('data-band')).toBe('needs')
  })

  it('stops pinning when the switch is turned off, and remembers it', () => {
    render(<OverviewScreen />)
    const pin = screen.getByRole('switch', { name: 'Pin sessions that need you' })
    expect(pin.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(pin)
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull()
    expect(JSON.parse(localStorage.getItem('terminator.wall.prefs')!).pinNeeds).toBe(false)
  })

  it('changes tile size and remembers it', () => {
    const { container } = render(<OverviewScreen />)
    const sizes = screen.getByRole('radiogroup', { name: 'Tile size' })
    expect(within(sizes).getByRole('radio', { name: 'Medium' }).getAttribute('aria-checked')).toBe(
      'true'
    )
    fireEvent.click(within(sizes).getByRole('radio', { name: 'Large' }))
    expect(container.querySelector('.wall__grid')!.getAttribute('data-size')).toBe('l')
    expect(JSON.parse(localStorage.getItem('terminator.wall.prefs')!).size).toBe('l')
  })

  it('orders the rest as chosen and remembers it', () => {
    render(<OverviewScreen />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Then by' }), {
      target: { value: 'recent' },
    })
    expect(JSON.parse(localStorage.getItem('terminator.wall.prefs')!).thenBy).toBe('recent')
  })

  it('opens a saved arrangement', () => {
    localStorage.setItem(
      'terminator.wall.prefs',
      JSON.stringify({ size: 's', pinNeeds: false, thenBy: 'state' })
    )
    const { container } = render(<OverviewScreen />)
    expect(container.querySelector('.wall__grid')!.getAttribute('data-size')).toBe('s')
    expect(screen.queryByRole('heading', { name: 'Needs you' })).toBeNull()
  })

  it('filters tiles by what is typed', () => {
    render(<OverviewScreen />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter sessions' }), {
      target: { value: 'ghostty' },
    })
    expect(tiles()).toHaveLength(1)
    expect(tiles()[0].getAttribute('aria-label')).toContain('zsh')
  })

  it('says when nothing matches the filter, and clears it', () => {
    render(<OverviewScreen />)
    const search = screen.getByRole('searchbox', { name: 'Filter sessions' }) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(screen.getByText('No sessions match')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(search.value).toBe('')
  })

  it('opens a session from its tile', () => {
    render(<OverviewScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Open zsh' }))
    expect(navigate).toHaveBeenCalledWith('c')
  })

  it('saves a description typed on a tile', () => {
    render(<OverviewScreen />)
    const tile = tiles().find((t) => t.getAttribute('aria-label')?.endsWith('claude'))!
    const box = within(tile).getByRole('textbox', { name: 'What is this session doing?' })
    fireEvent.change(box, { target: { value: 'Session home view' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(setDescription).toHaveBeenCalledWith(state.facts[0].snapshot, 'Session home view')
  })

  it('polls process load for the sessions on the wall', async () => {
    render(<OverviewScreen />)
    await act(async () => {})
    expect(getPids).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(metrics.startPolling).toHaveBeenCalledWith([{ sessionId: 'b', pid: 42 }])
  })

  it('polls nothing when the pid lookup fails', async () => {
    getPids.mockRejectedValue(new Error('gone'))
    render(<OverviewScreen />)
    await act(async () => {})
    expect(metrics.startPolling).toHaveBeenCalledWith([])
  })

  it('polls nothing when the pid lookup reports an error', async () => {
    getPids.mockResolvedValue({ error: 'nope' })
    render(<OverviewScreen />)
    await act(async () => {})
    expect(metrics.startPolling).toHaveBeenCalledWith([])
  })

  it('says no terminals are open, and offers the way to them', () => {
    state.facts = []
    render(<OverviewScreen />)
    expect(screen.getByText('No terminals are open')).toBeTruthy()
    expect(metrics.startPolling).toHaveBeenCalledWith([])
    fireEvent.click(screen.getByRole('button', { name: 'Go to terminals' }))
    expect(setActiveGlobalTab).toHaveBeenCalledWith(null)
  })

  it('opens the link dialog for a session, and closes it', () => {
    render(<OverviewScreen />)
    const host = tiles().find((t) => t.getAttribute('aria-label')?.endsWith('claude'))!
    fireEvent.click(within(host).getByRole('button', { name: 'Link a work item' }))
    expect(screen.getByRole('dialog', { name: 'Link claude' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close link' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Starting work and ending it both belong where the work is shown, not only
  // in the sidebar.
  it('starts a scratch terminal from its bar', () => {
    render(<OverviewScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'New terminal' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'New scratch terminal' }))
    expect(startScratch).toHaveBeenCalled()
  })

  it('ends a session from its tile', () => {
    render(<OverviewScreen />)
    fireEvent.click(screen.getAllByRole('button', { name: /^Close / })[0])
    expect(closeFromFacts).toHaveBeenCalled()
  })
})
