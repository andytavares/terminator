import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { FsWatcherService, type FsChangeBatch } from '../../../src/main/fs/fs-watcher'
import type { TreeWatch, TreeWatchHandlers } from '../../../src/main/fs/tree-watch'

const TIMING = { settleMs: 100, maxWaitMs: 1000, pollMs: 3000 }

/** A tree watch the spec drives: what each open watch reports is what the spec tells it to. */
function fakeTrees() {
  const open = new Map<string, TreeWatchHandlers>()
  let refuses = false
  const watchTree: TreeWatch = (root, handlers) => {
    if (refuses) throw new Error('ENOSPC')
    open.set(root, handlers)
    return () => open.delete(root)
  }
  return {
    watchTree,
    open,
    refuseToStart: () => (refuses = true),
    change: (root: string, name: string | null, type: 'change' | 'rename' = 'change') =>
      open.get(root)?.onChange(type, name === null ? null : join(root, name)),
  }
}

let trees: ReturnType<typeof fakeTrees>
let service: FsWatcherService

/** A listener and the batches it has been given. */
function listening(root: string): {
  batches: FsChangeBatch[]
  listener: (b: FsChangeBatch) => void
} {
  const batches: FsChangeBatch[] = []
  const listener = (batch: FsChangeBatch) => batches.push(batch)
  service.watch(root, listener)
  return { batches, listener }
}

beforeEach(() => {
  vi.useFakeTimers()
  trees = fakeTrees()
  service = new FsWatcherService(TIMING, trees.watchTree)
})

afterEach(() => vi.useRealTimers())

describe('FsWatcherService — one change', () => {
  it('tells the listener once the tree has been quiet, naming the file from the root', () => {
    const { batches } = listening('/repo')
    trees.change('/repo', join('src', 'a.ts'))
    expect(batches).toEqual([])
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches).toEqual([
      { projectRoot: '/repo', eventType: 'change', filenames: [join('src', 'a.ts')] },
    ])
  })

  it('says rename when a file appeared or went', () => {
    const { batches } = listening('/repo')
    trees.change('/repo', 'a.ts', 'change')
    trees.change('/repo', 'b.ts', 'rename')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches.map((batch) => batch.eventType)).toEqual(['rename'])
  })

  it('passes on a change the platform did not name', () => {
    const { batches } = listening('/repo')
    trees.change('/repo', null)
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches.map((batch) => batch.filenames)).toEqual([[null]])
  })
})

describe('FsWatcherService — a burst of changes', () => {
  it('tells the listener once for a thousand files changed together', () => {
    const { batches } = listening('/repo')
    for (let file = 0; file < 1000; file++) trees.change('/repo', `file-${file}.ts`)
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches).toHaveLength(1)
    expect(batches[0].filenames).toHaveLength(1000)
  })

  it('names a file changed many times once', () => {
    const { batches } = listening('/repo')
    for (let write = 0; write < 5; write++) trees.change('/repo', 'a.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches.map((batch) => batch.filenames)).toEqual([['a.ts']])
  })

  it('does not wait for quiet longer than the limit while changes keep coming', () => {
    const { batches } = listening('/repo')
    for (let elapsed = 0; elapsed < TIMING.maxWaitMs; elapsed += 50) {
      trees.change('/repo', 'install.log')
      vi.advanceTimersByTime(50)
    }
    expect(batches).toHaveLength(1)
  })
})

describe('FsWatcherService — after a burst', () => {
  it('tells the listener again for a change made after the burst was reported', () => {
    const { batches } = listening('/repo')
    trees.change('/repo', 'a.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    trees.change('/repo', 'b.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches.map((batch) => batch.filenames)).toEqual([['a.ts'], ['b.ts']])
  })
})

describe('FsWatcherService — several listeners', () => {
  it('tells each listener about its own root only', () => {
    const first = listening('/repo-a')
    const second = listening('/repo-b')
    trees.change('/repo-a', 'a.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(first.batches).toHaveLength(1)
    expect(second.batches).toEqual([])
  })

  it('opens one watch for a root two listeners share, and tells both', () => {
    const first = listening('/repo')
    const second = listening('/repo')
    trees.change('/repo', 'a.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect([first.batches.length, second.batches.length]).toEqual([1, 1])
    expect([...trees.open.keys()]).toEqual(['/repo'])
  })

  it('tells a listener once however many times it asks for the same root', () => {
    const { batches, listener } = listening('/repo')
    service.watch('/repo', listener)
    trees.change('/repo', 'a.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches).toHaveLength(1)
  })
})

describe('FsWatcherService — a listener that throws', () => {
  it('keeps telling the others when one listener throws', () => {
    service.watch('/repo', () => {
      throw new Error('listener failed')
    })
    const { batches } = listening('/repo')
    trees.change('/repo', 'a.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches).toHaveLength(1)
  })
})

describe('FsWatcherService — a listener that stops', () => {
  it('leaves the other listener of the same root watching', () => {
    const first = listening('/repo')
    const second = listening('/repo')
    service.unwatch(first.listener)
    trees.change('/repo', 'a.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(first.batches).toEqual([])
    expect(second.batches).toHaveLength(1)
  })

  it('stops every root it watched, and closes a watch nobody listens to', () => {
    const { batches, listener } = listening('/repo-a')
    service.watch('/repo-b', listener)
    const other = listening('/repo-b')
    service.unwatch(listener)
    expect([...trees.open.keys()]).toEqual(['/repo-b'])
    trees.change('/repo-b', 'b.ts')
    vi.advanceTimersByTime(TIMING.settleMs)
    expect(batches).toEqual([])
    expect(other.batches).toHaveLength(1)
  })

  it('is not told about a change it stopped before hearing of', () => {
    const { batches, listener } = listening('/repo')
    trees.change('/repo', 'a.ts')
    service.unwatch(listener)
    vi.advanceTimersByTime(TIMING.maxWaitMs)
    expect(batches).toEqual([])
  })
})

describe('FsWatcherService — a tree that cannot be watched', () => {
  it('reports an unnamed change on an interval when the watch cannot start', () => {
    trees.refuseToStart()
    const { batches } = listening('/repo')
    vi.advanceTimersByTime(TIMING.pollMs * 2)
    expect(batches).toEqual([
      { projectRoot: '/repo', eventType: 'change', filenames: [null] },
      { projectRoot: '/repo', eventType: 'change', filenames: [null] },
    ])
  })

  it('does the same from the moment a running watch fails, and closes it', () => {
    const { batches } = listening('/repo')
    trees.open.get('/repo')!.onError(new Error('EMFILE'))
    expect([...trees.open.keys()]).toEqual([])
    vi.advanceTimersByTime(TIMING.pollMs)
    expect(batches).toHaveLength(1)
  })

  it('stops reporting when its last listener stops', () => {
    trees.refuseToStart()
    const { batches, listener } = listening('/repo')
    service.unwatch(listener)
    vi.advanceTimersByTime(TIMING.pollMs * 2)
    expect(batches).toEqual([])
  })
})
