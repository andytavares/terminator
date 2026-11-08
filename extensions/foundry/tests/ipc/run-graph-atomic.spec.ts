import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { writeRunGraph } from '../../src/ipc/run-channels.js'
import { emptyRunGraph } from '../helpers/run-nodes.js'
import { temporaryDirectory } from '../helpers/foundry-host.js'

// The Floor and the hall read run-graph.json while the Line saves it on every transition.

/** Set by a test to stop the next file write half way, until `release` resolves. */
let pauseNextWrite: { reached: () => void; release: Promise<void> } | null = null

// The seam: a write puts down its first bytes, then waits, so a reader runs mid-write every time.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const writeFile: typeof actual.writeFile = async (file, data, options) => {
    const pause = pauseNextWrite
    pauseNextWrite = null
    if (pause !== null) {
      await actual.writeFile(file, String(data).slice(0, 10), options)
      pause.reached()
      await pause.release
    }
    return actual.writeFile(file, data, options)
  }
  return { ...actual, default: { ...actual, writeFile }, writeFile }
})

afterEach(() => {
  pauseNextWrite = null
})

/** What a reader of the saved graph gets: its order id, or what went wrong parsing it. */
async function readGraphFile(file: string): Promise<string> {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8')).orderId
  } catch (error) {
    return `unreadable: ${String(error)}`
  }
}

describe('writeRunGraph', () => {
  it('shows a reader the whole earlier graph while a new one is half written', async () => {
    const root = temporaryDirectory('run-graph-atomic')
    const file = path.join(root, 'orders', 'WO-1', 'run-graph.json')
    await writeRunGraph(root, emptyRunGraph('WO-1'))
    let release = (): void => undefined
    const reached = new Promise<void>((resolve) => {
      pauseNextWrite = { reached: resolve, release: new Promise((r) => (release = r)) }
    })

    const saving = writeRunGraph(root, emptyRunGraph('WO-1'))
    await reached
    const read = await readGraphFile(file)
    release()
    await saving

    expect(read).toBe('WO-1')
  })
})
