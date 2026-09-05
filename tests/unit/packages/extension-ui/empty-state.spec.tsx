import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FileText } from 'lucide-react'
import { EmptyState } from '../../../../packages/extension-ui/src/EmptyState'
import { IconButton } from '../../../../packages/extension-ui/src/IconButton'
import { Toast, ToastRegion } from '../../../../packages/extension-ui/src/Toast'

const noop = (): void => {}

// Notepad's empty state, promoted to the house pattern. The others said
// "No backlog items.", "Nothing is running." and "No staged changes" in grey
// italic and offered nothing — a statement of absence where an invitation
// belongs.

describe('EmptyState', () => {
  const base = {
    heading: 'No notes yet',
    description: 'Capture your first note from anywhere in Terminator.',
    actions: [{ label: 'New note', onSelect: noop }] as const,
  }

  it('states the situation as a heading', () => {
    render(<EmptyState {...base} />)
    expect(screen.getByRole('heading', { name: 'No notes yet' })).toBeTruthy()
  })

  it('explains what the region is for', () => {
    render(<EmptyState {...base} />)
    expect(screen.getByText(base.description)).toBeTruthy()
  })

  // FR-026: an empty state without an action is the thing being replaced.
  it('always offers at least one action', () => {
    render(<EmptyState {...base} />)
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(1)
  })

  it('invokes the action', () => {
    const onSelect = vi.fn()
    render(<EmptyState {...base} actions={[{ label: 'New note', onSelect }]} />)
    fireEvent.click(screen.getByRole('button', { name: /New note/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('renders a secondary action beside the primary', () => {
    render(
      <EmptyState
        {...base}
        actions={[
          { label: 'New note', tone: 'primary', onSelect: noop },
          { label: 'Import a folder…', onSelect: noop },
        ]}
      />
    )
    expect(screen.getByRole('button', { name: /New note/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Import a folder…/ })).toBeTruthy()
  })

  it('shows the shortcut on the action that carries one', () => {
    render(
      <EmptyState {...base} actions={[{ label: 'New note', onSelect: noop, shortcut: '⌘⇧N' }]} />
    )
    expect(screen.getByText('⌘⇧N')).toBeTruthy()
  })

  it('shows a hint when given one', () => {
    render(<EmptyState {...base} hint={<span>Press ⌘⇧N anytime.</span>} />)
    expect(screen.getByText('Press ⌘⇧N anytime.')).toBeTruthy()
  })

  it('renders an icon flat, with no colour of its own', () => {
    const { container } = render(<EmptyState {...base} icon={FileText} />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    // Principle XII: icons inherit currentColor and are sized by CSS.
    expect(svg!.getAttribute('color')).toBeNull()
    expect(svg!.style.color).toBe('')
  })
})

describe('IconButton', () => {
  // The extensions labelled icon controls with `title` only, so Task Vault's
  // list/kanban/calendar/settings toggles had no accessible name at all. Here
  // the label is a required prop — the omission is unrepresentable.
  it('takes its accessible name from the required label', () => {
    render(<IconButton icon={FileText} label="List view" onClick={noop} />)
    expect(screen.getByRole('button', { name: 'List view' })).toBeTruthy()
  })

  it('also exposes the label as a tooltip', () => {
    render(<IconButton icon={FileText} label="List view" onClick={noop} />)
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('title')).toBe(
      'List view'
    )
  })

  it('reports its pressed state', () => {
    render(<IconButton icon={FileText} label="List view" pressed onClick={noop} />)
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('invokes its handler', () => {
    const onClick = vi.fn()
    render(<IconButton icon={FileText} label="List view" onClick={onClick} />)
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('sizes the icon by CSS rather than by a size prop', () => {
    const { container } = render(<IconButton icon={FileText} label="List view" onClick={noop} />)
    const svg = container.querySelector('svg')!
    // Principle XII forbids the size prop; lucide's default 24 stays and CSS
    // decides what is drawn.
    expect(svg.getAttribute('width')).toBe('24')
  })
})

describe('Toast', () => {
  it('shows its message', () => {
    render(<Toast message="Published" onDismiss={noop} />)
    expect(screen.getByText('Published')).toBeTruthy()
  })

  it('announces politely without stealing focus', () => {
    const before = document.activeElement
    render(<Toast message="Published" onDismiss={noop} />)
    expect(screen.getByRole('status')).toBeTruthy()
    expect(document.activeElement).toBe(before)
  })

  it('carries its tone as data rather than as colour alone', () => {
    render(<Toast message="Could not reach the server" tone="error" onDismiss={noop} />)
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('error')
  })

  it('can be dismissed', () => {
    const onDismiss = vi.fn()
    render(<Toast message="Published" onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when the region is empty', () => {
    const { container } = render(<ToastRegion toasts={[]} onDismiss={noop} />)
    expect(container.querySelector('.tmui-toast')).toBeNull()
  })

  it('renders every queued toast', () => {
    render(
      <ToastRegion
        toasts={[
          { id: '1', message: 'Saved' },
          { id: '2', message: 'Published' },
        ]}
        onDismiss={noop}
      />
    )
    expect(screen.getByText('Saved')).toBeTruthy()
    expect(screen.getByText('Published')).toBeTruthy()
  })
})
