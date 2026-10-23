import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { eventually } from '../../../../tests/support/eventually'

// Mock the toast store before importing notify
vi.mock('../../src/stores/extension-toast.store', () => ({
  addExtensionToast: vi.fn(),
}))

const mockCreate = vi.fn().mockResolvedValue({ id: 'notif-1' })

Object.defineProperty(globalThis, 'window', {
  value: {
    electronAPI: {
      notifications: { create: mockCreate },
    },
  },
  writable: true,
  configurable: true,
})

import { notify, toastPushed } from '../../src/utils/notify'
import { addExtensionToast } from '../../src/stores/extension-toast.store'

const mockAddToast = vi.mocked(addExtensionToast)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('notify', notifyTests)

function notifyTests() {
  describe('local toasts', notifyLocalToastsTests)
  describe('pushes the vault leaves alone', ignoredPushTests)
  describe('dispatcher', notifyDispatcherTests)
}

/** The push the dispatcher sends back for a task-vault notification that reaches a toast. */
function pushed(title: string, targets: string[] = ['toast']) {
  return { title, type: 'info' as const, source: 'terminator.task-vault', targets }
}

function notifyLocalToastsTests() {
  it('draws no toast of its own: the push it causes draws the one toast', () => {
    notify('success', 'Task done', 'taskCompleted')
    expect(mockAddToast).not.toHaveBeenCalled()
    toastPushed(pushed('Task done'))
    expect(mockAddToast).toHaveBeenCalledTimes(1)
    expect(mockAddToast).toHaveBeenCalledWith('info', 'Task done', { onClick: undefined })
  })

  it('gives the pushed toast the click handler notify was given', () => {
    const onClick = vi.fn()
    notify('info', 'Moved to backlog: test', { key: 'taskMovedToBacklog', onClick })
    toastPushed(pushed('Moved to backlog: test'))
    expect(mockAddToast).toHaveBeenCalledWith('info', 'Moved to backlog: test', { onClick })
  })

  it('forgets the click handler once the dispatcher has answered', async () => {
    const onClick = vi.fn()
    notify('info', 'Archived: test', { key: 'taskArchived', onClick })
    await mockCreate.mock.results[0].value
    await eventually(() => {
      toastPushed(pushed('Archived: test'))
      expect(mockAddToast).toHaveBeenLastCalledWith('info', 'Archived: test', {
        onClick: undefined,
      })
    })
  })

  it('does not throw when called without options', () => {
    expect(() => notify('error', 'Oops', 'testKey')).not.toThrow()
  })
}

function ignoredPushTests() {
  it("draws nothing for a push the user's settings keep out of toasts", () => {
    toastPushed(pushed('Task done', ['center']))
    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it("draws nothing for another extension's push", () => {
    toastPushed({ ...pushed('Build finished'), source: 'terminator.git-integration' })
    expect(mockAddToast).not.toHaveBeenCalled()
  })
}

function notifyDispatcherTests() {
  it('routes through the shared dispatcher tagged with this extension source and key', () => {
    notify('warning', 'Task overdue', 'dueTaskReminder')
    expect(mockCreate).toHaveBeenCalledWith({
      type: 'warning',
      title: 'Task overdue',
      source: 'terminator.task-vault',
      key: 'dueTaskReminder',
    })
  })

  it('does not throw when electronAPI.notifications is unavailable', () => {
    const orig = window.electronAPI
    Object.assign(window, { electronAPI: undefined })
    expect(() => notify('info', 'Oops', 'testKey')).not.toThrow()
    Object.assign(window, { electronAPI: orig })
  })
}
