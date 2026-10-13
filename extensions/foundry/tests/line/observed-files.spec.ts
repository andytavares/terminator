import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { readObservedFiles, writeObservedFiles } from '../../src/line/observed-files.js'
import { computeQueueEntries } from '../../src/line/refinery-entries.js'
import { createOrderStore } from '../../src/order/store.js'
import { makeTempDir } from '../../../../tests/support/temp-dir'
import { runningOrder } from '../helpers/order-parts.js'

let root: string

beforeEach(() => {
  root = makeTempDir('fdry-observed-')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('the files an order has changed', () => {
  it('reads back what was recorded, each file once', async () => {
    await writeObservedFiles(root, 'WO-1', ['a.ts', 'b.ts', 'a.ts'])
    expect(await readObservedFiles(root, 'WO-1')).toEqual(['a.ts', 'b.ts'])
  })

  it('reads nothing for an order that recorded nothing', async () => {
    expect(await readObservedFiles(root, 'WO-1')).toEqual([])
  })

  it('reads nothing from a record that is not a list of paths', async () => {
    fs.mkdirSync(path.join(root, 'orders', 'WO-1'), { recursive: true })
    fs.writeFileSync(path.join(root, 'orders', 'WO-1', 'observed-files.json'), '{"oops":1}')
    expect(await readObservedFiles(root, 'WO-1')).toEqual([])
  })
})

describe('the queue entries read from records', () => {
  it('carries the recorded files, and the plan’s own touches when nothing was recorded', async () => {
    const store = createOrderStore(root)
    await store.save(runningOrder('WO-1', ['planned.ts']))
    await store.save(runningOrder('WO-2', ['planned.ts']))
    await writeObservedFiles(root, 'WO-1', ['changed.ts'])
    const entries = await computeQueueEntries(root, store)
    const filesOf = (id: string): readonly string[] | undefined =>
      entries.find((entry) => entry.orderId === id)?.files
    expect(filesOf('WO-1')).toEqual(['changed.ts'])
    expect(filesOf('WO-2')).toEqual(['planned.ts'])
  })

  it('leaves out an order that is not in flight', async () => {
    const store = createOrderStore(root)
    await store.save({ ...runningOrder('WO-1', ['a.ts']), status: 'agreed' })
    expect(await computeQueueEntries(root, store)).toEqual([])
  })
})
