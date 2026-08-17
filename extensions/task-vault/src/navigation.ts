import type { ExtensionAPI } from '../../../src/main/extensions/api.js'

// Taking someone to a task, from wherever they asked.
//
// Three callers want this — the calendar drawer, a due-task notification, a
// blocked-task check-in — and until now only the first one worked. The
// notifications broadcast `task-vault:navigate-task`, a channel with no
// listener anywhere in the extension, so "Open Vault" opened nothing and went
// nowhere. This is the path that does work, in one place so the next caller
// cannot invent a fourth channel.

/** Where the vault's own UI lives, as the host's tab registry names it. */
const GLOBAL_TAB_ID = 'terminator.task-vault'

/**
 * Held for a view that does not exist yet.
 *
 * The vault renders in a `WebContentsView` created when its tab is first
 * activated. Navigating from outside it — a notification, the calendar — is
 * therefore routinely a broadcast to nobody: the view is built milliseconds
 * later and never hears it. It reads this on mount instead.
 */
let pending: VaultDestination | null = null

export interface VaultDestination {
  date?: string
  taskId?: string
  /**
   * Which of the vault's views to land on.
   *
   * Absent means "wherever it already was", which is right for a task — the
   * task itself decides the view. It is not right for the weekly-review nudge,
   * whose whole content is "go to the review": without this it opened the
   * vault on today's log and left you to find it.
   */
  view?: 'daily' | 'review'
}

/**
 * Brings the window forward, opens the vault, and says where to go.
 *
 * In that order, and all three: focusing without activating the tab lands on
 * whatever was last on screen, and activating without saying where leaves you
 * looking at today rather than at the task the notification was about.
 */
export function openInVault(api: ExtensionAPI, destination: VaultDestination = {}): void {
  api.window.focusSelf()
  api.window.broadcast('extension:activate-global-tab', GLOBAL_TAB_ID)
  if (
    destination.date === undefined &&
    destination.taskId === undefined &&
    destination.view === undefined
  ) {
    return
  }
  pending = { ...destination }
  api.window.broadcast('task-vault:navigate', { ...destination })
}

/**
 * The destination a view that has just mounted should honour, once.
 *
 * Cleared on read: a navigation replayed on every later mount would drag you
 * back to a task you finished with an hour ago.
 */
export function popPendingNavigation(): VaultDestination | null {
  const destination = pending
  pending = null
  return destination
}
