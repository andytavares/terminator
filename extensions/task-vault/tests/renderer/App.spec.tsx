import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { partialFake } from '../../../../packages/test-support/src/fakes'

const mockOn = vi.fn<Window['electronAPI']['extensionBridge']['on']>(() => vi.fn())
const mockInvoke = vi.fn()

vi.mock('../../src/components/TaskVaultView', () => ({
  TaskVaultView: () => <div data-testid="task-vault-view" />,
  CaptureModal: () => <div data-testid="capture-modal" />,
}))

vi.mock('../../src/components/CalendarDrawer', () => ({
  CalendarDrawer: () => <div data-testid="calendar-drawer" />,
}))

function setSearch(params: Record<string, string>): void {
  window.history.replaceState(null, '', '?' + new URLSearchParams(params).toString())
}

beforeEach(() => {
  mockInvoke.mockResolvedValue({ data: { pending: false } })
  window.electronAPI = partialFake<typeof window.electronAPI>({
    extensionBridge: { on: mockOn, invoke: mockInvoke },
  })
})

afterEach(() => {
  vi.resetModules()
  mockOn.mockReset()
})

describe('task-vault renderer App', taskVaultRendererAppTests)

function taskVaultRendererAppTests() {
  describe('views', taskVaultRendererAppViewsTests)
  describe('capture command', taskVaultRendererAppCaptureCommandTests)
  describe('pending capture', taskVaultRendererAppPendingCaptureTests)
}

function taskVaultRendererAppViewsTests() {
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
}

function taskVaultRendererAppCaptureCommandTests() {
  it('subscribes to capture command on mount', async () => {
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    render(<App />)
    expect(mockOn).toHaveBeenCalledWith('task-vault:push:open-capture', expect.any(Function))
  })

  it('opens the capture modal when the capture command fires', async () => {
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    const { useVaultNavStore } = await import('../../src/stores/vault-nav.store')
    render(<App />)
    const [, handler] = mockOn.mock.calls[0]
    act(() => {
      handler(undefined)
    })
    expect(useVaultNavStore.getState().showCaptureModal).toBe(true)
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
}

function taskVaultRendererAppPendingCaptureTests() {
  it('invokes consumePendingCapture on mount', async () => {
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    render(<App />)
    await expect
      .poll(() => mockInvoke.mock.calls)
      .toContainEqual(['task-vault:ui.consumePendingCapture'])
  })

  it('opens the capture modal when a capture is pending', async () => {
    mockInvoke.mockResolvedValue({ data: { pending: true } })
    setSearch({})
    const { App } = await import('../../src/renderer/App')
    const { useVaultNavStore } = await import('../../src/stores/vault-nav.store')
    render(<App />)
    await expect.poll(() => useVaultNavStore.getState().showCaptureModal).toBe(true)
  })
}
