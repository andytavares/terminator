import { pastedLine } from '../../terminal/typed-input'
import { answerChoice } from '../../terminal/session-controller'
import { revealSession } from '../../terminal/navigate-to-session'
import { useHomeFeedStore } from '../../stores/home-feed.store'
import { registeredCommandKey } from '../../stores/extension-commands.store'
import { useToastStore } from '../../stores/toast.store'
import { useSessionStore } from '../../stores/session.store'
import {
  OPEN_URL_COMMAND,
  REVEAL_SESSION_COMMAND,
  openArg,
  type DeskAsk,
} from '../../home/core-asks'

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

/** Pastes `text` into the session and presses Enter; a reply that starts "2" is not menu choice 2. */
export function replyToSession(sessionId: string, text: string): void {
  window.electronAPI.terminal.input(sessionId, pastedLine(text))
}

/** Runs an extension's action; on failure says why in a toast and resolves false. */
export async function runFeedAction(
  source: string,
  itemId: string,
  actionId: string
): Promise<boolean> {
  const result = await useHomeFeedStore.getState().runAction(source, itemId, actionId)
  if (!result.ok) {
    useToastStore
      .getState()
      .addToast({ type: 'error', message: `That did not work. ${result.message}` })
  }
  return result.ok
}

/** The last lines of the session's screen, as text; empty when its terminal is not open. */
export function terminalExcerpt(sessionId: string | undefined): string[] {
  if (sessionId === undefined) return []
  const rows = useSessionStore.getState().getTerminalInstance(sessionId)?.readVisibleRows() ?? []
  let end = rows.length
  while (end > 0 && rows[end - 1].trim() === '') end--
  return rows.slice(Math.max(0, end - EXCERPT_LINES), end)
}

/** Opens an http(s) link; main's window-open handler hands it to the browser. */
function openLink(url: unknown): void {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) window.open(url, '_blank')
}

/** Runs one of the ask's actions: core answers or opens its own session, an extension runs the rest. */
export async function runAskAction(ask: DeskAsk, actionId: string): Promise<void> {
  openLink(ask.actions.find((action) => action.id === actionId)?.url)
  if (ask.source !== 'core') {
    await runFeedAction(ask.source, ask.id, actionId)
    return
  }
  const choice = CHOICE_ACTION.exec(actionId)
  if (choice && ask.sessionId) answerChoice(ask.sessionId, Number(choice[1]))
  else if (actionId === 'review-changes' && ask.sessionId) revealSession(ask.sessionId)
}

/** Brings the place the ask came from forward: its session, or the extension's own view. */
export async function openAsk(ask: DeskAsk): Promise<void> {
  const { command, args } = ask.open
  if (command === OPEN_URL_COMMAND) return openLink(openArg(args, 'url'))
  if (command === REVEAL_SESSION_COMMAND) {
    const sessionId = ask.sessionId ?? openArg(args, 'sessionId')
    if (typeof sessionId === 'string') revealSession(sessionId)
    return
  }
  await openInExtension(ask.source, ask.open)
}

/** Runs a command of the extension that owns the work, to show it in the extension's own view. */
export async function openInExtension(
  source: string,
  open: { command: string; args?: unknown }
): Promise<void> {
  const key = await registeredCommandKey(source, open.command)
  if (key === null) {
    useToastStore.getState().addToast({
      type: 'error',
      message: 'Could not open this: the extension that sent it is not running.',
    })
    return
  }
  const context = { projectId: null, sessionId: null, repoRoot: null }
  window.electronAPI.extension.executeCommand(key, context, open.args)
}
