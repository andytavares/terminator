import { z } from 'zod'
import type { HomeAsk } from '../../../core-shared/src/schemas/home-feed.schema.js'

// Alerts Claude raises through the Terminator MCP server's `alert` tool (packages/core-main/src/mcp/alert-tool.ts):
// a Home ask with Dismiss, a notification, or both.

const DAY_MS = 24 * 60 * 60 * 1000

export const AlertSchema = z.object({
  title: z.string().trim().min(1),
  message: z.string().default(''),
  home: z.boolean().default(true),
  notify: z.boolean().default(true),
  source: z.string().trim().min(1).optional(),
})

interface AlertDeps {
  now: () => Date
  notify: (title: string, message: string) => void
  /** Everything shown on Home; replaces the earlier list. */
  publish: (asks: HomeAsk[]) => void
}

type Alert = z.infer<typeof AlertSchema>

const homeAlert = (alert: Alert, where: string, since: Date): HomeAsk => ({
  id: `alert-${JSON.stringify([where, alert.title, since.toISOString()])}`,
  kind: 'finished',
  title: alert.title,
  detail: alert.message,
  where,
  facts: [],
  workKey: null,
  since: since.toISOString(),
  actions: [{ id: 'dismiss', label: 'Dismiss', primary: true }],
  // Home needs somewhere to go; with no session this does nothing.
  open: { command: 'core:reveal-session' },
})

function parseAlert(raw: unknown): Alert {
  const parsed = AlertSchema.safeParse(raw)
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
  return parsed.data
}

// shortcut: Home alerts live in memory and go when the app quits; persist them if people miss them.
export function createAlerts({ now, notify, publish }: AlertDeps) {
  let shown: HomeAsk[] = []
  return {
    /** `where` shows when the alert names no source. Throws, in words, when it is not an alert. */
    receive(raw: unknown, where: string): void {
      const alert = parseAlert(raw)
      if (alert.notify) notify(alert.title, alert.message)
      if (!alert.home) return
      const ask = homeAlert(alert, alert.source ?? where, now())
      const sameWithinADay = (old: HomeAsk) =>
        old.where === ask.where &&
        old.title === ask.title &&
        Date.parse(ask.since) - Date.parse(old.since) < DAY_MS
      shown = [...shown.filter((old) => !sameWithinADay(old)), ask]
      publish(shown)
    },
    act(askId: string, actionId: string): void {
      if (actionId !== 'dismiss') return
      shown = shown.filter((ask) => ask.id !== askId)
      publish(shown)
    },
  }
}
