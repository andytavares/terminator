import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { TerminalInstance } from '../components/terminal/TerminalSession'
import { dispatchNotification } from '../lib/notifications'
import { latestLineOf } from '../sidebar/screen'
import { parseChoicePrompt, samePrompt } from '../sidebar/choice-prompt'
import type { PaneSplitDirection } from '../../shared/types/index'

// The single owner of "a live terminal tab": composes the store record, the
// xterm instance, and the busy/bell/idle wiring. TerminalInstance is a pure
// view object that emits activity events; only this module translates them
// into store state and notifications.

function handleBell(sessionId: string): void {
  const sessionStore = useSessionStore.getState()
  const session = sessionStore.sessions.get(sessionId)
  if (!session) return
  const isActiveSession = sessionStore.getActiveSessionForProject(session.projectId) === sessionId
  const isActiveProject = useWorkspaceStore.getState().activeProjectId === session.projectId
  if (isActiveSession && isActiveProject) return
  sessionStore.incrementBellCount(sessionId)
  dispatchNotification({
    type: 'info',
    title: 'Terminator',
    message: `${session.tabTitle} needs attention`,
    key: 'terminalBell',
  })
}

/**
 * onBusy fires on every PTY output chunk, so the activity stamp is throttled
 * here rather than in the store — the store stays a plain reducer with no
 * timing logic of its own.
 */
const ACTIVITY_STAMP_INTERVAL_MS = 1000
const lastStampedAt = new Map<string, number>()
let now: () => number = Date.now

/** Test seam: lets a spec drive the throttle without timers. */
export function setActivityClock(clock: () => number): void {
  now = clock
}

/** Test seam: clears the per-session throttle state between specs. */
export function resetActivityThrottle(): void {
  lastStampedAt.clear()
}

/** Returns whether it stamped, so a caller can do its own throttled work on the same beat. */
function stampActivity(sessionId: string, force = false): boolean {
  const at = now()
  const last = lastStampedAt.get(sessionId)
  if (!force && last !== undefined && at - last < ACTIVITY_STAMP_INTERVAL_MS) return false
  lastStampedAt.set(sessionId, at)
  useSessionStore.getState().stampActivity(sessionId, at)
  return true
}

function buildInstance(sessionId: string, scrollbackLimit: number): TerminalInstance {
  const instance: TerminalInstance = new TerminalInstance(sessionId, scrollbackLimit, {
    onBell: () => handleBell(sessionId),
    onBusy: () => {
      const stamped = stampActivity(sessionId)
      const store = useSessionStore.getState()
      store.setSessionBusy(sessionId)
      // Output moving means a question was answered or redrawn; the next
      // settle reads it again. A session that never settles still gets its
      // latest line refreshed, on the activity stamp's once-a-second beat.
      const session = store.sessions.get(sessionId)
      if (stamped || session?.choicePrompt !== undefined) {
        store.setSessionScreen(sessionId, {
          latestLine: latestLineOf(instance.readVisibleRows(), instance.cursorRow()),
          choicePrompt: null,
        })
      }
    },
    onIdle: () => {
      // Unthrottled: idle is the end of a burst, and its timestamp is the one
      // that decides how stale the session looks from here on.
      stampActivity(sessionId, true)
      useSessionStore.getState().setSessionIdle(sessionId)
      // Read once per burst, when the screen has stopped moving, rather than
      // per output chunk across every live terminal.
      const rows = instance.readVisibleRows()
      useSessionStore.getState().setSessionScreen(sessionId, {
        latestLine: latestLineOf(rows, instance.cursorRow()),
        choicePrompt: parseChoicePrompt(rows),
      })
    },
  })
  return instance
}

/**
 * Says why a terminal never opened.
 *
 * As an error, which the notification system always delivers as a toast
 * whatever the operator's settings say — the alternative here is a click that
 * does nothing at all, which is not an improvement on a tab that dies.
 */
function reportStartFailure(error: unknown): void {
  dispatchNotification({
    type: 'error',
    title: 'Could not open a terminal',
    message: error instanceof Error ? error.message : String(error),
    key: 'terminalStartFailed',
  })
}

