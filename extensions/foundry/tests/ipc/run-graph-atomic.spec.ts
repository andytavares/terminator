import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect } from 'vitest'
import { writeRunGraph } from '../../src/ipc/run-channels.js'
import { emptyRunGraph } from '../helpers/run-nodes.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'

// The Floor and the hall read run-graph.json while the Line saves it on every transition.

/** What a reader of the saved graph gets: its text, or what went wrong parsing it. */
async function readGraphFile(file: string): Promise<string> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')).orderId
  } catch (error) {
    return `unreadable: ${String(error)}`
  }
}

describe('writeRunGraph', () => {
  it('never shows a reader a half-written graph while it is being saved', async () => {
    const root = temporaryDirectory('run-graph-atomic')
    const file = path.join(root, 'orders', 'WO-1', 'run-graph.json')
    await writeRunGraph(root, emptyRunGraph('WO-1'))
    const seen: string[] = []
    for (let round = 0; round < 20; round++) {
      const [, read] = await Promise.all([
        writeRunGraph(root, emptyRunGraph('WO-1')),
        readGraphFile(file),
      ])
      seen.push(read)
    }
    expect(seen.filter((read) => read !== 'WO-1')).toEqual([])
  })
})
