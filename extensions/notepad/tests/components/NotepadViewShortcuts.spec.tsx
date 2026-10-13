import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../src/components/SearchOverlay', () => ({
  SearchOverlay: () => <div data-testid="search-overlay" />,
}))

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: { invoke: vi.fn().mockResolvedValue({ data: [] }), on: vi.fn(() => vi.fn()) },
    extension: {
      getSettingsValues: vi.fn().mockResolvedValue({ values: {} }),
      onSettingsChanged: vi.fn(() => () => {}),
    },
  },
  writable: true,
  configurable: true,
})

import { NotepadView } from '../../src/components/NotepadView'

afterEach(() => cleanup())

describe('NotepadView search shortcut', () => {
  // With Shift held, the key a browser reports is the capital letter wherever
  // Control is the modifier (Linux, Windows), and the small one under ⌘.
  it.each(['F', 'f'])('opens search for Ctrl/⌘+Shift+%s', (key) => {
    render(<NotepadView />)
    fireEvent.keyDown(document, { key, ctrlKey: true, shiftKey: true })
    expect(screen.getByTestId('search-overlay')).toBeTruthy()
  })
})
