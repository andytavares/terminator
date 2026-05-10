import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React from 'react'
import { EmptyState } from '../../src/renderer/components/EmptyState'

describe('EmptyState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders title', () => {
    render(<EmptyState title="Welcome to Terminator" />)
    expect(screen.getByText('Welcome to Terminator')).toBeTruthy()
  })

  it('renders icon when provided', () => {
    render(<EmptyState title="Test" icon="⬡" />)
    expect(screen.getByText('⬡')).toBeTruthy()
  })

  it('renders subtitle when provided', () => {
    render(<EmptyState title="Test" subtitle="Select a project to get started" />)
    expect(screen.getByText('Select a project to get started')).toBeTruthy()
  })

  it('renders action buttons', () => {
    const onClick = vi.fn()
    render(<EmptyState title="Welcome" actions={[{ label: 'New Tab', onClick }]} />)
    expect(screen.getByRole('button', { name: 'New Tab' })).toBeTruthy()
  })

  it('calls onClick when action button clicked', () => {
    const onClick = vi.fn()
    render(<EmptyState title="Welcome" actions={[{ label: 'Open Settings', onClick }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Settings' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('renders keyboard shortcut label when provided', () => {
    render(
      <EmptyState
        title="Welcome"
        actions={[{ label: 'New Tab', shortcut: '⌘T', onClick: vi.fn() }]}
      />
    )
    expect(screen.getByText('⌘T')).toBeTruthy()
  })

  it('renders nothing for icon when not provided', () => {
    const { container } = render(<EmptyState title="Test" />)
    expect(container.querySelector('.empty-state__icon')).toBeNull()
  })
})
