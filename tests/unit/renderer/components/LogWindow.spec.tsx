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
  it('renders dialog with title', () => {
    render(<LogWindow onClose={vi.fn()} />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Application Logs')).toBeTruthy()
  })

  it('shows empty state when no entries', () => {
    render(<LogWindow onClose={vi.fn()} />)
    expect(screen.getByText('No log entries yet.')).toBeTruthy()
  })

  it('renders log entries with level and message', () => {
    useLogStore.setState({
      entries: [
        { id: 1, level: 'info', message: 'started up', timestamp: '12:00:00' },
        { id: 2, level: 'error', message: 'something failed', timestamp: '12:00:01' },
      ],
    })
    render(<LogWindow onClose={vi.fn()} />)
    expect(screen.getByText('started up')).toBeTruthy()
    expect(screen.getByText('something failed')).toBeTruthy()
    expect(screen.getByText(/^INFO$/)).toBeTruthy()
    expect(screen.getByText(/^ERR/)).toBeTruthy()
  })

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

  it('renders warn and log level labels', () => {
    useLogStore.setState({
      entries: [
        { id: 1, level: 'warn', message: 'watch out', timestamp: '12:00:00' },
        { id: 2, level: 'log', message: 'debug info', timestamp: '12:00:01' },
      ],
    })
    render(<LogWindow onClose={vi.fn()} />)
    expect(screen.getByText(/^WARN$/)).toBeTruthy()
    expect(screen.getByText(/^LOG/)).toBeTruthy()
  })
})
