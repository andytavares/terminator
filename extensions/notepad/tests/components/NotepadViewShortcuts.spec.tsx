import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { installNotepadBridge } from './helpers/note-surface'

vi.mock('../../src/components/SearchOverlay', () => ({
  SearchOverlay: () => <div data-testid="search-overlay" />,
}))

import { NotepadView } from '../../src/components/NotepadView'

beforeEach(() => {
  installNotepadBridge()
})

afterEach(() => cleanup())

describe('NotepadView search shortcut', () => {
  // With Shift held, the key a browser reports is the capital letter wherever
  // Control is the modifier (Linux, Windows), and the small one under ⌘.
  it.each(['F', 'f'])('opens search for Ctrl/⌘+Shift+%s', async (key) => {
    const user = userEvent.setup()
    render(<NotepadView />)
    await user.keyboard(`{Control>}{Shift>}{${key}}{/Shift}{/Control}`)
    expect(screen.getByTestId('search-overlay')).toBeTruthy()
  })
})
