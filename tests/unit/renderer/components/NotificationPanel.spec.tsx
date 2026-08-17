import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useNotificationStore } from '../../../../src/renderer/stores/notification.store'
import type { SerializedNotification } from '../../../../src/renderer/electron.d'
import type { Notification } from '../../../../src/renderer/stores/notification.store'

const mockTriggerAction = vi.fn().mockResolvedValue({ ok: true })
const mockDismiss = vi.fn().mockResolvedValue({ ok: true })
const mockSetLeftInset = vi.fn()

// In jsdom, globalThis === window, so setting globalThis.electronAPI sets window.electronAPI
;(globalThis as unknown as Record<string, unknown>).electronAPI = {
  notifications: {
    dismiss: mockDismiss,
    triggerAction: mockTriggerAction,
  },
  extension: { setLeftInset: mockSetLeftInset },
}

import {
  NotificationPanel,
  BellButton,
} from '../../../../src/renderer/components/NotificationPanel'

function makeNotif(overrides: Partial<SerializedNotification> = {}): Notification {
  return {
    id: crypto.randomUUID(),
    type: 'info',
    title: 'Test notification',
    timestamp: Date.now(),
    read: false,
    ...overrides,
  }
}

function resetStore() {
  useNotificationStore.setState({ notifications: [], panelOpen: false, unreadCount: 0 })
}

