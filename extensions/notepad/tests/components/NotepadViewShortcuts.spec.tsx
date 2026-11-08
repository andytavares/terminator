import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

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
  it.each(['F', 'f'])('opens search for Ctrl/⌘+Shift+%s', async (key) => {
    const user = userEvent.setup()
    render(<NotepadView />)
    await user.keyboard(`{Control>}{Shift>}{${key}}{/Shift}{/Control}`)
    expect(screen.queryByTestId('search-overlay')).not.toBeNull()
  })
})
