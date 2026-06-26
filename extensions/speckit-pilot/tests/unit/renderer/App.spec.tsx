import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../src/components/SpecKitPilotView', () => ({
  SpecKitPilotView: ({ repoRoot }: { repoRoot: string | null }) => (
    <div data-testid="speckit-pilot-view" data-repo-root={repoRoot ?? ''} />
  ),
}))

function setSearch(params: Record<string, string>): void {
  const search = '?' + new URLSearchParams(params).toString()
  Object.defineProperty(window, 'location', {
    value: { search },
    configurable: true,
    writable: true,
  })
}

const mockBridgeOn = vi.fn(() => () => {})

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { on: mockBridgeOn } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.resetModules()
  vi.restoreAllMocks()
})

describe('speckit-pilot renderer App', () => {
  it('renders SpecKitPilotView', async () => {
    setSearch({})
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('speckit-pilot-view')).toBeDefined()
  })

  it('passes repoRoot from URL params', async () => {
    setSearch({ repoRoot: '/my/project' })
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    const el = screen.getByTestId('speckit-pilot-view')
    expect(el.getAttribute('data-repo-root')).toBe('/my/project')
  })
})
