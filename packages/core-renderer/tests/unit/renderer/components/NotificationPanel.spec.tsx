import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useNotificationStore } from '../../../../src/stores/notification.store'
import type { Notification } from '../../../../src/stores/notification.store'

const mockTriggerAction = vi.fn()
const mockDismiss = vi.fn()

// Per test: vitest.config.ts unstubs globals and resets mocks after each one.
beforeEach(() => {
  mockTriggerAction.mockResolvedValue({ ok: true })
  mockDismiss.mockResolvedValue({ ok: true })
  installElectronApi({
    notifications: {
      dismiss: mockDismiss,
      triggerAction: mockTriggerAction,
    },
  })
})

import { NotificationPanel } from '../../../../src/components/NotificationPanel'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import { eventually } from '../../../../../test-support/src/eventually'

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

const recordUse = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/usage/record', () => ({ recordUse }))

describe('NotificationPanel', () => {
  setUpNotificationPanel()

  it('renders nothing when panelOpen is false', () => {
    const { container } = render(<NotificationPanel />)
    expect(container.innerHTML).toBe('')
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

type User = ReturnType<typeof userEvent.setup>

describe('NotificationPanel — closing', () => {
  setUpNotificationPanel()

  it.each([
    ['the close button', (user: User) => user.click(screen.getByTitle('Close'))],
    // eslint-disable-next-line testing-library/no-node-access -- the backdrop is a bare div with no role, label or text
    ['a backdrop click', (user: User) => user.click(document.querySelector('.notif-backdrop')!)],
    ['Escape', (user: User) => user.keyboard('{Escape}')],
  ])('closes the panel on %s', async (_case, close) => {
    const user = userEvent.setup()
    useNotificationStore.setState({ panelOpen: true })
    render(<NotificationPanel />)
    await close(user)
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })
})

describe('NotificationPanel — "Mark all read" button marks all notifications as read', () => {
  setUpNotificationPanel()

  it('"Mark all read" button marks all notifications as read', async () => {
    const n = makeNotif()
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    const btn = screen.getByText('Mark all read')
    await userEvent.click(btn)
    expect(useNotificationStore.getState().unreadCount).toBe(0)
    expect(useNotificationStore.getState().notifications[0].read).toBe(true)
  })

  it('"Clear all" button removes all notifications', async () => {
    const notifications = [makeNotif({ id: 'a' }), makeNotif({ id: 'b' })]
    useNotificationStore.setState({ notifications, panelOpen: true, unreadCount: 2 })
    render(<NotificationPanel />)
    await userEvent.click(screen.getByText('Clear all'))
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
  })

  it('dismiss button removes the notification', async () => {
    const n = makeNotif({ id: 'n1', title: 'Dismissable' })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    const dismissBtn = screen.getByTitle('Dismiss')
    await userEvent.click(dismissBtn)
    expect(useNotificationStore.getState().notifications).toHaveLength(0)
    expect(mockDismiss).toHaveBeenCalledWith('n1')
  })
})

describe('NotificationPanel — source badge', () => {
  setUpNotificationPanel()

  it.each([
    ['task-vault', 1],
    ['core', 0],
  ])('draws a source badge for source "%s" %i time(s)', (source, badges) => {
    const n = makeNotif({ source })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    expect(screen.queryAllByText(source)).toHaveLength(badges)
  })
})

describe('NotificationPanel — action buttons come from the design system', () => {
  setUpNotificationPanel()

  it('draws each action as a design-system button that runs it and settles the row', async () => {
    const user = userEvent.setup()
    const n = makeNotif({ id: 'n-alert', actions: [{ id: 'action-0', label: 'Open PR' }] })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    const button = screen.getByRole('button', { name: 'Open PR' })
    expect(button.classList).toContain('tmui-button')
    await user.click(button)
    expect(mockTriggerAction).toHaveBeenCalledWith('n-alert', 'action-0')
    await eventually(() => expect(useNotificationStore.getState().notifications).toHaveLength(0))
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
    render(<NotificationPanel />)
    const icons = screen.getAllByRole('img', { name: /^(Info|Success|Warning|Error)$/ })
    expect(icons.map((icon) => icon.getAttribute('aria-label'))).toEqual([
      'Info',
      'Success',
      'Warning',
      'Error',
    ])
    const shapes = icons.map((icon) => icon.getAttribute('class'))
    expect(new Set(shapes).size).toBe(4)
  })
})

describe('NotificationPanel — says when it happened', () => {
  setUpNotificationPanel()

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
    await userEvent.click(screen.getByText('Test notification'))
    expect(mockTriggerAction).toHaveBeenCalledWith(n.id, '__open__')
  })

  it('prefers a local handler, for a notification raised in this renderer, and closes the panel', async () => {
    const onClick = vi.fn()
    const n = { ...makeNotif(), onClick }
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    await userEvent.click(screen.getByText('Test notification'))
    expect(onClick).toHaveBeenCalled()
    expect(mockTriggerAction).not.toHaveBeenCalled()
    expect(useNotificationStore.getState().panelOpen).toBe(false)
  })

  it('does nothing for a bare report, which is a link to nowhere, and keeps the panel open', async () => {
    const n = makeNotif()
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    await userEvent.click(screen.getByText('Test notification'))
    expect(mockTriggerAction).not.toHaveBeenCalled()
    expect(useNotificationStore.getState().panelOpen).toBe(true)
  })
})

describe('taking you to the thing a notification is about — closes the drawer on the way, so it does not cover where you landed', () => {
  setUpTakingYouToThe()

  it('closes the drawer on the way, so it does not cover where you landed', async () => {
    const user = userEvent.setup()
    const n = makeNotif({ clickable: true })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    await user.click(screen.getByText('Test notification'))
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

  it('does not ask main to forget an id it has already forgotten', async () => {
    const user = userEvent.setup()
    const n = makeNotif({ actions: [{ id: 'approve', label: 'Approve' }] })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    await user.click(screen.getByText('Approve'))
    await eventually(() => expect(useNotificationStore.getState().notifications).toHaveLength(0))
    expect(mockDismiss).not.toHaveBeenCalled()
  })

  it('still takes the row away when main says it was already answered', async () => {
    const user = userEvent.setup()
    // The same decision made somewhere else — the extension's own UI, most
    // likely. Still not something to keep showing.
    mockTriggerAction.mockResolvedValueOnce({ error: 'UNKNOWN_NOTIFICATION' })
    const n = makeNotif({ actions: [{ id: 'approve', label: 'Approve' }] })
    useNotificationStore.setState({ notifications: [n], panelOpen: true, unreadCount: 1 })
    render(<NotificationPanel />)
    await user.click(screen.getByText('Approve'))
    await eventually(() => expect(useNotificationStore.getState().notifications).toHaveLength(0))
  })
})
