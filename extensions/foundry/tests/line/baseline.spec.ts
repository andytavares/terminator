import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ExtensionAPI } from '@terminator/extension-sdk'

import { runOnFreshBase } from '../../src/line/baseline.js'
import type { BaselineDeps } from '../../src/line/baseline.js'
import { projectRemover } from '../../src/line/order-project.js'
import { checkoutPath } from '../../src/line/worktree.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { partialFake } from '../../../../tests/support/fakes'
import { realGit, seededRepository, temporaryDirectory } from '../helpers/foundry-host.js'

// Commands run on a fresh checkout of the base branch for the operator's Prove (ADR 137).

let parent: string
let repo: string

beforeEach(async () => {
  parent = temporaryDirectory('baseline')
  repo = await seededRepository(parent)
})

afterEach(() => {
  fs.rmSync(parent, { recursive: true, force: true })
})

function orderOn(repoPath: string): WorkOrder {
  return draftOrder({
    id: 'WO-1',
    title: 'x',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: [repoPath],
    now: '2026-09-06T10:00:00.000Z',
  })
}

type Project = { id: string; worktreePath: string }

/** A workspace that keeps its projects, as the host does. */
function statefulWorkspace(projects: Project[]): ExtensionAPI['workspace'] {
  return partialFake<ExtensionAPI['workspace']>({
    list: () => [{ id: 'workspace-1' }] as ReturnType<ExtensionAPI['workspace']['list']>,
    listProjects: () => projects as ReturnType<ExtensionAPI['workspace']['listProjects']>,
    deleteProject: (id: string) => {
      projects.splice(
        projects.findIndex((p) => p.id === id),
        1
      )
    },
  })
}

function harness(projects: Project[] = []) {
  const places: string[] = []
  const removed: string[] = []
  const remove = projectRemover(statefulWorkspace(projects))
  const deps: BaselineDeps = {
    root: path.join(parent, 'data'),
    now: () => '2026-09-06T10:00:00.000Z',
    exec: realGit,
    workspaceOf: () => 'workspace-1',
    record: async () => undefined,
    // Running in a checkout opens a sidebar project for it, as the supervised runner does.
    runCommand: async ({ worktreePath, command, logPath }) => {
      places.push(worktreePath)
      projects.push({ id: `project-${projects.length}`, worktreePath })
      if (logPath !== undefined) fs.writeFileSync(logPath, '')
      return command === 'false' ? 1 : 0
    },
    removeProjectAt: (worktreePath) => {
      removed.push(worktreePath)
      return remove(worktreePath)
    },
  }
  return { deps, places, removed }
}

describe('runOnFreshBase', () => {
  it('runs each command on a @baseline checkout and answers its exit code', async () => {
    const h = harness()
    const order = orderOn(repo)
    const run = await runOnFreshBase(order, h.deps, ['true', 'false'])
    expect(run.exitCodes).toEqual({ true: 0, false: 1 })
    expect(run.commit).toMatch(/^[0-9a-f]{40}$/)
    const checkout = `${checkoutPath(h.deps.root, order, 'app')}@baseline`
    expect(h.places).toEqual([checkout, checkout])
  })

  it('removes the checkout and its sidebar project when the commands end', async () => {
    const projects: Project[] = []
    const h = harness(projects)
    const order = orderOn(repo)
    await runOnFreshBase(order, h.deps, ['true'])
    const checkout = `${checkoutPath(h.deps.root, order, 'app')}@baseline`
    expect(h.removed).toEqual([checkout])
    expect(fs.existsSync(checkout)).toBe(false)
    expect(projects.filter((p) => p.worktreePath === checkout)).toEqual([])
  })

  it('removes a project already open on the checkout even when no command ran', async () => {
    const order = orderOn(repo)
    const checkout = `${checkoutPath(path.join(parent, 'data'), order, 'app')}@baseline`
    const projects: Project[] = [{ id: 'left-over', worktreePath: checkout }]
    await runOnFreshBase(order, harness(projects).deps, [])
    expect(projects).toEqual([])
  })
})
