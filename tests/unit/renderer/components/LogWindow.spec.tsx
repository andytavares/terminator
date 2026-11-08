import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  it('empties the log when Clear is clicked', async () => {
    const user = userEvent.setup()
    useLogStore.setState({
      entries: [{ id: 1, level: 'info', message: 'started up', timestamp: '12:00:00' }],
    })
    render(<LogWindow onClose={vi.fn()} />)
    await user.click(screen.getByText('Clear'))
    expect(screen.queryByText('started up')).toBeNull()
    expect(screen.getByText('No log entries yet.')).toBeTruthy()
  })

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<LogWindow onClose={onClose} />)
    await user.click(screen.getByText('✕'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<LogWindow onClose={onClose} />)
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
