import { describe, it, expect, vi } from 'vitest'
import { createAlerts } from '../../../src/home/scheduled-alerts'
import type { HomeAsk } from '../../../../core-shared/src/schemas/home-feed.schema'

const DAY_MS = 24 * 60 * 60 * 1000

function alerts(start = new Date('2026-11-06T09:00:00Z')) {
  let asks: HomeAsk[] = []
  let clock = start
  const notify = vi.fn(() => 'notification-1')
  const unnotify = vi.fn()
  const store = createAlerts({
    now: () => clock,
    notify,
    unnotify,
    publish: (next) => void (asks = next),
  })
  const later = (ms: number) => void (clock = new Date(clock.getTime() + ms))
  return { store, notify, unnotify, asks: () => asks, later }
}

const red = { title: 'CI is red', message: 'main failed on lint.', home: true, notify: true }

describe('createAlerts', () => {
  it('shows a home alert on Home under its source, and sends a notification', () => {
    const { store, notify, asks } = alerts()
    store.receive({ ...red, source: 'Scheduled run · check CI' }, 'Claude · shop')
    expect(asks()).toEqual([
      expect.objectContaining({
        title: 'CI is red',
        detail: 'main failed on lint.',
        where: 'Scheduled run · check CI',
        actions: [{ id: 'dismiss', label: 'Dismiss', primary: true }],
      }),
    ])
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'CI is red', message: 'main failed on lint.' }),
      expect.objectContaining({ terminalId: null })
    )
  })

  it('shows the fallback place when the alert names no source', () => {
    const { store, asks } = alerts()
    store.receive(red, 'Claude · shop')
    expect(asks()[0].where).toBe('Claude · shop')
  })
})

describe('createAlerts, home and notify', () => {
  it('only notifies when home is false, and only shows on Home when notify is false', () => {
    const { store, notify, asks } = alerts()
    store.receive({ ...red, home: false }, 'Claude · shop')
    expect(asks()).toEqual([])
    store.receive({ ...red, notify: false }, 'Claude · shop')
    expect(asks()).toHaveLength(1)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does both when the agent leaves home and notify out', () => {
    const { store, notify, asks } = alerts()
    store.receive({ title: 'Done', message: 'Report written.' }, 'Claude · shop')
    expect(asks()).toHaveLength(1)
    expect(notify).toHaveBeenCalled()
  })
})

describe('createAlerts, the same alert again', () => {
  it('replaces an alert with the same source and title within a day', () => {
    const { store, asks, later } = alerts()
    store.receive(red, 'Claude · shop')
    later(30 * 60 * 1000)
    store.receive({ ...red, message: 'still red' }, 'Claude · shop')
    store.receive(red, 'Claude · api')
    expect(asks().map((a) => [a.where, a.detail])).toEqual([
      ['Claude · shop', 'still red'],
      ['Claude · api', 'main failed on lint.'],
    ])
  })

  it('keeps alerts whose title or source only starts like another one', () => {
    const { store, asks } = alerts()
    store.receive({ ...red, title: 'CI@main' }, 'Claude · shop')
    store.receive({ ...red, title: 'CI' }, 'Claude · shop')
    store.receive({ ...red, title: 'x' }, 'Claude: a')
    store.receive({ ...red, title: 'a: x' }, 'Claude')
    expect(asks().map((a) => a.title)).toEqual(['CI@main', 'CI', 'x', 'a: x'])
  })

  it('keeps yesterday’s alert and adds a new one after a day', () => {
    const { store, asks, later } = alerts()
    store.receive(red, 'Claude · shop')
    later(DAY_MS + 1)
    store.receive(red, 'Claude · shop')
    expect(new Set(asks().map((a) => a.id)).size).toBe(2)
  })
})

describe('createAlerts, dismissing and refusing', () => {
  it('removes the alert from Home when dismissed', () => {
    const { store, asks } = alerts()
    store.receive(red, 'Claude · shop')
    store.receive({ ...red, title: 'Deploy done' }, 'Claude · shop')
    store.act(asks()[0].id, 'dismiss')
    expect(asks().map((a) => a.title)).toEqual(['Deploy done'])
  })

  it('refuses an alert without a title, and names the field', () => {
    const { store, asks } = alerts()
    expect(() => store.receive({ message: 'no title' }, 'Claude · shop')).toThrow(/title/)
    expect(asks()).toEqual([])
  })
})

const pr = 'https://github.com/acme/shop/pull/7'
const openOrDone = [
  { label: 'Open PR', url: pr, primary: true },
  { label: 'Done', dismiss: true },
]

