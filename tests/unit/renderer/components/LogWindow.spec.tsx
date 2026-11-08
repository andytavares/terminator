import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useLogStore } from '../../../../src/renderer/stores/log.store'
import { LogWindow } from '../../../../src/renderer/components/LogWindow'

// happy-dom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn()

beforeEach(() => {
  useLogStore.setState({ entries: [] })
})

describe('LogWindow', () => {
  it('is a named region of the window, not a dialog: the app stays usable beside it', () => {
    render(<LogWindow onClose={vi.fn()} />)
    expect(screen.getByRole('region', { name: 'Application Logs' })).toBeTruthy()
    expect(screen.getByText('Application Logs')).toBeTruthy()
  })

  it('shows empty state when no entries', () => {
    render(<LogWindow onClose={vi.fn()} />)
    expect(screen.getByText('No log entries yet.')).toBeTruthy()
  })

  it.each([
    ['info', 'INFO'],
    ['warn', 'WARN'],
    ['error', 'ERR'],
    ['log', 'LOG'],
  ] as const)('renders a %s entry with its message and the label %s', (level, label) => {
    useLogStore.setState({
      entries: [{ id: 1, level, message: 'started up', timestamp: '12:00:00' }],
    })
    render(<LogWindow onClose={vi.fn()} />)
    expect(screen.getByText('started up')).toBeTruthy()
    expect(screen.getByText(label)).toBeTruthy()
  })
})

describe('LogWindow — empties the log when Clear is clicked', () => {
  it('empties the log when Clear is clicked', () => {
    useLogStore.setState({
      entries: [{ id: 1, level: 'info', message: 'started up', timestamp: '12:00:00' }],
    })
    render(<LogWindow onClose={vi.fn()} />)
    fireEvent.click(screen.getByText('Clear'))
    expect(screen.queryByText('started up')).toBeNull()
    expect(screen.getByText('No log entries yet.')).toBeTruthy()
  })

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn()
    render(<LogWindow onClose={onClose} />)
    fireEvent.click(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn()
    render(<LogWindow onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