describe('NotificationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing when panelOpen is false', () => {
    const { container } = render(<NotificationPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the panel when panelOpen is true', () => {
    useNotificationStore.setState({ panelOpen: true })
    render(<NotificationPanel />)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('shows empty state when no notifications', () => {
    useNotificationStore.setState({ panelOpen: true })
    render(<NotificationPanel />)
    expect(screen.getByText('No notifications')).toBeTruthy()
  })

  it('renders notification items', () => {
    const n = makeNotif({ title: 'My notification' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    expect(screen.getByText('My notification')).toBeTruthy()
  })

  it('renders notification message when provided', () => {
    const n = makeNotif({ message: 'Detailed message' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    expect(screen.getByText('Detailed message')).toBeTruthy()
  })

  it('close button calls closePanel', () => {
    useNotificationStore.setState({ panelOpen: true })
    render(<NotificationPanel />)
    const closeBtn = screen.getByTitle('Close')
    fireEvent.click(closeBtn)
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })

  it('backdrop click calls closePanel', () => {
    useNotificationStore.setState({ panelOpen: true })
    render(<NotificationPanel />)
    const backdrop = document.querySelector('.notif-backdrop')!
    fireEvent.click(backdrop)
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })

  it('ESC key closes the panel', () => {
    useNotificationStore.setState({ panelOpen: true })
    render(<NotificationPanel />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })

  it('"Mark all read" button marks all notifications as read', () => {
    const n = makeNotif()
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    const btn = screen.getByText('Mark all read')
    fireEvent.click(btn)
    expect(useNotificationStore.getState().unreadCount).toBe(0)
    expect(useNotificationStore.getState().notifications[0].read).toBe(true)
  })

  it('"Clear all" button removes all notifications', () => {
    const notifications = [makeNotif({ id: 'a' }), makeNotif({ id: 'b' })]
    useNotificationStore.setState({ notifications, panelOpen: true, unreadCount: 2 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Clear all'))
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('dismiss button removes the notification', () => {
    const n = makeNotif({ id: 'n1', title: 'Dismissable' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    const dismissBtn = screen.getByTitle('Dismiss')
    fireEvent.click(dismissBtn)
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
    expect(mockDismiss).toHaveBeenCalledWith('n1')
  })

  it('renders action buttons and calls triggerAction on click', () => {
    const n = makeNotif({
      id: 'n-action',
      actions: [{ id: 'do-it', label: 'Do it' }],
    })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    const actionBtn = screen.getByText('Do it')
    fireEvent.click(actionBtn)
    expect(mockTriggerAction).toHaveBeenCalledWith('n-action', 'do-it')
  })

  it('renders source badge when source is not "core"', () => {
    const n = makeNotif({ source: 'task-vault' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    expect(screen.getByText('task-vault')).toBeTruthy()
  })

  it('does not render source badge when source is "core"', () => {
    const n = makeNotif({ source: 'core' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    expect(screen.queryByText('core')).toBeNull()
  })

  it('renders success type icon class', () => {
    const n = makeNotif({ type: 'success' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    const { container } = render(<NotificationPanel />)
    expect(container.querySelector('.notif-item__type-icon')).toBeTruthy()
  })

  it('renders warning type icon', () => {
    const n = makeNotif({ type: 'warning' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    const { container } = render(<NotificationPanel />)
    expect(container.querySelector('.notif-item__type-icon')).toBeTruthy()
  })

  it('renders error type icon', () => {
    const n = makeNotif({ type: 'error' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    const { container } = render(<NotificationPanel />)
    expect(container.querySelector('.notif-item__type-icon')).toBeTruthy()
  })

  it('clicking a notification with onClick calls it and closes panel', () => {
    const onClick = vi.fn()
    const n = makeNotif({ onClick })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(onClick).toHaveBeenCalled()
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })

  it('clicking a notification without onClick does not close panel', () => {
    const n = makeNotif()
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(useNotificationStore.getState().panelOpen).toBe(true)
  })

  it('renders relative time: just now for fresh timestamp', () => {
    const n = makeNotif({ timestamp: Date.now() })
    useNotificationStore.setState({ notifications: [n], panelOpen: true })
    render(<NotificationPanel />)
    expect(screen.getByText('just now')).toBeTruthy()
  })

  it('renders relative time: minutes ago', () => {
    const n = makeNotif({ timestamp: Date.now() - 2 * 60 * 1000 })
    useNotificationStore.setState({ notifications: [n], panelOpen: true })
    render(<NotificationPanel />)
    expect(screen.getByText('2m ago')).toBeTruthy()
  })

  it('renders relative time: hours ago', () => {
    const n = makeNotif({ timestamp: Date.now() - 2 * 3600 * 1000 })
    useNotificationStore.setState({ notifications: [n], panelOpen: true })
    render(<NotificationPanel />)
    expect(screen.getByText('2h ago')).toBeTruthy()
  })

  it('renders relative time: days ago', () => {
    const n = makeNotif({ timestamp: Date.now() - 2 * 86400 * 1000 })
    useNotificationStore.setState({ notifications: [n], panelOpen: true })
    render(<NotificationPanel />)
    expect(screen.getByText('2d ago')).toBeTruthy()
  })
})

describe('BellButton', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders without active class when unreadCount is 0', () => {
    render(<BellButton unreadCount={0} onClick={vi.fn()} />)
    const btn = screen.getByTitle('Notifications')
    expect(btn.className).not.toContain('notif-bell--active')
    expect(btn.getAttribute('aria-label')).toBe('Notifications')
  })

  it('renders with active class and unread label when unreadCount > 0', () => {
    render(<BellButton unreadCount={3} onClick={vi.fn()} />)
    const btn = screen.getByTitle('Notifications')
    expect(btn.className).toContain('notif-bell--active')
    expect(btn.getAttribute('aria-label')).toBe('Notifications (3 unread)')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<BellButton unreadCount={0} onClick={onClick} />)
    fireEvent.click(screen.getByTitle('Notifications'))
    expect(onClick).toHaveBeenCalled()
  })
})

describe('opening the drawer without blanking what is behind it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggerAction.mockResolvedValue({ ok: true })
    resetStore()
  })
  afterEach(cleanup)

  it('reserves the strip it occupies instead of hiding the extension views', () => {
    // It used to push onto the modal store, which hides every extension
    // WebContentsView while a modal is open. That is right for a centred
    // dialog and wrong for a drawer down one edge: the whole application went
    // black to show a 340px panel.
    useNotificationStore.setState({ notifications: [], panelOpen: true, unreadCount: 0 })
    render(<NotificationPanel />)
    expect(mockSetLeftInset).toHaveBeenCalled()
    expect(mockSetLeftInset.mock.calls.at(-1)![0]).toBeGreaterThanOrEqual(0)
  })

  it('gives the strip back when it closes', () => {
    useNotificationStore.setState({ notifications: [], panelOpen: true, unreadCount: 0 })
    const { unmount } = render(<NotificationPanel />)
    mockSetLeftInset.mockClear()
    unmount()
    expect(mockSetLeftInset).toHaveBeenLastCalledWith(0)
  })
})

describe('taking you to the thing a notification is about', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggerAction.mockResolvedValue({ ok: true })
    resetStore()
  })
  afterEach(cleanup)

  it('asks main for the destination when only main knows it', async () => {
    // An extension's notification carries a handler that lives in the main
    // process — a function cannot cross IPC — so the row asks for it by name.
    const n = makeNotif({ clickable: true })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(mockTriggerAction).toHaveBeenCalledWith(n.id, '__open__')
  })

  it('prefers a local handler, for a notification raised in this renderer', () => {
    const onClick = vi.fn()
    const n = { ...makeNotif(), onClick }
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(onClick).toHaveBeenCalled()
    expect(mockTriggerAction).not.toHaveBeenCalled()
  })

  it('does nothing for a bare report, which is a link to nowhere', () => {
    const n = makeNotif()
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(mockTriggerAction).not.toHaveBeenCalled()
  })

  it('closes the drawer on the way, so it does not cover where you landed', async () => {
    const n = makeNotif({ clickable: true })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })
})

describe('acting on a notification settles it', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggerAction.mockResolvedValue({ ok: true })
    resetStore()
  })
  afterEach(cleanup)

  it('takes the row away once its action has fired', async () => {
    // Approve a phase and the request to approve that phase should not still be
    // sitting in the list.
    const n = makeNotif({ actions: [{ id: 'approve', label: 'Approve' }] })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Approve'))
    await vi.waitFor(() => expect(useNotificationStore.getState().notifications).toHaveLength(0))
  })

  it('does not ask main to forget an id it has already forgotten', async () => {
    const n = makeNotif({ actions: [{ id: 'approve', label: 'Approve' }] })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Approve'))
    await vi.waitFor(() => expect(useNotificationStore.getState().notifications).toHaveLength(0))
    expect(mockDismiss).not.toHaveBeenCalled()
  })

  it('still takes the row away when main says it was already answered', async () => {
    // The same decision made somewhere else — the extension's own UI, most
    // likely. Still not something to keep showing.
    mockTriggerAction.mockResolvedValueOnce({ error: 'UNKNOWN_NOTIFICATION' })
    const n = makeNotif({ actions: [{ id: 'approve', label: 'Approve' }] })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Approve'))
    await vi.waitFor(() => expect(useNotificationStore.getState().notifications).toHaveLength(0))
  })
})
