import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { ScratchPanel } from '../../../../src/renderer/components/sidebar/ScratchPanel'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))
vi.mock('../../../../src/renderer/components/ActivitySpinner', () => ({
  ActivitySpinner: () => <div data-testid="activity-spinner" />,
}))
vi.mock('../../../../src/renderer/components/AlertBadge', () => ({
  AlertBadge: ({ count }: { count: number }) =>
    count > 0 ? <div data-testid="alert-badge">{count}</div> : null,
}))

function makeSession(overrides = {}) {
  return {
    id: 'sess-1',
    projectId: '00000000-0000-0000-0000-000000000000',
    tabTitle: 'Scratch',
    status: 'active' as const,
    type: 'human' as const,
    scrollbackLimit: 5000,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

const mockCloseSession = vi.fn()

function setupMock(sessions = [makeSession()]) {
  vi.mocked(useSessionStore).mockReturnValue({
    getScratchSessions: vi.fn().mockReturnValue(sessions),
    closeSession: mockCloseSession,
    getBellCountForSession: vi.fn().mockReturnValue(0),
    isSessionBusy: vi.fn().mockReturnValue(false),
  } as unknown as ReturnType<typeof useSessionStore>)
}

describe('ScratchPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders null when there are no scratch sessions', () => {
    setupMock([])
    const { container } = render(<ScratchPanel activeSessionId={null} onSelectSession={vi.fn()} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a row for each scratch session', () => {
    setupMock([
      makeSession({ id: 'sess-1', tabTitle: 'Scratch 1' }),
      makeSession({ id: 'sess-2', tabTitle: 'Scratch 2' }),
    ])
    render(<ScratchPanel activeSessionId={null} onSelectSession={vi.fn()} />)
    expect(screen.getByText('Scratch 1')).toBeTruthy()
    expect(screen.getByText('Scratch 2')).toBeTruthy()
  })

  it('marks the active session row as active', () => {
    setupMock([makeSession({ id: 'sess-1' })])
    render(<ScratchPanel activeSessionId="sess-1" onSelectSession={vi.fn()} />)
    const rows = document.querySelectorAll('.scratch-panel__row')
    expect(rows[0].classList.contains('scratch-panel__row--active')).toBe(true)
  })

  it('does not mark non-active session rows as active', () => {
    setupMock([makeSession({ id: 'sess-1' })])
    render(<ScratchPanel activeSessionId="sess-2" onSelectSession={vi.fn()} />)
    const rows = document.querySelectorAll('.scratch-panel__row')
    expect(rows[0].classList.contains('scratch-panel__row--active')).toBe(false)
  })

  it('calls onSelectSession when a row is clicked', () => {
    const onSelectSession = vi.fn()
    setupMock([makeSession({ id: 'sess-1', tabTitle: 'MyTab' })])
    render(<ScratchPanel activeSessionId={null} onSelectSession={onSelectSession} />)
    fireEvent.click(screen.getByText('MyTab'))
    expect(onSelectSession).toHaveBeenCalledWith('sess-1')
  })

  it('calls closeSession when close button is clicked', () => {
    setupMock([makeSession({ id: 'sess-1' })])
    render(<ScratchPanel activeSessionId={null} onSelectSession={vi.fn()} />)
    const closeBtn = document.querySelector('.scratch-panel__close')
    fireEvent.click(closeBtn!)
    expect(mockCloseSession).toHaveBeenCalledWith('sess-1')
  })

  it('does not call onSelectSession when close button is clicked', () => {
    const onSelectSession = vi.fn()
    setupMock([makeSession({ id: 'sess-1' })])
    render(<ScratchPanel activeSessionId={null} onSelectSession={onSelectSession} />)
    const closeBtn = document.querySelector('.scratch-panel__close')
    fireEvent.click(closeBtn!)
    expect(onSelectSession).not.toHaveBeenCalled()
  })

  it('shows activity spinner for busy sessions', () => {
    vi.mocked(useSessionStore).mockReturnValue({
      getScratchSessions: vi.fn().mockReturnValue([makeSession()]),
      closeSession: mockCloseSession,
      getBellCountForSession: vi.fn().mockReturnValue(0),
      isSessionBusy: vi.fn().mockReturnValue(true),
    } as unknown as ReturnType<typeof useSessionStore>)
    render(<ScratchPanel activeSessionId={null} onSelectSession={vi.fn()} />)
    expect(screen.getByTestId('activity-spinner')).toBeTruthy()
  })

  it('shows bell count badge when non-zero', () => {
    vi.mocked(useSessionStore).mockReturnValue({
      getScratchSessions: vi.fn().mockReturnValue([makeSession()]),
      closeSession: mockCloseSession,
      getBellCountForSession: vi.fn().mockReturnValue(3),
      isSessionBusy: vi.fn().mockReturnValue(false),
    } as unknown as ReturnType<typeof useSessionStore>)
    render(<ScratchPanel activeSessionId={null} onSelectSession={vi.fn()} />)
    expect(screen.getByTestId('alert-badge')).toBeTruthy()
  })
})
