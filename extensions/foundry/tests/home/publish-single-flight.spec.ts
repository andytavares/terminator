import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { fakeHost } from '../helpers/foundry-host.js'
import { startFoundryHomePublisher } from '../../src/home/publish.js'
import { readLiveStandings } from '../../src/ipc/standing.js'

vi.mock('../../src/ipc/standing.js', () => ({ readLiveStandings: vi.fn() }))
vi.mock('../../src/home/feed.js', () => {
  let built = 0
  return { buildFoundryHomeFeed: vi.fn(() => ({ built: ++built })) }
})

type Records = { orders: never[]; waiting: never[] }
let slowReads: Array<(records: Records) => void> = []
let rootsRead: string[] = []

beforeEach(() => {
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
    await vi.waitFor(() => expect(rootsRead).toEqual(['/records/first', '/records/second']))
    finishRead(1)
    await vi.waitFor(() => expect(host.homePublish).toHaveBeenCalledTimes(2))
    expect(publishedInOrder(host)).toEqual([1, 2])
  })

  it('publishes nothing once disposed, whether the read was pending or running', async () => {
    const { host, publisher } = publisherAt({ current: '/records/first' })
    publisher.scheduleFoundryPublish()
    await vi.advanceTimersByTimeAsync(500)
    publisher.dispose()
    publisher.scheduleFoundryPublish()
    finishRead(0)
    await vi.advanceTimersByTimeAsync(2000)
    // The rest of the feed is read from disk; a publish would land well within this wait.
    await new Promise((resolve) => setImmediate(resolve))
    expect(host.homePublish).not.toHaveBeenCalled()
    expect(rootsRead).toEqual(['/records/first'])
  })
})
