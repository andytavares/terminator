import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, act } from '@testing-library/react'
import { fact } from '../sidebar/fixtures/facts'
import type { SessionFacts } from '../../../../src/renderer/sidebar/session-facts'

const state = vi.hoisted(() => ({ facts: [] as SessionFacts[] }))
const setDescription = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const navigate = vi.hoisted(() => vi.fn())
const setActiveGlobalTab = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/renderer/components/session/useSessionFacts', () => ({
  useSessionFacts: () => state.facts,
  useIssue: () => undefined,
  useIssueTitles: () => new Map(),
}))
vi.mock('../../../../src/renderer/components/session/LivePreview', () => ({
  LivePreview: () => <div />,
}))
vi.mock('../../../../src/renderer/stores/session-records.store', () => ({
  useSessionRecordsStore: (select: (s: unknown) => unknown) => select({ setDescription }),
}))
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({
  navigateToSession: navigate,
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: { getState: () => ({ setActiveGlobalTab }) },
}))

import { HomeScreen } from '../../../../src/renderer/components/home/HomeScreen'

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  state.facts = [
    fact({ sessionId: 'a', name: 'claude', state: 'awaiting-input' }),
    fact({ sessionId: 'b', name: 'zsh', description: 'Checking bundle size' }),
  ]
})

describe('HomeScreen', () => {
  it('lists every session in the Ledger and counts them', () => {
    render(<HomeScreen />)
    expect(screen.getByRole('heading', { name: 'Home' })).toBeTruthy()
    expect(screen.getByText('2 sessions')).toBeTruthy()
    const grid = screen.getByRole('grid', { name: 'Sessions' })
    expect(within(grid).getAllByRole('row', { name: /claude|zsh/ })).toHaveLength(2)
  })

  it('counts one session in the singular', () => {
    state.facts = [fact()]
    render(<HomeScreen />)
    expect(screen.getByText('1 session')).toBeTruthy()
  })

  it('selects a row, and a second click on it keeps it selected', () => {
    render(<HomeScreen />)
    fireEvent.click(screen.getByRole('row', { name: 'zsh' }))
    expect(screen.getByRole('row', { name: 'zsh' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('region', { name: 'Preview of zsh' })).toBeTruthy()
  })

  it('opens a session in its terminal', () => {
    render(<HomeScreen />)
    fireEvent.keyDown(screen.getByRole('row', { name: 'claude' }), { key: 'Enter' })
    expect(navigate).toHaveBeenCalledWith('a')
  })

  it('writes a description to the session record', async () => {
    render(<HomeScreen />)
    const box = within(screen.getByRole('row', { name: 'claude' })).getByRole('textbox', {
      name: 'What is this session doing?',
    })
    fireEvent.change(box, { target: { value: 'Session home view' } })
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' })
    })
    expect(setDescription).toHaveBeenCalledWith(state.facts[0].snapshot, 'Session home view')
  })

  it('narrows the list as the filter is typed', () => {
    render(<HomeScreen />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter sessions' }), {
      target: { value: 'bundle' },
    })
    expect(screen.queryByRole('row', { name: 'claude' })).toBeNull()
    expect(screen.getByRole('row', { name: 'zsh' })).toBeTruthy()
  })

  it('says when nothing matches and clears the filter on request', () => {
    render(<HomeScreen />)
    const search = screen.getByRole('searchbox', { name: 'Filter sessions' }) as HTMLInputElement
    fireEvent.change(search, { target: { value: 'no such thing' } })
    expect(screen.getByText('No sessions match')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(search.value).toBe('')
    expect(screen.getByRole('row', { name: 'claude' })).toBeTruthy()
  })

  it('says no terminals are open, and offers the way to them', () => {
    state.facts = []
    render(<HomeScreen />)
    expect(screen.getByText('No terminals are open')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go to terminals' }))
    expect(setActiveGlobalTab).toHaveBeenCalledWith(null)
  })

  it('still shows closed history when no terminal is open', () => {
    state.facts = [
      fact({
        sessionId: 'c',
        name: 'old',
        isClosed: true,
        state: 'exited',
        closedAt: '2026-09-15T00:00:00.000Z',
      }),
    ]
    render(<HomeScreen />)
    expect(screen.getByText('No terminals are open')).toBeTruthy()
    expect(screen.getByRole('rowgroup', { name: 'Closed' })).toBeTruthy()
  })
})
