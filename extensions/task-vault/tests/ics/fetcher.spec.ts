import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
  }
})

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('../../src/ics/parser', () => ({
  parseIcs: vi.fn().mockReturnValue([]),
}))

import { fetchFeed } from '../../src/ics/fetcher'

const CACHE_PATH = '/vault/.todo/ics-cache.json'
const HTTP_URL = 'https://example.com/feed.ics'
const LOCAL_PATH = '/vault/calendar.ics'
const ICS_CONTENT = 'BEGIN:VCALENDAR\nEND:VCALENDAR'

const cachedData = {
  url: HTTP_URL,
  events: [
    {
      uid: 'cached1',
      summary: 'Cached Event',
      start: '2026-05-20T10:00:00Z',
      end: '2026-05-20T11:00:00Z',
      allDay: false,
    },
  ],
  fetchedAt: new Date().toISOString(),
  fetchError: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
})

describe('fetchFeed', () => {
  it('HTTP URL fetch returns events', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(ICS_CONTENT),
    })
    vi.mocked(fs.readFile).mockRejectedValue(new Error('No cache'))
    const result = await fetchFeed(HTTP_URL, CACHE_PATH)
    expect(result.isFeedConfigured).toBe(true)
    expect(result.fetchError).toBeNull()
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
  })

  it('local file path reads events', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(ICS_CONTENT as unknown as Buffer) // ics file
      .mockRejectedValue(new Error('No cache'))
    const result = await fetchFeed(LOCAL_PATH, CACHE_PATH)
    expect(result.isFeedConfigured).toBe(true)
    expect(result.fetchError).toBeNull()
  })

  it('failed HTTP fetch returns cached events with fetchError', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(cachedData) as unknown as Buffer)
    const result = await fetchFeed(HTTP_URL, CACHE_PATH)
    expect(result.fetchError).toBeTruthy()
    expect(result.events).toEqual(cachedData.events)
  })

  it('no cache + failed fetch returns empty with isFeedConfigured: false', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))
    vi.mocked(fs.readFile).mockRejectedValue(new Error('No cache'))
    const result = await fetchFeed(HTTP_URL, CACHE_PATH)
    expect(result.isFeedConfigured).toBe(false)
    expect(result.events).toEqual([])
  })

  it('on success writes cache to cachePath', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(ICS_CONTENT),
    })
    vi.mocked(fs.readFile).mockRejectedValue(new Error('No cache'))
    await fetchFeed(HTTP_URL, CACHE_PATH)
    const writeCalls = vi.mocked(fs.writeFile).mock.calls
    const cacheWrite = writeCalls.find((c) => (c[0] as string).includes('ics-cache'))
    expect(cacheWrite).toBeDefined()
  })
})
