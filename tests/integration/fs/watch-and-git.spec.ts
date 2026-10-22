import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { makeTempDir } from '../../support/temp-dir'
import { FsWatcherService, type FsChangeBatch } from '../../../src/main/fs/fs-watcher'
import { execShell } from '../../../src/main/shell/shell-executor'
import { getChangeStats } from '../../../src/main/git/git-service'
import { eventually } from '../../support/eventually'

// The Git tab reads status when the watch reports a change. `git status` and `git diff` rewrite
// `.git/index` unless told not to (https://git-scm.com/docs/git-status#_background_refresh), which
// is a change in the watched tree: the read would ask for itself again.

const FENCE = 'fence.txt'
/** Looks less often than a burst takes to settle, or each look's write would keep it open. */
const LOOK_INTERVAL_MS = 250

function repositoryWithOneTrackedFile(): string {
  const repo = makeTempDir('status-read-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.test')
  git('config', 'user.name', 'Test')
  fs.writeFileSync(path.join(repo, 'tracked.txt'), 'one\n')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  return repo
}

/** An editor saving a file with the content it had: git must read it again to know. */
function saveUnchanged(repo: string): void {
  const later = new Date(Date.now() + 60_000)
  fs.utimesSync(path.join(repo, 'tracked.txt'), later, later)
}

const service = new FsWatcherService()
let stop: () => void = () => undefined
afterEach(() => stop())

/** Watches `repo`, reading with `read` on every reported change but the fence's, as the Git tab
 * reads status. Resolves with how many reads one save caused. */
async function readsAfterOneSave(repo: string, read: () => Promise<unknown>): Promise<number> {
  const batches: FsChangeBatch[] = []
  let reads = 0
  let following = false
  const listener = (batch: FsChangeBatch) => {
    batches.push(batch)
    if (following && batch.filenames.some((name) => name !== FENCE)) reads += 1
  }
  service.watch(repo, listener)
  stop = () => service.unwatch(listener)
  await passFence(repo, batches)
  following = true
  saveUnchanged(repo)
  await eventually(() => expect(reads).toBeGreaterThan(0))
  await read()
  await passFence(repo, batches)
  return reads
}

/** Writes the fence file until a batch names it. What the watch saw before the fence was written
 * is reported no later than the fence is, so everything earlier has arrived. Written again on
 * each look because macOS arms a watch a moment after `fs.watch` returns. */
async function passFence(repo: string, batches: FsChangeBatch[]): Promise<void> {
  const from = batches.length
  await expect
    .poll(
      () => {
        const passed = batches.slice(from).some((batch) => batch.filenames.includes(FENCE))
        if (!passed) fs.writeFileSync(path.join(repo, FENCE), String(Math.random()))
        return passed
      },
      { interval: LOOK_INTERVAL_MS }
    )
    .toBe(true)
}

describe('git commands run outside the app', () => {
  it('git add is reported every time, though it changes only the index', async () => {
    const repo = repositoryWithOneTrackedFile()
    for (const name of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(repo, name), name)
    const batches: FsChangeBatch[] = []
    const listener = (batch: FsChangeBatch) => batches.push(batch)
    service.watch(repo, listener)
    stop = () => service.unwatch(listener)
    const index = path.join('.git', 'index')
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      await passFence(repo, batches)
      const from = batches.length
      execFileSync('git', ['add', name], { cwd: repo })
      const namesIndex = () => batches.slice(from).some((batch) => batch.filenames.includes(index))
      await eventually(() => expect(namesIndex()).toBe(true))
    }
  })
})

describe('the app’s own git reads', () => {
  it('status, as an extension runs it, is read once for one saved file', async () => {
    const repo = repositoryWithOneTrackedFile()
    const status = () =>
      execShell({ command: 'git', args: ['status', '--porcelain=v1', '-z'], cwd: repo })
    expect(await readsAfterOneSave(repo, status)).toBe(1)
  })

  it('the sidebar’s change count is read once for one saved file', async () => {
    const repo = repositoryWithOneTrackedFile()
    expect(await readsAfterOneSave(repo, () => getChangeStats(repo))).toBe(1)
  })
})