export async function createTerminalSession(
  projectId: string,
  type: 'human' | 'agent',
  title: string,
  cwd: string,
  scrollbackLimit: number,
  parentSessionId?: string,
  /** One line run in the terminal once it opens, for a terminal that resumes a conversation. */
  initialCommand?: string
): Promise<string> {
  const store = useSessionStore.getState()
  let sessionId: string
  try {
    sessionId = await store.createSession(
      projectId,
      type,
      title,
      cwd,
      scrollbackLimit,
      parentSessionId,
      initialCommand
    )
  } catch (error) {
    reportStartFailure(error)
    throw error
  }
  const instance = buildInstance(sessionId, scrollbackLimit)
  // Store the instance first, then activate — TerminalPane's effect fires after
  // both updates land so getTerminalInstance() is guaranteed to return the instance.
  store.setTerminalInstance(sessionId, instance)
  store.setActiveSessionForProject(projectId, sessionId)
  return sessionId
}

/**
 * Takes over a terminal the main process already spawned.
 *
 * A supervised agent's terminal is created there, because that is where the
 * session is started from. The store record alone is not a tab you can see:
 * without an xterm instance nothing ever mounts, and the operator opens the
 * project to find it empty — which is the invisible agent this runtime exists
 * to have got rid of.
 */
export function adoptTerminalSession(adopted: {
  sessionId: string
  projectId: string
  tabTitle: string
  scrollbackLimit: number
}): void {
  const store = useSessionStore.getState()
  if (store.sessions.has(adopted.sessionId)) return
  store.adoptSession(adopted)
  const instance = buildInstance(adopted.sessionId, adopted.scrollbackLimit)
  // Instance first, then activate, so TerminalPane's effect finds it — the same
  // ordering the create path depends on.
  store.setTerminalInstance(adopted.sessionId, instance)
  // Only when that project has nothing selected. `adoptSession` already keeps
  // an existing selection (`activeSessionId ?? sessionId`), and overriding it
  // here meant a supervised run starting in the background yanked the operator
  // away from the terminal they were reading.
  if (store.getActiveSessionForProject(adopted.projectId) === null) {
    store.setActiveSessionForProject(adopted.projectId, adopted.sessionId)
  }
}

export async function splitTerminalSession(
  projectId: string,
  direction: PaneSplitDirection,
  cwd: string,
  scrollbackLimit: number
): Promise<void> {
  const store = useSessionStore.getState()
  const focusedId =
    store.getFocusedSession(projectId) ?? store.getActiveSessionForProject(projectId)
  if (!focusedId) return

  // Pin split panes to the root session (one level of nesting max).
  const focusedSession = store.sessions.get(focusedId)
  const parentSessionId = focusedSession?.parentSessionId ?? focusedId

  // Rejects to the caller rather than reporting here: the split shortcut has
  // its own notification key, and two toasts for one failure is noise.
  const sessionId = await store.createSession(
    projectId,
    'human',
    '',
    cwd,
    scrollbackLimit,
    parentSessionId
  )
  const instance = buildInstance(sessionId, scrollbackLimit)
  store.setTerminalInstance(sessionId, instance)
  store.activateSplit(projectId, focusedId, sessionId, direction)
}

/**
 * Answers a session's numbered prompt as if its number were typed.
 *
 * The screen is read again first: the prompt the button was drawn from may
 * have been answered in the terminal, or replaced, since. Only the same options
 * on screen now get the keypress; otherwise nothing is sent and the buttons go.
 * A bare digit answers a Claude Code select prompt (verified live on 2.1.273).
 */
export function answerChoice(sessionId: string, number: number): boolean {
  const store = useSessionStore.getState()
  const session = store.sessions.get(sessionId)
  const instance = store.getTerminalInstance(sessionId)
  if (session === undefined || instance === undefined) return false
  const onScreen = parseChoicePrompt(instance.readVisibleRows())
  const offered = onScreen?.options.some((o) => o.number === number) === true
  if (!samePrompt(session.choicePrompt ?? null, onScreen) || !offered) {
    store.setSessionScreen(sessionId, { latestLine: session.latestLine ?? '', choicePrompt: null })
    return false
  }
  window.electronAPI.terminal.input(sessionId, String(number))
  return true
}
