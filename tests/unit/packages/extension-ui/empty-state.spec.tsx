import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FileText } from 'lucide-react'
import { EmptyState } from '../../../../packages/extension-ui/src/EmptyState'
import { IconButton } from '../../../../packages/extension-ui/src/IconButton'
import { Toast, ToastRegion } from '../../../../packages/extension-ui/src/Toast'

const noop = (): void => {}

// Notepad's empty state, promoted to the house pattern. The others said
// "No backlog items.", "Nothing is running." and "No staged changes" in grey
// italic and offered nothing — a statement of absence where an invitation
// belongs.

const base = {
  heading: 'No notes yet',
  description: 'Capture your first note from anywhere in Terminator.',
  actions: [{ label: 'New note', onSelect: noop }] as const,
}

describe('EmptyState', () => {
  it('states the situation as a heading', () => {
    render(<EmptyState {...base} />)
    expect(screen.getByRole('heading').textContent).toBe('No notes yet')
  })

  it('explains what the region is for', () => {
    render(<EmptyState {...base} />)
    expect(document.body.textContent).toContain(base.description)
  })

  // FR-026: an empty state without an action is the thing being replaced.
  it('always offers at least one action', () => {
    render(<EmptyState {...base} />)
    expect(screen.getAllByRole('button').length).toBeGreaterThanOrEqual(1)
  })

  it('invokes the action', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<EmptyState {...base} actions={[{ label: 'New note', onSelect }]} />)
    await user.click(screen.getByRole('button', { name: /New note/ }))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('EmptyState — renders a secondary action beside the primary', () => {
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
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'New note',
      'Import a folder…',
    ])
  })

  it('shows the shortcut on the action that carries one', () => {
    render(
      <EmptyState {...base} actions={[{ label: 'New note', onSelect: noop, shortcut: '⌘⇧N' }]} />
    )
    expect(screen.getByRole('button', { name: /New note/ }).textContent).toBe('New note⌘⇧N')
  })

  it('shows a hint when given one', () => {
    render(<EmptyState {...base} hint={<span>Press ⌘⇧N anytime.</span>} />)
    expect(document.body.textContent).toContain('Press ⌘⇧N anytime.')
  })
})

describe('EmptyState — renders an icon flat, with no colour of its own', () => {
  it('renders an icon flat, with no colour of its own', () => {
    const { container } = render(<EmptyState {...base} icon={FileText} />)
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    // Principle XII: icons inherit currentColor and are sized by CSS.
    expect(svgs[0].getAttribute('color')).toBeNull()
    expect(svgs[0].style.color).toBe('')
  })
})

describe('IconButton', () => {
  // The extensions labelled icon controls with `title` only, so Task Vault's
  // list/kanban/calendar/settings toggles had no accessible name at all. Here
  // the label is a required prop — the omission is unrepresentable.
  it('takes its accessible name from the required label', () => {
    render(<IconButton icon={FileText} label="List view" onClick={noop} />)
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('List view')
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

  it('invokes its handler', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<IconButton icon={FileText} label="List view" onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: 'List view' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('IconButton — hands its handler the click, so a control inside a clickable row can keep the click', () => {
  it('hands its handler the click, so a control inside a clickable row can keep the click', async () => {
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(
      <div onClick={onRowClick}>
        <IconButton
          icon={FileText}
          label="Delete comment"
          onClick={(event) => event.stopPropagation()}
        />
      </div>
    )
    await user.click(screen.getByRole('button', { name: 'Delete comment' }))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('does nothing while disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<IconButton icon={FileText} label="Send" disabled onClick={onClick} />)
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('carries the state attributes of a disclosure', () => {
    render(<IconButton icon={FileText} label="Collapse folder" aria-expanded onClick={noop} />)
    expect(
      screen.getByRole('button', { name: 'Collapse folder' }).getAttribute('aria-expanded')
    ).toBe('true')
  })
})

describe('IconButton — comes in a small size for dense rows and chips', () => {
  it('comes in a small size for dense rows and chips', () => {
    render(<IconButton icon={FileText} label="Remove tag" size="sm" onClick={noop} />)
    expect(screen.getByRole('button', { name: 'Remove tag' }).className).toContain(
      'tmui-icon-button--sm'
    )
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
    expect(screen.getByRole('status').textContent).toContain('Published')
  })

  it('carries its tone as data rather than as colour alone', () => {
    render(<Toast message="Could not reach the server" tone="error" onDismiss={noop} />)
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('error')
  })

  it('can be dismissed', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<Toast message="Published" onDismiss={onDismiss} />)
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('Toast — renders every queued toast', () => {
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
    expect(screen.getAllByRole('status').map((toast) => toast.textContent)).toEqual([
      expect.stringContaining('Saved'),
      expect.stringContaining('Published'),
    ])
  })
})
