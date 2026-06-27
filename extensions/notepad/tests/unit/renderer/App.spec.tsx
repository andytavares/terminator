import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

vi.mock('../../../src/components/NotepadView', () => ({
  NotepadView: () => <div data-testid="notepad-view" />,
}))
vi.mock('../../../src/components/NoteWindowView', () => ({
  NoteWindowView: () => <div data-testid="note-window-view" />,
}))
vi.mock('../../../src/components/DiagramWindowView', () => ({
  DiagramWindowView: () => <div data-testid="diagram-window-view" />,
}))
vi.mock('../../../src/components/QuickCreateOverlay', () => ({
  QuickCreateOverlay: () => <div data-testid="quick-create-overlay" />,
}))

const mockSetShowQuickCreate = vi.fn()
vi.mock('../../../src/stores/notes.store', () => ({
  useNotesStore: () => ({ setShowQuickCreate: mockSetShowQuickCreate }),
}))

const mockBridgeOn = vi.fn()
const mockBridgeOff = vi.fn()
const mockBridgeInvoke = vi.fn()

function setView(view: string | null): void {
  const url = view ? `?view=${view}` : '?'
  Object.defineProperty(window, 'location', {
    value: { search: url },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockBridgeOn.mockReturnValue(mockBridgeOff)
  mockBridgeInvoke.mockResolvedValue({ data: { pending: false } })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { on: mockBridgeOn, invoke: mockBridgeInvoke } },
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  vi.resetModules()
})

describe('notepad renderer App', () => {
  it('renders NotepadView for ?view=main', async () => {
    setView('main')
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('notepad-view')).toBeDefined()
    expect(screen.queryByTestId('note-window-view')).toBeNull()
  })

  it('renders NotepadView when no view param', async () => {
    setView(null)
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('notepad-view')).toBeDefined()
  })

  it('renders NoteWindowView for ?view=note', async () => {
    setView('note')
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('note-window-view')).toBeDefined()
    expect(screen.queryByTestId('notepad-view')).toBeNull()
  })

  it('renders DiagramWindowView for ?view=diagram', async () => {
    setView('diagram')
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(screen.getByTestId('diagram-window-view')).toBeDefined()
  })

  it('subscribes to terminator.notepad:ui.openQuickCreate on mount', async () => {
    setView('main')
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    expect(mockBridgeOn).toHaveBeenCalledWith(
      'terminator.notepad:ui.openQuickCreate',
      expect.any(Function)
    )
  })

  it('calls setShowQuickCreate(true) when command fires', async () => {
    setView('main')
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    const handler = mockBridgeOn.mock.calls.find(
      ([ch]) => ch === 'terminator.notepad:ui.openQuickCreate'
    )?.[1]
    expect(handler).toBeDefined()
    act(() => {
      handler?.()
    })
    expect(mockSetShowQuickCreate).toHaveBeenCalledWith(true)
  })

  it('unsubscribes from command on unmount', async () => {
    setView('main')
    const { App } = await import('../../../src/renderer/App')
    const { unmount } = render(<App />)
    unmount()
    expect(mockBridgeOff).toHaveBeenCalled()
  })

  it('invokes consumePendingQuickCreate on mount', async () => {
    setView('main')
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    await act(async () => {})
    expect(mockBridgeInvoke).toHaveBeenCalledWith('terminator.notepad:ui.consumePendingQuickCreate')
  })

  it('calls setShowQuickCreate(true) when pending flag is set', async () => {
    mockBridgeInvoke.mockResolvedValue({ data: { pending: true } })
    setView('main')
    const { App } = await import('../../../src/renderer/App')
    render(<App />)
    await act(async () => {})
    expect(mockSetShowQuickCreate).toHaveBeenCalledWith(true)
  })
})
