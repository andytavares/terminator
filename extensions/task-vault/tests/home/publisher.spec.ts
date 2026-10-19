import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExtensionAPI, ExtensionDB, HomeFeed } from '@terminator/extension-sdk'
import { partialFake } from '../../../../tests/support/fakes'
import { createVaultDb, seedTask, selectTaskRow } from '../support/vault-db'
import { startHomePublisher } from '../../src/home/publisher'
import { startOrResumeReview } from '../../src/vault/weekly-review-repository'

vi.mock('../../src/navigation.js', () => ({ openInVault: vi.fn() }))
vi.mock('../../src/notifications/task-scheduler.js', () => ({ broadcast: vi.fn() }))

const NOW = new Date(2026, 9, 18, 10, 0, 0) // Sunday 18 October 2026, local time

function fakeVaultApi(reviewDay = '3') {
  const published: HomeFeed[] = []
  let actionHandler: (itemId: string, actionId: string) => Promise<void> = async () => {}
  const api = partialFake<ExtensionAPI>({
    settings: partialFake<ExtensionAPI['settings']>({
      get: <T>() => reviewDay as T,
    }),
    home: {
      publish: (feed) => void published.push(feed),
      onAction: (handler) => {
        actionHandler = handler
        return { dispose: vi.fn() }
      },
    },
  })
  return {
    api,
    published,
    pressHomeAction: (item: string, action: string) => actionHandler(item, action),
  }
}

let db: ExtensionDB
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(NOW)
  db = await createVaultDb()
})
afterEach(() => vi.useRealTimers())

describe('the Home publisher feed', () => {
  it('publishes the due and Today tasks 500 ms after a change, once for a burst', async () => {
    await seedTask(db, { id: 'due', dueDate: '2026-10-18' })
    const { api, published } = fakeVaultApi()
    const publisher = startHomePublisher(api, db)

    publisher.schedule()
    publisher.schedule()
    await vi.advanceTimersByTimeAsync(499)
    expect(published).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)

    expect(published).toHaveLength(1)
    expect(published[0].asks.map((a) => a.id)).toEqual(['task:due'])
  })

  it('asks for the weekly review on the review day until one is started', async () => {
    const { api, published } = fakeVaultApi('0')
    const publisher = startHomePublisher(api, db)

    publisher.schedule()
    await vi.advanceTimersByTimeAsync(500)
    expect(published[0].asks.map((a) => a.id)).toEqual(['weekly-review'])

    await startOrResumeReview(db, NOW.toISOString())
    publisher.schedule()
    await vi.advanceTimersByTimeAsync(500)
    expect(published[1].asks).toEqual([])
  })
})

describe('the Home publisher date rollover', () => {
  it('rolls "today" over at local midnight without any other change', async () => {
    await seedTask(db, { id: 'tomorrow', dueDate: '2026-10-19' })
    const { api, published } = fakeVaultApi()
    startHomePublisher(api, db)

    await vi.advanceTimersByTimeAsync(14 * 3600 * 1000 + 500) // past midnight and the debounce
    expect(published.at(-1)?.asks.map((a) => a.id)).toEqual(['task:tomorrow'])
  })
})

describe('the Home publisher actions', () => {
  it('completes the right task when "done" is pressed, and leaves the others open', async () => {
    await seedTask(db, { id: 'a', dueDate: '2026-10-18' })
    await seedTask(db, { id: 'b', dueDate: '2026-10-18' })
    const { api, pressHomeAction } = fakeVaultApi()
    startHomePublisher(api, db)

    await pressHomeAction('task:b', 'done')

    expect((await selectTaskRow(db, 'b'))?.status).toBe('done')
    expect((await selectTaskRow(db, 'a'))?.status).toBe('open')
  })

  it('opens the vault on the task for "open" and on the review for "start-review"', async () => {
    const { openInVault } = await import('../../src/navigation.js')
    const { api, pressHomeAction } = fakeVaultApi()
    startHomePublisher(api, db)

    await pressHomeAction('task:a', 'open')
    expect(openInVault).toHaveBeenCalledWith(api, { taskId: 'a' })
    await pressHomeAction('weekly-review', 'start-review')
    expect(openInVault).toHaveBeenCalledWith(api, { view: 'review' })
  })
})

describe('the Home publisher lifetime', () => {
  it('stops publishing once disposed', async () => {
    const { api, published } = fakeVaultApi()
    const publisher = startHomePublisher(api, db)
    publisher.schedule()
    publisher.dispose()
    await vi.advanceTimersByTimeAsync(24 * 3600 * 1000)
    expect(published).toHaveLength(0)
  })
})
