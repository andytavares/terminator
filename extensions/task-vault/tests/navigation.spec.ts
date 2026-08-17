import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openInVault, popPendingNavigation } from '../src/navigation.js'
import type { ExtensionAPI } from '../../../src/main/extensions/api.js'

// Three callers want to take you to a task — the calendar drawer, a due-task
// notification, a blocked-task check-in — and until this only the first worked.
// The notifications broadcast `task-vault:navigate-task`, a channel with no
// listener anywhere in the extension.

function api(): ExtensionAPI {
  return {
    window: { focusSelf: vi.fn(), broadcast: vi.fn() },
  } as unknown as ExtensionAPI
}

const calls = (a: ExtensionAPI): unknown[][] =>
  (a.window.broadcast as unknown as ReturnType<typeof vi.fn>).mock.calls

beforeEach(() => {
  // Drain anything a previous test left held.
  popPendingNavigation()
})

describe('taking someone to a task', () => {
  it('brings the window forward first', () => {
    // Navigation that changes what is on screen behind another window has done
    // nothing you can see.
    const a = api()
    openInVault(a, { taskId: 't-1' })
    expect(a.window.focusSelf).toHaveBeenCalled()
  })

  it('opens the vault before saying where to go', () => {
    // The view is created when the tab is activated, so the order is the whole
    // mechanism rather than a preference.
    const a = api()
    openInVault(a, { taskId: 't-1' })
    expect(calls(a)[0]).toEqual(['extension:activate-global-tab', 'terminator.task-vault'])
    expect(calls(a)[1][0]).toBe('task-vault:navigate')
  })

  it('carries the task, and the day it belongs to', () => {
    const a = api()
    openInVault(a, { taskId: 't-1', date: '2026-05-21' })
    expect(calls(a)[1][1]).toMatchObject({ taskId: 't-1', date: '2026-05-21' })
  })

  it('carries the view, for a destination that is not a task at all', () => {
    // The weekly-review nudge, whose whole content is "go to the review".
    const a = api()
    openInVault(a, { view: 'review' })
    expect(calls(a)[1][1]).toMatchObject({ view: 'review' })
  })

  it('just opens the vault when asked for nowhere in particular', () => {
    const a = api()
    openInVault(a)
    expect(calls(a)).toHaveLength(1)
    expect(popPendingNavigation()).toBeNull()
  })
})

describe('a view that did not exist to hear it', () => {
  it('holds the destination for a view that mounts a moment later', () => {
    // Navigating from outside the vault is routinely a broadcast to nobody:
    // the WebContentsView is built milliseconds after the tab is activated.
    openInVault(api(), { taskId: 't-1', date: '2026-05-21' })
    expect(popPendingNavigation()).toMatchObject({ taskId: 't-1', date: '2026-05-21' })
  })

  it('hands it over exactly once', () => {
    // Replayed on every later mount, it would drag you back to a task you
    // finished with an hour ago.
    openInVault(api(), { taskId: 't-1' })
    popPendingNavigation()
    expect(popPendingNavigation()).toBeNull()
  })

  it('keeps only the most recent request', () => {
    openInVault(api(), { taskId: 't-1' })
    openInVault(api(), { taskId: 't-2' })
    expect(popPendingNavigation()).toMatchObject({ taskId: 't-2' })
  })

  it('holds nothing for a bare "open the vault"', () => {
    openInVault(api())
    expect(popPendingNavigation()).toBeNull()
  })
})
