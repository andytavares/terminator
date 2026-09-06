import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { App } from '../../src/renderer/App.js'

// Two surfaces and a way into settings. The board, the card drawer, the phase
// rail and the ticket importer are gone with the pipeline underneath them, so
// what is left to assert here is small — which is the point.

const bridgeHandlers: Record<string, (data: unknown) => void> = {}

const mockBridgeInvoke = vi.fn(async (channel: string) => {
  if (channel === 'foundry:order.list') return { orders: [] }
  if (channel === 'foundry:models-list') {
    return { models: [{ id: '', label: 'Inherit', floating: true }], selected: '' }
  }
  if (channel === 'foundry:inbox.list') {
    return {
      gates: [],
      summary: { waiting: 0, orders: 0, automatic: 0, building: 0, converging: 0 },
    }
  }
  return {}
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(bridgeHandlers)) delete bridgeHandlers[key]
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: {
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        bridgeHandlers[event] = handler
        return vi.fn()
      }),
      invoke: mockBridgeInvoke,
    },
    workspace: { list: vi.fn().mockResolvedValue({ workspaces: [] }) },
    project: { create: vi.fn() },
  }
  window.history.replaceState({}, '', '/?repoRoot=/repo')
})

describe('App', () => {
  it('renders the inbox as the home surface', async () => {
    render(<App />)
    expect(screen.getByText('Foundry')).toBeTruthy()
    await waitFor(() => expect(screen.getByText(/nothing needs you/i)).toBeTruthy())
  })

  it('reaches the Forge from its own tab', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
  })

  it('comes back to the inbox', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByText(/no orders yet/i))
    fireEvent.click(screen.getByRole('button', { name: 'Inbox' }))
    await waitFor(() => expect(screen.getByText(/nothing needs you/i)).toBeTruthy())
  })

  it('marks which surface is showing, for anything reading state rather than colour', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Inbox' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('opens settings and comes back', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /back/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByText(/nothing needs you/i)).toBeTruthy())
  })

  it('asks the inbox what needs the operator, on load', async () => {
    render(<App />)
    await waitFor(() => expect(mockBridgeInvoke).toHaveBeenCalledWith('foundry:inbox.list', {}))
  })

  it('closes settings when the workspace changes underneath it', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    bridgeHandlers['workspace:changed']({ repoRoot: '/other' })
    await waitFor(() => expect(screen.getByText(/nothing needs you/i)).toBeTruthy())
  })
})
