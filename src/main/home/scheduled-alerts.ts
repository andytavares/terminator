import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import type { HomeAsk } from '../../shared/schemas/home-feed.schema.js'
import { makeLogger } from '../logger.js'

// Alerts a scheduled run's agent writes as JSON files into one folder (unattended-run.ts tells it
// where). A file drop, as claude-hook.ts: the app runs no server an agent could reach.

const logger = makeLogger('scheduled-alerts')

const AlertSchema = z.object({
  title: z.string().trim().min(1),
  message: z.string().default(''),
  home: z.boolean().default(true),
  notify: z.boolean().default(true),
})

interface AlertDeps {
  now: () => Date
  notify: (title: string, message: string) => void
  /** Everything shown on Home; replaces the earlier list. */
  publish: (asks: HomeAsk[]) => void
}

type Alert = z.infer<typeof AlertSchema>

const homeAlert = (id: string, alert: Alert, since: Date): HomeAsk => ({
  id: `alert-${id}`,
  kind: 'finished',
  title: alert.title,
  detail: alert.message,
  where: 'Scheduled run',
  facts: [],
  workKey: null,
  since: since.toISOString(),
  actions: [{ id: 'dismiss', label: 'Dismiss', primary: true }],
  // Home needs somewhere to go; with no session this does nothing.
  open: { command: 'core:reveal-session' },
})

// shortcut: Home alerts live in memory and go when the app quits; persist them if people miss them.
export function createAlerts({ now, notify, publish }: AlertDeps) {
  let shown: HomeAsk[] = []
  return {
    /** Throws when the file is not an alert. */
    receive(id: string, raw: unknown): void {
      const alert = AlertSchema.parse(raw)
      if (alert.notify) notify(alert.title, alert.message)
      if (!alert.home) return
      shown = [...shown, homeAlert(id, alert, now())]
      publish(shown)
    },
    act(askId: string, actionId: string): void {
      if (actionId !== 'dismiss') return
      shown = shown.filter((ask) => ask.id !== askId)
      publish(shown)
    },
  }
}

/** Hands one file to `receive` and deletes it; a half-written file waits for the next event. */
function readAlert(file: string, receive: (id: string, raw: unknown) => void): void {
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return
  }
  try {
    receive(path.basename(file, '.json'), raw)
  } catch (error) {
    logger.error('alert refused', { file, error: String(error) })
  }
  fs.rmSync(file, { force: true })
}

function readFolder(folder: string, receive: (id: string, raw: unknown) => void): void {
  for (const name of fs
    .readdirSync(folder)
    .filter((n) => n.endsWith('.json'))
    .sort())
    readAlert(path.join(folder, name), receive)
}

/** Reads what is there now, then every file written later. Returns the way to stop. */
export function watchAlerts(
  folder: string,
  receive: (id: string, raw: unknown) => void
): () => void {
  fs.mkdirSync(folder, { recursive: true })
  // Not persistent: the windows keep the app alive, and the watch lasts as long as the app.
  const watcher = fs.watch(folder, { persistent: false }, () => readFolder(folder, receive))
  watcher.on('error', (error) => logger.error('alert watch failed', { error: String(error) }))
  readFolder(folder, receive)
  return () => watcher.close()
}
