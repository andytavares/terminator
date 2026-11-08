import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { App } from '../../../src/renderer/App'
import { useNotesStore } from '../../../src/stores/notes.store'
import { installExtensionBridge } from '../../../../../tests/support/extension-bridge'

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

const OPEN_QUICK_CREATE = 'terminator.notepad:ui.openQuickCreate'
const CONSUME_PENDING = 'terminator.notepad:ui.consumePendingQuickCreate'

let bridge: ReturnType<typeof installExtensionBridge>

function setView(view: string | null): void {
  window.history.replaceState(null, '', view ? `/?view=${view}` : '/')
}

const showQuickCreate = () => useNotesStore.getState().showQuickCreate

beforeEach(() => {
  useNotesStore.setState(useNotesStore.getInitialState())
  bridge = installExtensionBridge({ data: { pending: false } })
})

describe('notepad renderer App', notepadRendererAppTests)

function notepadRendererAppTests() {
  describe('main view', notepadRendererAppMainViewTests)
  describe('window views', notepadRendererAppWindowViewsTests)
  describe('quick create command', notepadRendererAppQuickCreateCommandTests)
  describe('unsubscribing', notepadRendererAppUnsubscribingTests)
  describe('pending quick create', notepadRendererAppPendingQuickCreateTests)
}

function notepadRendererAppMainViewTests() {
  it('renders NotepadView for ?view=main', () => {
    setView('main')
    render(<App />)
    expect(screen.queryByTestId('notepad-view')).not.toBeNull()
    expect(screen.queryByTestId('note-window-view')).toBeNull()
  })

  it('renders NotepadView when no view param', () => {
    setView(null)
    render(<App />)
    expect(screen.queryByTestId('notepad-view')).not.toBeNull()
  })
}

function notepadRendererAppWindowViewsTests() {
  it('renders NoteWindowView for ?view=note', () => {
    setView('note')
    render(<App />)
    expect(screen.queryByTestId('note-window-view')).not.toBeNull()
    expect(screen.queryByTestId('notepad-view')).toBeNull()
  })

  it('renders DiagramWindowView for ?view=diagram', () => {
    setView('diagram')
    render(<App />)
    expect(screen.queryByTestId('diagram-window-view')).not.toBeNull()
  })
}

function notepadRendererAppQuickCreateCommandTests() {
  it('shows quick create when the command fires', () => {
    setView('main')
    render(<App />)

    act(() => bridge.push(OPEN_QUICK_CREATE, undefined))

    expect(showQuickCreate()).toBe(true)
  })
}

function notepadRendererAppUnsubscribingTests() {
  it('ignores the command after unmount', () => {
    setView('main')
    const { unmount } = render(<App />)
    unmount()

    bridge.push(OPEN_QUICK_CREATE, undefined)

    expect(showQuickCreate()).toBe(false)
  })
}

function notepadRendererAppPendingQuickCreateTests() {
  it('shows quick create when the shortcut fired before the view existed', async () => {
    bridge.responses[CONSUME_PENDING] = { data: { pending: true } }
    setView('main')
    render(<App />)
    await expect.poll(showQuickCreate).toBe(true)
  })
}
