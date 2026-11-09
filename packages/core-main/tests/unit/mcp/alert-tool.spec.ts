import { describe, it, expect, vi, beforeEach } from 'vitest'

const notified = vi.hoisted(() => vi.fn())

vi.mock('../../../src/notifications/notification-manager', () => ({
  notificationManager: { create: notified },
}))
vi.mock('../../../src/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
  makeLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}))

const caller = { sessionId: 's1', claudePid: 1, projectDir: '/Users/me/repos/shop' }

async function load() {
  const feed = await import('../../../src/home/home-feed')
  const { alertTool } = await import('../../../src/mcp/alert-tool')
  const [tool] = alertTool.tools()
  return { feed, tool }
}

beforeEach(() => {
  vi.resetModules()
  notified.mockReset()
})

describe('alertTool', () => {
  it('is one tool named alert that is not destructive and needs a title', async () => {
    const { tool } = await load()
    expect(tool.name).toBe('alert')
    expect(tool.annotations).toEqual({ destructiveHint: false })
    expect(tool.inputSchema).toMatchObject({ type: 'object', required: ['title'] })
  })

  it('shows the alert on Home under the caller folder, and sends a claudeAlert notification', async () => {
    const { feed, tool } = await load()
    await tool.call({ title: 'CI is red', message: 'main failed on lint.' }, caller)
    expect(feed.getMergedFeed().asks).toEqual([
      expect.objectContaining({
        title: 'CI is red',
        detail: 'main failed on lint.',
        where: 'Claude · shop',
        source: 'claude-alerts',
      }),
    ])
    expect(notified).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'CI is red',
        message: 'main failed on lint.',
        key: 'claudeAlert',
      })
    )
  })
})

describe('alertTool, source and Dismiss', () => {
  it('names the source on Home when the caller gives one, and Dismiss removes it', async () => {
    const { feed, tool } = await load()
    await tool.call({ title: 'Done', source: 'Scheduled run · triage inbox' }, caller)
    const [ask] = feed.getMergedFeed().asks
    expect(ask.where).toBe('Scheduled run · triage inbox')
    await feed.runAction('claude-alerts', ask.id, 'dismiss')
    expect(feed.getMergedFeed().asks).toEqual([])
  })
})

describe('alertTool, home and notify', () => {
  it('only notifies when home is false, and only shows on Home when notify is false', async () => {
    const { feed, tool } = await load()
    await tool.call({ title: 'Ping', home: false }, caller)
    expect(feed.getMergedFeed().asks).toEqual([])
    expect(notified).toHaveBeenCalledTimes(1)
    await tool.call({ title: 'Quiet', notify: false }, caller)
    expect(feed.getMergedFeed().asks.map((a) => a.title)).toEqual(['Quiet'])
    expect(notified).toHaveBeenCalledTimes(1)
  })

  it('replaces an alert with the same title from the same source instead of stacking it', async () => {
    const { feed, tool } = await load()
    await tool.call({ title: 'CI is red', message: 'first' }, caller)
    await tool.call({ title: 'CI is red', message: 'second' }, caller)
    await tool.call({ title: 'CI is red', source: 'Scheduled run · check CI' }, caller)
    expect(feed.getMergedFeed().asks.map((a) => [a.where, a.detail])).toEqual([
      ['Claude · shop', 'second'],
      ['Scheduled run · check CI', ''],
    ])
  })

  it('refuses an alert without a title, in words', async () => {
    const { feed, tool } = await load()
    await expect(tool.call({ message: 'no title' }, caller)).rejects.toThrow(/title/)
    expect(feed.getMergedFeed().asks).toEqual([])
    expect(notified).not.toHaveBeenCalled()
  })
})
