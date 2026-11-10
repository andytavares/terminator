import { describe, it, expect, vi, beforeEach } from 'vitest'

const notified = vi.hoisted(() => vi.fn())
const unnotified = vi.hoisted(() => vi.fn())
const openedExternally = vi.hoisted(() => vi.fn())
const revealedTerminal = vi.hoisted(() => vi.fn())

vi.mock('../../../src/notifications/notification-manager', () => ({
  notificationManager: { create: notified, withdraw: unnotified },
}))
vi.mock('../../../src/open-externally', () => ({ openExternally: openedExternally }))
vi.mock('../../../src/ipc/notification.ipc', () => ({ revealSessionOnClick: revealedTerminal }))
vi.mock('../../../src/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
  makeLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}))

const caller = {
  sessionId: 's1',
  claudePid: 1,
  projectDir: '/Users/me/repos/shop',
  terminalId: null,
}
const fromTab = { ...caller, terminalId: 'tab-1' }
const pr = 'https://github.com/acme/shop/pull/7'

interface SentNotification {
  actions: { id: string; label: string; handler: () => void }[]
  onClick?: () => void
}
const sentNotification = () => notified.mock.calls[0][0] as SentNotification
const notificationButton = (label: string) =>
  sentNotification().actions.find((action) => action.label === label)!

async function load() {
  const feed = await import('../../../src/home/home-feed')
  const { alertTool } = await import('../../../src/mcp/alert-tool')
  const [tool] = alertTool.tools()
  return { feed, tool }
}

beforeEach(() => {
  vi.resetModules()
  notified.mockReset()
  unnotified.mockReset()
  openedExternally.mockReset()
  revealedTerminal.mockReset()
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

describe('alertTool, buttons on the notification', () => {
  it('gives the notification the Home buttons, with Dismiss', async () => {
    const { feed, tool } = await load()
    const actions = [
      { label: 'Open PR', url: pr },
      { label: 'Answer', reply: true },
    ]
    await tool.call({ title: 'PR ready', actions }, fromTab)
    const labels = ['Open PR', 'Answer', 'Dismiss']
    expect(feed.getMergedFeed().asks[0].actions.map((a) => a.label)).toEqual(labels)
    expect(sentNotification().actions.map((a) => a.label)).toEqual(labels)
  })

  it('opens a link button in the browser and keeps the alert on Home', async () => {
    const { feed, tool } = await load()
    await tool.call({ title: 'PR ready', actions: [{ label: 'Open PR', url: pr }] }, caller)
    notificationButton('Open PR').handler()
    expect(openedExternally).toHaveBeenCalledWith(pr)
    expect(feed.getMergedFeed().asks).toHaveLength(1)
  })
})

describe('alertTool, buttons on the notification that dismiss', () => {
  it('removes the Home alert when a dismissing button on the notification is pressed', async () => {
    const { feed, tool } = await load()
    const actions = [{ label: 'Open and close', url: pr, dismiss: true }]
    await tool.call({ title: 'PR ready', actions }, caller)
    notificationButton('Open and close').handler()
    expect(feed.getMergedFeed().asks).toEqual([])
  })

  it('removes the Home alert when Dismiss on the notification is pressed', async () => {
    const { feed, tool } = await load()
    await tool.call({ title: 'PR ready' }, caller)
    notificationButton('Dismiss').handler()
    expect(feed.getMergedFeed().asks).toEqual([])
  })
})

describe('alertTool, Reply on the notification', () => {
  it('reveals the calling terminal when the Reply button is pressed', async () => {
    const { tool } = await load()
    await tool.call({ title: 'Which DB?', actions: [{ label: 'Answer', reply: true }] }, fromTab)
    notificationButton('Answer').handler()
    expect(revealedTerminal).toHaveBeenCalledWith('tab-1')
  })
})

describe('alertTool, clicking the notification', () => {
  it('opens the alert link', async () => {
    const { tool } = await load()
    await tool.call({ title: 'PR ready', url: pr }, fromTab)
    sentNotification().onClick?.()
    expect(openedExternally).toHaveBeenCalledWith(pr)
    expect(revealedTerminal).not.toHaveBeenCalled()
  })

  it('reveals the calling terminal when the alert has no link', async () => {
    const { tool } = await load()
    await tool.call({ title: 'Tests pass' }, fromTab)
    sentNotification().onClick?.()
    expect(revealedTerminal).toHaveBeenCalledWith('tab-1')
  })
})

describe('alertTool, dismissing on Home', () => {
  it('dismisses the alert notification too', async () => {
    const { feed, tool } = await load()
    notified.mockReturnValue('notification-1')
    await tool.call({ title: 'PR ready' }, caller)
    await feed.runAction('claude-alerts', feed.getMergedFeed().asks[0].id, 'dismiss')
    expect(unnotified).toHaveBeenCalledWith('notification-1')
  })

  it('refuses a Reply button from a shell outside Terminator, in words', async () => {
    const { feed, tool } = await load()
    const args = { title: 'Which DB?', actions: [{ label: 'Answer', reply: true }] }
    await expect(tool.call(args, caller)).rejects.toThrow(/Terminator terminal/)
    expect(feed.getMergedFeed().asks).toEqual([])
  })
})
