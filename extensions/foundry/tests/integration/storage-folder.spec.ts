/**
 * Foundry's own folder, `api.paths.globalStorage` (ADR 103): a lane worktree that
 * moved with the records out of the shared userData folder, against real git.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { fakeHost, realGit, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'
import { activateFoundry, deactivate } from '../helpers/foundry-activation.js'
import type { FoundryHost } from '../helpers/foundry-host.js'
import { eventually } from '../../../../packages/test-support/src/eventually'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))

const userDataOf = (host: FoundryHost) => path.dirname(path.dirname(host.globalStorage))

afterEach(async () => {
  await deactivate()
})

describe('the first activation after the move to its own folder', () => {
  describe('lane worktrees', laneWorktreesTests)
})

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
    await eventually(async () => expect((await worktrees()).stdout).toContain(newLane))
    await realGit({ command: 'git', args: ['worktree', 'prune'], cwd: repo })
    expect((await worktrees()).stdout).toContain(newLane)
  })
}
