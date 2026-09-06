import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../src/components/RemoteControlView', () => ({
  RemoteControlView: () => <div data-testid="remote-control-view" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.resetModules()
})

// App is now a one-line wrapper; the behaviour it used to hold moved into
// RemoteControlView, which is covered by its own spec. What the old tests
// asserted here — "subscribes to remote:status", "verify no crash" — is asserted
// there against real states rather than against an internal flag.
describe('remote-control renderer App', () => {
  it('renders the Remote Control view', async () => {
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('remote-control-view')).toBeDefined()
  })
})
