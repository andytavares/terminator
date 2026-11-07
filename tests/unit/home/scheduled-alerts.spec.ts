import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAlerts, watchAlerts } from '../../../src/main/home/scheduled-alerts'
import type { HomeAsk } from '../../../src/shared/schemas/home-feed.schema'

const now = () => new Date('2026-11-06T09:00:00Z')

function alerts() {
  let asks: HomeAsk[] = []
  const notify = vi.fn()
  const store = createAlerts({ now, notify, publish: (next) => void (asks = next) })
  return { store, notify, asks: () => asks }
}

const red = { title: 'CI is red', message: 'main failed on lint.', home: true, notify: true }

describe('createAlerts', () => {
  it('shows a home alert on Home and sends a notification', () => {
    const { store, notify, asks } = alerts()
    store.receive('a1', red)
    expect(asks()).toEqual([
      expect.objectContaining({
        id: 'alert-a1',
        title: 'CI is red',
        detail: 'main failed on lint.',
        actions: [{ id: 'dismiss', label: 'Dismiss', primary: true }],
      }),
    ])
    expect(notify).toHaveBeenCalledWith('CI is red', 'main failed on lint.')
  })

  it('only notifies when home is false, and only shows on Home when notify is false', () => {
    const { store, notify, asks } = alerts()
    store.receive('a1', { ...red, home: false })
    expect(asks()).toEqual([])
    store.receive('a2', { ...red, notify: false })
    expect(asks().map((a) => a.id)).toEqual(['alert-a2'])
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('does both when the agent leaves home and notify out', () => {
    const { store, notify, asks } = alerts()
    store.receive('a1', { title: 'Done', message: 'Report written.' })
    expect(asks()).toHaveLength(1)
    expect(notify).toHaveBeenCalled()
  })
})

describe('createAlerts, dismissing and refusing', () => {
  it('removes the alert from Home when dismissed', () => {
    const { store, asks } = alerts()
    store.receive('a1', red)
    store.receive('a2', red)
    store.act('alert-a1', 'dismiss')
    expect(asks().map((a) => a.id)).toEqual(['alert-a2'])
  })

  it('refuses a file without a title, and says so', () => {
    const { store, asks } = alerts()
    expect(() => store.receive('a1', { message: 'no title' })).toThrow()
    expect(asks()).toEqual([])
  })
})

let stop = (): void => undefined
afterEach(() => stop())

const folder = () => mkdtempSync(join(tmpdir(), 'alerts-'))

describe('watchAlerts', () => {
  it('hands over each file written into the folder and deletes it', async () => {
    const dir = folder()
    const received = new Promise<[string, unknown]>((resolve) => {
      stop = watchAlerts(dir, (id, raw) => resolve([id, raw]))
    })
    writeFileSync(join(dir, 'ci.json'), JSON.stringify(red))
    expect(await received).toEqual(['ci', red])
    // The file goes in the same watch callback, before this test resumes.
    expect(readdirSync(dir)).toEqual([])
  })

  it('picks up files written while the app was closed', () => {
    const dir = folder()
    writeFileSync(join(dir, 'night.json'), JSON.stringify(red))
    const received = vi.fn()
    stop = watchAlerts(dir, received)
    expect(received).toHaveBeenCalledWith('night', red)
  })
})

describe('watchAlerts, files it cannot use', () => {
  it('leaves a file that is not complete JSON yet, for the next write to finish', () => {
    const dir = folder()
    writeFileSync(join(dir, 'half.json'), '{"title": "CI')
    const received = vi.fn()
    stop = watchAlerts(dir, received)
    expect(received).not.toHaveBeenCalled()
    expect(existsSync(join(dir, 'half.json'))).toBe(true)
  })

  it('deletes a file the store refuses, so it is not read again', () => {
    const dir = folder()
    writeFileSync(join(dir, 'bad.json'), JSON.stringify({ message: 'no title' }))
    stop = watchAlerts(dir, () => {
      throw new Error('refused')
    })
    expect(existsSync(join(dir, 'bad.json'))).toBe(false)
  })
})
