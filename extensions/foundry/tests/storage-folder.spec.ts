/**
 * Foundry's own folder, `api.paths.globalStorage` (ADR 103): the fallback
 * records and the runtime state live there, and the first activation moves
 * what earlier builds left in the shared userData folder.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, realGit, seededRepository, temporaryDirectory } from './helpers/foundry-host.js'
import { activateFoundry, deactivate } from './helpers/foundry-activation.js'
import type { FoundryHost } from './helpers/foundry-host.js'
import { resolveFoundryDataRoot } from '../src/workspace-root.js'
import { writeFileWithDirs } from './helpers/files.js'

vi.mock('../src/runtime/supervised-runner.js', () => import('./helpers/supervision-mocks.js'))
vi.mock('../src/runtime/control-server.js', () => import('./helpers/supervision-mocks.js'))

const userDataOf = (host: FoundryHost) => path.dirname(path.dirname(host.globalStorage))

afterEach(async () => {
  deactivate()
})

describe('with no workspace open and no data directory set', () => {
  it('keeps its records in its own folder, not in userData', async () => {
    const host = fakeHost(() => '')
    await activateFoundry(host)

    expect(resolveFoundryDataRoot(host.api)).toBe(
      path.join(host.globalStorage, 'records', '.foundry')
    )
  })
})

describe('the first activation after the move to its own folder', () => {
  describe('moving the records', movingTheRecordsTests)
  describe('records already moved', recordsAlreadyMovedTests)
  describe('lane worktrees', laneWorktreesTests)
})

function movingTheRecordsTests() {
  it('moves the records and the runtime state out of userData', async () => {
    const host = fakeHost(() => '')
    const userData = userDataOf(host)
    writeFileWithDirs(
      path.join(userData, 'foundry', '.foundry', 'orders', 'WO-1', 'ledger.jsonl'),
      '{"n":1}\n'
    )
    writeFileWithDirs(path.join(userData, 'foundry-runtime', 'mutes.json'), '[]')

    await activateFoundry(host)

    const records = path.join(host.globalStorage, 'records', '.foundry')
    expect(fs.readFileSync(path.join(records, 'orders', 'WO-1', 'ledger.jsonl'), 'utf8')).toBe(
      '{"n":1}\n'
    )
    expect(fs.readFileSync(path.join(host.globalStorage, 'runtime', 'mutes.json'), 'utf8')).toBe(
      '[]'
    )
    expect(fs.existsSync(path.join(userData, 'foundry'))).toBe(false)
    expect(fs.existsSync(path.join(userData, 'foundry-runtime'))).toBe(false)
  })
}

function recordsAlreadyMovedTests() {
  it('keeps the records already in its folder and leaves the old ones where they are', async () => {
    const host = fakeHost(() => '')
    const old = path.join(userDataOf(host), 'foundry', '.foundry', 'orders', 'WO-1', 'ledger.jsonl')
    const kept = path.join(
      host.globalStorage,
      'records',
      '.foundry',
      'orders',
      'WO-2',
      'ledger.jsonl'
    )
    writeFileWithDirs(old, 'old')
    writeFileWithDirs(kept, 'new')

    await activateFoundry(host)

    expect(fs.readFileSync(old, 'utf8')).toBe('old')
    expect(fs.readFileSync(kept, 'utf8')).toBe('new')
    expect(host.api.log.warn).toHaveBeenCalledWith(
      expect.stringContaining(path.join(userDataOf(host), 'foundry'))
    )
  })
}

function laneWorktreesTests() {
  it('reconnects a lane worktree that moved with the records to its repository', async () => {
    const host = fakeHost(() => '')
    const repo = await seededRepository(temporaryDirectory('fdry-moved-lane'), 'widgets')
    const lane = ['.foundry', 'orders', 'WO-1', 'worktrees', 'widgets']
    const oldLane = path.join(userDataOf(host), 'foundry', ...lane)
    fs.mkdirSync(path.dirname(oldLane), { recursive: true })
    await realGit({ command: 'git', args: ['worktree', 'add', '-q', oldLane], cwd: repo })

    await activateFoundry(host)

    const newLane = fs.realpathSync(path.join(host.globalStorage, 'records', ...lane))
    const worktrees = () =>
      realGit({ command: 'git', args: ['worktree', 'list', '--porcelain'], cwd: repo })
    await vi.waitFor(async () => expect((await worktrees()).stdout).toContain(newLane))
    await realGit({ command: 'git', args: ['worktree', 'prune'], cwd: repo })
    expect((await worktrees()).stdout).toContain(newLane)
  })
}