describe('createAlerts, buttons', () => {
  it('shows the alert buttons in order on Home, with Dismiss last and not primary', () => {
    const { store, asks } = alerts()
    store.receive({ title: 'PR ready', actions: openOrDone }, 'Claude · shop')
    expect(asks()[0].actions).toEqual([
      { id: 'action-0', label: 'Open PR', primary: true, url: pr, dismiss: false },
      { id: 'action-1', label: 'Done', dismiss: true },
      { id: 'dismiss', label: 'Dismiss', primary: false },
    ])
  })

  it('keeps Dismiss primary when no button is primary', () => {
    const { store, asks } = alerts()
    store.receive({ title: 'PR ready', actions: [{ label: 'Open PR', url: pr }] }, 'Claude · shop')
    expect(asks()[0].actions.at(-1)).toEqual({ id: 'dismiss', label: 'Dismiss', primary: true })
  })

  it('refuses more than three buttons', () => {
    const { store, asks } = alerts()
    const actions = ['a', 'b', 'c', 'd'].map((label) => ({ label, url: pr }))
    expect(() => store.receive({ title: 'Too many', actions }, 'Claude · shop')).toThrow(/3/)
    expect(asks()).toEqual([])
  })
})

describe('createAlerts, links', () => {
  it.each([
    ['the alert link', (url: string) => ({ title: 'Bad', url })],
    ['a button link', (url: string) => ({ title: 'Bad', actions: [{ label: 'Go', url }] })],
  ])('refuses a javascript: or file: URL as %s, in words', (_, alertWith) => {
    const { store, asks } = alerts()
    expect(() => store.receive(alertWith('javascript:alert(1)'), 'Claude · shop')).toThrow(/http/)
    expect(() => store.receive(alertWith('file:///etc/passwd'), 'Claude · shop')).toThrow(/http/)
    expect(asks()).toEqual([])
  })

  it('opens the alert link when Home opens the alert, even from a terminal', () => {
    const { store, asks } = alerts()
    store.receive({ title: 'PR ready', url: pr }, 'Claude · shop', 'tab-1')
    expect(asks()[0].open).toEqual({ command: 'core:open-url', args: { url: pr } })
  })
})

describe('createAlerts, Reply', () => {
  it('refuses a Reply button when the alert does not come from a Terminator terminal', () => {
    const { store, asks } = alerts()
    const raw = { title: 'Which DB?', actions: [{ label: 'Reply', reply: true }] }
    expect(() => store.receive(raw, 'Claude · shop', null)).toThrow(
      'A Reply button needs the alert to come from a session in a Terminator terminal.'
    )
    expect(asks()).toEqual([])
  })

  it('refuses two Reply buttons', () => {
    const { store } = alerts()
    const reply = { label: 'Reply', reply: true }
    expect(() =>
      store.receive({ title: 'Which DB?', actions: [reply, reply] }, 'Claude · shop', 'tab-1')
    ).toThrow(/Reply/)
  })

  it('makes a Reply button an answer ask that opens its terminal', () => {
    const { store, asks } = alerts()
    const raw = { title: 'Which DB?', actions: [{ label: 'Answer', reply: true }] }
    store.receive(raw, 'Claude · shop', 'tab-1')
    expect(asks()[0]).toMatchObject({
      kind: 'answer',
      actions: [
        { id: 'reply', label: 'Answer' },
        { id: 'dismiss', label: 'Dismiss', primary: true },
      ],
      open: { command: 'core:reveal-session', args: { sessionId: 'tab-1' } },
    })
  })
})

describe('createAlerts, buttons that dismiss', () => {
  it('removes the alert when a dismissing button is pressed, and keeps it for a link button', () => {
    const { store, asks } = alerts()
    const actions = [
      { label: 'Open PR', url: pr },
      { label: 'Done', dismiss: true },
    ]
    store.receive({ title: 'PR ready', actions }, 'Claude · shop')
    store.act(asks()[0].id, 'action-0')
    expect(asks()).toHaveLength(1)
    store.act(asks()[0].id, 'action-1')
    expect(asks()).toEqual([])
  })
})

describe('createAlerts, the notification an alert sent', () => {
  it('dismisses the notification when the alert leaves Home', () => {
    const { store, unnotify, asks } = alerts()
    store.receive(red, 'Claude · shop')
    store.act(asks()[0].id, 'dismiss')
    expect(unnotify).toHaveBeenCalledWith('notification-1')
  })

  it('withdraws the notification of an alert that a newer copy replaces', () => {
    const { store, notify, unnotify } = alerts()
    notify.mockReturnValueOnce('notification-old').mockReturnValueOnce('notification-new')
    store.receive(red, 'Claude · shop')
    store.receive(red, 'Claude · shop')
    expect(unnotify).toHaveBeenCalledExactlyOnceWith('notification-old')
  })

  it('removes the alert from Home when its notification dismisses it', () => {
    const { store, notify, asks } = alerts()
    store.receive(red, 'Claude · shop')
    const [[, sent]] = notify.mock.calls as unknown as [[unknown, { dismiss: () => void }]]
    sent.dismiss()
    expect(asks()).toEqual([])
  })
})

describe('createAlerts, a Reply button beside a link', () => {
  it('keeps the row on the terminal, so a reply reaches it', () => {
    const { store, asks } = alerts()
    const actions = [{ label: 'Reply', reply: true }]
    store.receive({ title: 'PR ready', url: pr, actions }, 'Claude · shop', 'tab-1')
    expect(asks()[0].open).toEqual({ command: 'core:reveal-session', args: { sessionId: 'tab-1' } })
  })
})
