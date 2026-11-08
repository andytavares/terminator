import { describe, it, expect, vi } from 'vitest'
import { createAlerts } from '../../../src/home/scheduled-alerts'
import type { HomeAsk } from '../../../../core-shared/src/schemas/home-feed.schema'

const DAY_MS = 24 * 60 * 60 * 1000

function alerts(start = new Date('2026-11-06T09:00:00Z')) {
  let asks: HomeAsk[] = []
  let clock = start
  const notify = vi.fn()
  const store = createAlerts({ now: () => clock, notify, publish: (next) => void (asks = next) })
  const later = (ms: number) => void (clock = new Date(clock.getTime() + ms))
  return { store, notify, asks: () => asks, later }
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
    expect(notify).toHaveBeenCalledWith('CI is red', 'main failed on lint.')
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
