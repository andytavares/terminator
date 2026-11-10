import { z } from 'zod'
import type { HomeAsk } from '../../../core-shared/src/schemas/home-feed.schema.js'

// Alerts Claude raises through the Terminator MCP server's `alert` tool (packages/core-main/src/mcp/alert-tool.ts):
// a Home ask with Dismiss, a notification, or both.

const DAY_MS = 24 * 60 * 60 * 1000

const WebLinkSchema = z.url({
  protocol: /^https?$/,
  error: 'Use an http:// or https:// link.',
})

const AlertActionSchema = z.object({
  label: z.string().trim().min(1),
  primary: z.boolean().optional(),
  url: WebLinkSchema.optional(),
  dismiss: z.boolean().default(false),
  reply: z.boolean().default(false),
})

export const AlertSchema = z.object({
  title: z.string().trim().min(1),
  message: z.string().default(''),
  home: z.boolean().default(true),
  notify: z.boolean().default(true),
  source: z.string().trim().min(1).optional(),
  url: WebLinkSchema.optional(),
  actions: z
    .array(AlertActionSchema)
    .max(3)
    .default([])
    .refine((actions) => actions.filter((action) => action.reply).length <= 1, {
      error: 'Only one action can be a Reply.',
    }),
})

export type Alert = z.infer<typeof AlertSchema>
export type AlertAction = Alert['actions'][number]

interface AlertDeps {
  now: () => Date
  /** Sends the alert's notification and returns its id; `dismiss` removes the alert from Home. */
  notify: (alert: Alert, sent: { terminalId: string | null; dismiss: () => void }) => string
  unnotify: (notificationId: string) => void
  /** Everything shown on Home; replaces the earlier list. */
  publish: (asks: HomeAsk[]) => void
}

const REPLY_NEEDS_TERMINAL =
  'A Reply button needs the alert to come from a session in a Terminator terminal.'

/** Home's Reply flow keys on the id 'reply'. */
export const alertActionId = (action: AlertAction, index: number): string =>
  action.reply ? 'reply' : `action-${index}`

function askActions(alert: Alert): HomeAsk['actions'] {
  const buttons = alert.actions.map((action, index) => ({
    id: alertActionId(action, index),
    label: action.label,
    primary: action.primary,
    url: action.url,
    dismiss: action.dismiss,
  }))
  const dismissPrimary = !alert.actions.some((action) => action.primary)
  return [...buttons, { id: 'dismiss', label: 'Dismiss', primary: dismissPrimary }]
}

function openAlert(alert: Alert, terminalId: string | null): HomeAsk['open'] {
  if (alert.url) return { command: 'core:open-url', args: { url: alert.url } }
  if (terminalId) return { command: 'core:reveal-session', args: { sessionId: terminalId } }
  // Home needs somewhere to go; with no session this does nothing.
  return { command: 'core:reveal-session' }
}

interface AlertPlace {
  where: string
  since: Date
  terminalId: string | null
}

const homeAlert = (alert: Alert, { where, since, terminalId }: AlertPlace): HomeAsk => ({
  id: `alert-${JSON.stringify([where, alert.title, since.toISOString()])}`,
  kind: alert.actions.some((action) => action.reply) ? 'answer' : 'finished',
  title: alert.title,
  detail: alert.message,
  where,
  facts: [],
  workKey: null,
  since: since.toISOString(),
  actions: askActions(alert),
  open: openAlert(alert, terminalId),
})

function parseAlert(raw: unknown, terminalId: string | null): Alert {
  const parsed = AlertSchema.safeParse(raw)
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
  const replies = parsed.data.actions.some((action) => action.reply)
  if (replies && terminalId === null) throw new Error(REPLY_NEEDS_TERMINAL)
  return parsed.data
}

/** Dismiss, or a button that dismisses, removes the ask. */
const removesAsk = (shown: HomeAsk[], askId: string, actionId: string): boolean =>
  shown.some(
    (ask) =>
      ask.id === askId &&
      ask.actions.some(
        (action) => action.id === actionId && (actionId === 'dismiss' || action.dismiss)
      )
  )

/** Adds the ask in place of the same alert from the last day. */
function replaceSame(shown: HomeAsk[], ask: HomeAsk): HomeAsk[] {
  const sameWithinADay = (old: HomeAsk) =>
    old.where === ask.where &&
    old.title === ask.title &&
    Date.parse(ask.since) - Date.parse(old.since) < DAY_MS
  return [...shown.filter((old) => !sameWithinADay(old)), ask]
}

/** Which notification each Home alert sent, so the notification goes when the alert does. */
function notificationsByAsk(unnotify: AlertDeps['unnotify']) {
  const byAsk = new Map<string, string>()
  return {
    link: (askId: string, notificationId: string) => void byAsk.set(askId, notificationId),
    withdraw(askId: string): void {
      const notificationId = byAsk.get(askId)
      byAsk.delete(askId)
      if (notificationId !== undefined) unnotify(notificationId)
    },
  }
}

// shortcut: Home alerts live in memory and go when the app quits; persist them if people miss them.
export function createAlerts({ now, notify, unnotify, publish }: AlertDeps) {
  let shown: HomeAsk[] = []
  const notifications = notificationsByAsk(unnotify)
  const withdrawNotification = notifications.withdraw

  function act(askId: string, actionId: string): void {
    if (!removesAsk(shown, askId, actionId)) return
    shown = shown.filter((ask) => ask.id !== askId)
    withdrawNotification(askId)
    publish(shown)
  }

  function show(ask: HomeAsk): void {
    const next = replaceSame(shown, ask)
    for (const old of shown) if (!next.includes(old)) withdrawNotification(old.id)
    shown = next
    publish(shown)
  }

  return {
    /** `where` shows when the alert names no source; `terminalId` is the caller's Terminator
     * terminal. Throws, in words, when it is not an alert. */
    receive(raw: unknown, where: string, terminalId: string | null = null): void {
      const alert = parseAlert(raw, terminalId)
      const ask = homeAlert(alert, { where: alert.source ?? where, since: now(), terminalId })
      if (alert.home) show(ask)
      if (alert.notify) {
        const notificationId = notify(alert, { terminalId, dismiss: () => act(ask.id, 'dismiss') })
        if (alert.home) notifications.link(ask.id, notificationId)
      }
    },
    /** Removes the ask for Dismiss, or for a button that dismisses. */
    act,
  }
}
