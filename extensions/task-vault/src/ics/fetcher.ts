import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { parseIcs } from './parser.js'
import type { CalendarEvent } from './parser.js'

export interface IcsFeedCache {
  url: string
  events: CalendarEvent[]
  fetchedAt: string
  fetchError: string | null
  isFeedConfigured: boolean
}

async function readCache(cachePath: string): Promise<IcsFeedCache | null> {
  try {
    const raw = await fs.readFile(cachePath, 'utf-8')
    return JSON.parse(raw) as IcsFeedCache
  } catch {
    return null
  }
}

async function writeCache(cachePath: string, data: IcsFeedCache): Promise<void> {
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8')
}

async function fetchIcsContent(url: string): Promise<string> {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.text()
  }
  // Local file path
  return fs.readFile(url, 'utf-8')
}

export async function fetchFeed(url: string, cachePath: string): Promise<IcsFeedCache> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  try {
    const icsContent = await fetchIcsContent(url)
    const events = parseIcs(icsContent, windowStart, windowEnd)
    const cache: IcsFeedCache = {
      url,
      events,
      fetchedAt: now.toISOString(),
      fetchError: null,
      isFeedConfigured: true,
    }
    await writeCache(cachePath, cache)
    return cache
  } catch (err) {
    const cached = await readCache(cachePath)
    if (cached) {
      return { ...cached, fetchError: String(err), isFeedConfigured: true }
    }
    return {
      url,
      events: [],
      fetchedAt: now.toISOString(),
      fetchError: String(err),
      isFeedConfigured: false,
    }
  }
}

let pollingInterval: ReturnType<typeof setInterval> | null = null

export function startPolling(
  feedUrls: string[],
  cachePath: string,
  intervalMs = 15 * 60 * 1000
): void {
  stopPolling()
  // Initial fetch
  for (const url of feedUrls) {
    fetchFeed(url, cachePath).catch(() => {})
  }
  pollingInterval = setInterval(() => {
    for (const url of feedUrls) {
      fetchFeed(url, cachePath).catch(() => {})
    }
  }, intervalMs)
}

export function stopPolling(): void {
  if (pollingInterval !== null) {
    clearInterval(pollingInterval)
    pollingInterval = null
  }
}
