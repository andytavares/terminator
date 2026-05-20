import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { ipcMain } from 'electron'
import type { CalendarEvent } from '../ics/parser.js'

let vaultPath = ''

export function setVaultPath(p: string) {
  vaultPath = p
}

interface IcsCacheEntry {
  url: string
  events: CalendarEvent[]
  fetchedAt: string
  fetchError: string | null
}

export function registerIcsIpcHandlers(): () => void {
  const channels: string[] = []

  function handle(
    channel: string,
    fn: (event: Electron.IpcMainInvokeEvent, payload: unknown) => Promise<unknown>
  ) {
    ipcMain.handle(channel, fn)
    channels.push(channel)
  }

  handle('task-vault:ics:get-events', async () => {
    if (!vaultPath) return { events: [], isStale: false, isFeedConfigured: false }

    const cachePath = path.join(vaultPath, '.todo', 'ics-cache.json')
    try {
      const raw = await fs.readFile(cachePath, 'utf-8')
      const cache = JSON.parse(raw) as IcsCacheEntry[]

      const now = new Date()
      const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

      const allEvents = cache.flatMap((entry) => {
        const fetchedAt = new Date(entry.fetchedAt)
        const ageMs = now.getTime() - fetchedAt.getTime()
        const isStale = ageMs > 30 * 60 * 1000 * 2 // 2× 30min default interval

        return entry.events
          .filter((e) => {
            const start = new Date(e.start)
            return start >= windowStart && start <= windowEnd
          })
          .map((e) => ({ ...e, _isStale: isStale }))
      })

      const isStale = cache.some((entry) => {
        const ageMs = now.getTime() - new Date(entry.fetchedAt).getTime()
        return ageMs > 30 * 60 * 1000 * 2
      })

      return {
        events: allEvents,
        isStale,
        isFeedConfigured: cache.length > 0,
        lastRefreshed: cache[0]?.fetchedAt ?? null,
      }
    } catch {
      return { events: [], isStale: false, isFeedConfigured: false, lastRefreshed: null }
    }
  })

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel)
    }
  }
}
