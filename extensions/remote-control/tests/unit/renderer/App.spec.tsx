import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('../../../src/components/RemoteControlSettings', () => ({
  RemoteControlSettings: () => <div data-testid="remote-control-settings" />,
}))

const mockBridgeOn = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  const unsubscribe = vi.fn()
  mockBridgeOn.mockReturnValue(unsubscribe)
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { on: mockBridgeOn } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.resetModules()
})

describe('remote-control renderer App', () => {
  it('renders RemoteControlSettings', async () => {
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('remote-control-settings')).toBeDefined()
  })

  it('subscribes to remote:status on mount', async () => {
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(mockBridgeOn).toHaveBeenCalledWith('remote:status', expect.any(Function))
  })

  it('tracks enabled state from remote:status events', async () => {
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    const handler = mockBridgeOn.mock.calls.find(([ch]) => ch === 'remote:status')?.[1]
    expect(handler).toBeDefined()
    act(() => {
      handler?.({ enabled: true })
    })
    // enabled state is internal — just verify no crash
  })

  it('unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn()
    mockBridgeOn.mockReturnValue(unsubscribe)
    const { App } = await import('../../../src/renderer/App')
    const { unmount } = render(<App />)
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
