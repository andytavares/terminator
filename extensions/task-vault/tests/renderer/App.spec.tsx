import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

const mockSetShowCaptureModal = vi.fn()
const mockSetView = vi.fn()
const mockOn = vi.fn(() => vi.fn())

vi.mock('../../src/components/TaskVaultView', () => ({
  TaskVaultView: () => <div data-testid="task-vault-view" />,
  CaptureModal: () => <div data-testid="capture-modal" />,
}))

vi.mock('../../src/components/CalendarDrawer', () => ({
  CalendarDrawer: () => <div data-testid="calendar-drawer" />,
}))

vi.mock('../../src/stores/vault-nav.store', () => ({
  useVaultNavStore: () => ({
    setShowCaptureModal: mockSetShowCaptureModal,
    setView: mockSetView,
  }),
}))

function setSearch(params: Record<string, string>): void {
  const search = '?' + new URLSearchParams(params).toString()
  Object.defineProperty(window, 'location', {
    value: { search },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  window.electronAPI = {
    extensionBridge: { on: mockOn },
  } as unknown as typeof window.electronAPI
})

afterEach(() => {
  vi.resetModules()
  mockOn.mockReset()
  mockSetShowCaptureModal.mockReset()
})

describe('task-vault renderer App', () => {
  it('renders TaskVaultView by default', async () => {
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('task-vault-view')).toBeDefined()
  })

  it('renders CalendarDrawer when view=calendar', async () => {
    setSearch({ view: 'calendar' })
    const { App } = await import('../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('calendar-drawer')).toBeDefined()
  })

  it('subscribes to capture command on mount', async () => {
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    render(<App />)
    expect(mockOn).toHaveBeenCalledWith('task-vault:push:open-capture', expect.any(Function))
  })

  it('calls setShowCaptureModal(true) when capture command fires', async () => {
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    render(<App />)
    const [, handler] = mockOn.mock.calls[0]
    handler()
    expect(mockSetShowCaptureModal).toHaveBeenCalledWith(true)
  })

  it('unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn()
    mockOn.mockReturnValue(unsubscribe)
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    const { unmount } = render(<App />)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
