import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { fakeHost } from '../helpers/foundry-host.js'
import { startFoundryHomePublisher } from '../../src/home/publish.js'
import { readLiveStandings } from '../../src/ipc/standing.js'
import { eventually } from '../../../../tests/support/eventually'

vi.mock('../../src/ipc/standing.js', () => ({ readLiveStandings: vi.fn() }))
const feedCounter = vi.hoisted(() => ({ built: 0 }))
vi.mock('../../src/home/feed.js', () => ({
  buildFoundryHomeFeed: vi.fn(() => ({ built: ++feedCounter.built })),
}))

type Records = { orders: never[]; waiting: never[] }
let slowReads: Array<(records: Records) => void> = []
let rootsRead: string[] = []

beforeEach(() => {
  feedCounter.built = 0
  slowReads = []
  rootsRead = []
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.mocked(readLiveStandings).mockImplementation(
    (root) =>
      new Promise((resolve) => {
        rootsRead.push(root())
        slowReads.push(() => resolve({ orders: [], waiting: [] }))
      })
  )
})

afterEach(() => {
  vi.useRealTimers()
})

function publisherAt(roots: { current: string }) {
  const host = fakeHost(() => roots.current)
  const publisher = startFoundryHomePublisher(
    { api: host.api, dataRoot: () => roots.current },
    { standingSources: {} as never, decide: vi.fn() as never }
  )
  return { host, publisher }
}

/** Lets the index-th read finish; the rest of the feed is read from disk, so it is waited for. */
const finishRead = (index: number): void => slowReads[index]({ orders: [], waiting: [] })

const publishedInOrder = (host: ReturnType<typeof fakeHost>): number[] =>
  host.homePublish.mock.calls.map((call) => (call[0] as { built: number }).built)

describe('publishing to Home while a read is slow', () => {
  it('reads once at a time, then once more at the newest root, publishing the newer feed last', async () => {
    const roots = { current: '/records/first' }
    const { host, publisher } = publisherAt(roots)
    publisher.scheduleFoundryPublish()
    await vi.advanceTimersByTimeAsync(500)
    roots.current = '/records/second'
    publisher.scheduleFoundryPublish()
    await vi.advanceTimersByTimeAsync(2000)
    expect(rootsRead).toEqual(['/records/first'])
    finishRead(0)
    await eventually(() => expect(rootsRead).toEqual(['/records/first', '/records/second']))
    finishRead(1)
    await eventually(() => expect(host.homePublish).toHaveBeenCalledTimes(2))
    expect(publishedInOrder(host)).toEqual([1, 2])
  })
})

describe('disposing the publisher', () => {
  it('publishes nothing once disposed, whether the read was pending or running', async () => {
    const { host, publisher } = publisherAt({ current: '/records/first' })
    publisher.scheduleFoundryPublish()
    await vi.advanceTimersByTimeAsync(500)
    const stopped = publisher.dispose()
    publisher.scheduleFoundryPublish()
    finishRead(0)
    await vi.advanceTimersByTimeAsync(2000)
    await stopped
    expect(host.homePublish).not.toHaveBeenCalled()
    expect(rootsRead).toEqual(['/records/first'])
  })

  it('settles dispose only once the read in flight has ended', async () => {
    const { host, publisher } = publisherAt({ current: '/records/first' })
    publisher.scheduleFoundryPublish()
    await vi.advanceTimersByTimeAsync(500)
    const stopped = publisher.dispose()
    finishRead(0)
    await stopped
    // The feed is built at the end of the read: it has finished, and published nothing.
    expect(feedCounter.built).toBe(1)
    expect(host.homePublish).not.toHaveBeenCalled()
  })
})
