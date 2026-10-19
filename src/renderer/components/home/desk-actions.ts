import { answerChoice } from '../../terminal/session-controller'
import { revealSession } from '../../terminal/navigate-to-session'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { useExtensionCommandsStore } from '../../stores/extension-commands.store'
import { useToastStore } from '../../stores/toast.store'
import { useSessionStore } from '../../stores/session.store'
import { REVEAL_SESSION_COMMAND, type DeskAsk } from '../../home/core-asks'

// What the Desk does when the operator acts on an ask, apart from how it is drawn.

const HOUR_MS = 3_600_000
const AFTERNOON_HOUR = 14
const TOMORROW_HOUR = 9
const EXCERPT_LINES = 14
const CHOICE_ACTION = /^choice-(\d+)$/

export interface SnoozeChoice {
  label: string
  until: number
}

/** The three times an ask can be put off to; "this afternoon" is 3 hours on once 14:00 has passed. */
export function snoozeChoices(now: number): SnoozeChoice[] {
  const afternoon = new Date(now).setHours(AFTERNOON_HOUR, 0, 0, 0)
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return [
    { label: '1 hour', until: now + HOUR_MS },
    { label: 'This afternoon', until: afternoon > now ? afternoon : now + 3 * HOUR_MS },
    { label: 'Tomorrow', until: tomorrow.setHours(TOMORROW_HOUR, 0, 0, 0) },
  ]
}

/** A time of day as "2 PM" or "2:30 PM". */
export function untilLabel(until: number): string {
  const time = new Date(until)
  const options: Intl.DateTimeFormatOptions =
    time.getMinutes() === 0 ? { hour: 'numeric' } : { hour: 'numeric', minute: '2-digit' }
  return time.toLocaleTimeString('en-US', options)
}

/** Types `text` into the session and presses Enter. */
export function replyToSession(sessionId: string, text: string): void {
  window.electronAPI.terminal.input(sessionId, `${text}\r`)
}

/** The last lines of the session's screen, as text; empty when its terminal is not open. */
export function terminalExcerpt(sessionId: string | undefined): string[] {
  if (sessionId === undefined) return []
  const rows = useSessionStore.getState().getTerminalInstance(sessionId)?.readVisibleRows() ?? []
  let end = rows.length
  while (end > 0 && rows[end - 1].trim() === '') end--
  return rows.slice(Math.max(0, end - EXCERPT_LINES), end)
}

/** Runs one of the ask's actions: core answers or opens its own session, an extension runs the rest. */
export async function runAskAction(ask: DeskAsk, actionId: string): Promise<void> {
  if (ask.source !== 'core') {
    await useHomeFeedStore.getState().runAction(ask.source, ask.id, actionId)
    return
  }
  const choice = CHOICE_ACTION.exec(actionId)
  if (choice && ask.sessionId) answerChoice(ask.sessionId, Number(choice[1]))
  else if (actionId === 'review-changes' && ask.sessionId) revealSession(ask.sessionId)
}

/** Brings the place the ask came from forward: its session, or the extension's own view. */
export async function openAsk(ask: DeskAsk): Promise<void> {
  const { command, args } = ask.open
  if (command === REVEAL_SESSION_COMMAND) {
    if (ask.sessionId) revealSession(ask.sessionId)
    return
  }
  await useExtensionCommandsStore.getState().refresh()
  const found = useExtensionCommandsStore
    .getState()
    .registered.find((c) => c.key === command || (c.extensionId === ask.source && c.id === command))
  if (found === undefined) {
    useToastStore.getState().addToast({
      type: 'error',
      message: 'Could not open this: the extension that sent it is not running.',
    })
    return
  }
  const context = { projectId: null, sessionId: null, repoRoot: null }
  window.electronAPI.extension.executeCommand(found.key, context, args)
}
