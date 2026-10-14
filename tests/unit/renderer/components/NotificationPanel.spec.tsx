import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useNotificationStore } from '../../../../src/renderer/stores/notification.store'
import type { Notification } from '../../../../src/renderer/stores/notification.store'

const mockTriggerAction = vi.fn().mockResolvedValue({ ok: true })
const mockDismiss = vi.fn().mockResolvedValue({ ok: true })
const mockSetLeftInset = vi.fn()

// In jsdom, globalThis === window, so setting globalThis.electronAPI sets window.electronAPI
installElectronApi({
  notifications: {
    dismiss: mockDismiss,
    triggerAction: mockTriggerAction,
  },
  extension: { setLeftInset: mockSetLeftInset },
})

import { NotificationPanel } from '../../../../src/renderer/components/NotificationPanel'
import { installElectronApi } from '../../../support/electron-api'

function makeNotif(overrides: Partial<Notification> = {}): Notification {
  return {
    id: crypto.randomUUID(),
    type: 'info',
    title: 'Test notification',
    timestamp: Date.now(),
    targets: ['center'],
    read: false,
    ...overrides,
  }
}

function resetStore() {
  useNotificationStore.setState({ notifications: [], panelOpen: false, unreadCount: 0 })
}

/** The hooks every "NotificationPanel" describe registers. */
function setUpNotificationPanel(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  afterEach(() => {
    cleanup()
  })
}

describe('NotificationPanel', () => {
  setUpNotificationPanel()

  it('renders nothing when panelOpen is false', () => {
    const { container } = render(<NotificationPanel />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the panel, a named region beside the app, when panelOpen is true', () => {
    useNotificationStore.setState({ panelOpen: true })
    render(<NotificationPanel />)
    expect(screen.getByRole('region', { name: 'Notifications' })).toBeTruthy()
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
})

describe('NotificationPanel — close button calls closePanel', () => {
  setUpNotificationPanel()

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
})

describe('NotificationPanel — "Mark all read" button marks all notifications as read', () => {
  setUpNotificationPanel()

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
})

describe('NotificationPanel — renders action buttons and calls triggerAction on click', () => {
  setUpNotificationPanel()

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
})

describe('NotificationPanel — draws each type as its own shape', () => {
  setUpNotificationPanel()

  it('draws each type as its own shape', () => {
    useNotificationStore.setState({
      notifications: (['info', 'success', 'warning', 'error'] as const).map((type) =>
        makeNotif({ id: type, type })
      ),
      panelOpen: true,
      unreadCount: 4,
    })
    const { container } = render(<NotificationPanel />)
    const shapes = [...container.querySelectorAll('.notif-item__type-icon')].map((icon) =>
      icon.getAttribute('class')
    )
    expect(shapes).toHaveLength(4)
    expect(new Set(shapes).size).toBe(4)
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
})

describe('NotificationPanel — clicking a notification without onClick does not close panel', () => {
  setUpNotificationPanel()

  it('clicking a notification without onClick does not close panel', () => {
    const n = makeNotif()
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(useNotificationStore.getState().panelOpen).toBe(true)
  })

  it('says how long ago it happened, keeping the exact moment', () => {
    const timestamp = Date.now() - 2 * 60 * 1000
    useNotificationStore.setState({
      notifications: [makeNotif({ timestamp })],
      panelOpen: true,
    })
    render(<NotificationPanel />)
    const time = screen.getByText('2 minutes ago')
    expect(time.getAttribute('datetime')).toBe(new Date(timestamp).toISOString())
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
    // jsdom lays nothing out; the drawer's right edge is what a browser would measure.
    const measure = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(new DOMRect(0, 0, 339.5, 800))
    useNotificationStore.setState({ notifications: [], panelOpen: true, unreadCount: 0 })
    render(<NotificationPanel />)
    measure.mockRestore()
    expect(mockSetLeftInset).toHaveBeenLastCalledWith(340)
  })

  it('gives the strip back when it closes', () => {
    useNotificationStore.setState({ notifications: [], panelOpen: true, unreadCount: 0 })
    const { unmount } = render(<NotificationPanel />)
    mockSetLeftInset.mockClear()
    unmount()
    expect(mockSetLeftInset).toHaveBeenLastCalledWith(0)
  })
})

/** The hooks every "taking you to the thing a notification is about" describe registers. */
function setUpTakingYouToThe(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggerAction.mockResolvedValue({ ok: true })
    resetStore()
  })
  afterEach(cleanup)
}

describe('taking you to the thing a notification is about', () => {
  setUpTakingYouToThe()

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
})

describe('taking you to the thing a notification is about — closes the drawer on the way, so it does not cover where you landed', () => {
  setUpTakingYouToThe()

  it('closes the drawer on the way, so it does not cover where you landed', async () => {
    const n = makeNotif({ clickable: true })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    fireEvent.click(screen.getByText('Test notification'))
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })
})

/** The hooks every "acting on a notification settles it" describe registers. */
function setUpActingOnANotification(): void {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTriggerAction.mockResolvedValue({ ok: true })
    resetStore()
  })
  afterEach(cleanup)
}

describe('acting on a notification settles it', () => {
  setUpActingOnANotification()

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
