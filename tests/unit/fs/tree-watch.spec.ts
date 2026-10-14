import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import { nextLoopTurn, openWatches } from '../../support/watches'
import {
  isUnwatchedPath,
  watchDirectoryTree,
  watchNativeRecursive,
  type TreeWatch,
} from '../../../src/main/fs/tree-watch'

// Node's own recursive watch on Linux is the one this module replaces, so it is not run there.
const implementations: Array<[string, TreeWatch]> = [
  ['one watch per directory', watchDirectoryTree],
  ...(process.platform === 'linux'
    ? []
    : [['the platform’s recursive watch', watchNativeRecursive] as [string, TreeWatch]]),
]

let stop: (() => void) | undefined
afterEach(() => stop?.())

/** A watched temporary tree and every path the watch has reported. */
function watched(watchTree: TreeWatch): { root: string; reported: Array<string | null> } {
  const root = makeTempDir('tree-watch-')
  fs.mkdirSync(path.join(root, 'src', 'deep'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules', 'package'), { recursive: true })
  const reported: Array<string | null> = []
  stop = watchTree(root, { onChange: (_type, changed) => reported.push(changed), onError: vi.fn() })
  return { root, reported }
}

/** Makes the change again on each look: macOS arms a watch a moment after `fs.watch` returns, and
 * a change made before that has no event. */
async function reportedAfter(change: () => void, reported: unknown[], expected: string) {
  await vi.waitFor(() => {
    change()
    expect(reported).toContain(expected)
  })
}

describe.each(implementations)('watching a tree with %s', (_name, watchTree) => {
  it('reports a file written in a nested directory', async () => {
    const { root, reported } = watched(watchTree)
    const file = path.join(root, 'src', 'deep', 'a.ts')
    await reportedAfter(() => fs.writeFileSync(file, String(Math.random())), reported, file)
  })

  it('reports a file replaced by a rename, every time it is replaced', async () => {
    const { root, reported } = watched(watchTree)
    const index = path.join(root, 'src', 'index')
    const replace = () => {
      fs.writeFileSync(`${index}.lock`, String(Math.random()))
      fs.renameSync(`${index}.lock`, index)
    }
    for (let round = 0; round < 3; round++) {
      reported.length = 0
      await reportedAfter(replace, reported, index)
    }
  })
})

describe.each(implementations)('watching a tree that grows with %s', (_name, watchTree) => {
  it('reports a file written in a directory made after the watch started', async () => {
    const { root, reported } = watched(watchTree)
    const files: string[] = []
    // A new directory on each look, for the same reason; each earlier one is written in again.
    const makeAnotherAndWriteInAll = () => {
      files.push(path.join(root, `later-${files.length}`, 'nested', 'b.ts'))
      fs.mkdirSync(path.dirname(files.at(-1)!), { recursive: true })
      for (const file of files) fs.writeFileSync(file, String(Math.random()))
    }
    await vi.waitFor(() => {
      makeAnotherAndWriteInAll()
      expect(reported.filter((changed) => changed?.endsWith('b.ts'))).not.toEqual([])
    })
  })

  it('reports nothing under node_modules', async () => {
    const { root, reported } = watched(watchTree)
    const fence = path.join(root, 'fence.txt')
    const write = () => {
      fs.writeFileSync(path.join(root, 'node_modules', 'package', 'index.js'), '1')
      fs.writeFileSync(fence, String(Math.random()))
    }
    await reportedAfter(write, reported, fence)
    expect(reported.filter((changed) => changed?.includes('node_modules'))).toEqual([])
  })

  it('throws for a directory that is not there', () => {
    const missing = path.join(makeTempDir('tree-watch-'), 'missing')
    expect(() => watchTree(missing, { onChange: vi.fn(), onError: vi.fn() })).toThrow()
  })
})

describe('watching a tree with one watch per directory', () => {
  it('closes every watch it opened when it stops', async () => {
    await nextLoopTurn()
    const before = openWatches()
    const { root } = watched(watchDirectoryTree)
    expect(openWatches()).toBe(before + 3)
    fs.rmSync(path.join(root, 'src'), { recursive: true })
    stop?.()
    await nextLoopTurn()
    expect(openWatches()).toBe(before)
  })
})

describe('isUnwatchedPath', () => {
  it.each([
    ['/repo/node_modules', true],
    ['/repo/packages/ui/node_modules/react/index.js', true],
    ['/repo/.git/objects/ab/cdef', true],
    ['/repo/.git/index', false],
    ['/repo/.git/refs/heads/main', false],
    ['/repo/src/objects/a.ts', false],
    ['/repo/src/node_modules.ts', false],
  ])('%s → %s', (target, unwatched) => {
    expect(isUnwatchedPath(target.split('/').join(path.sep))).toBe(unwatched)
  })
})
