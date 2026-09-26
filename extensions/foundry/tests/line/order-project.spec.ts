import { describe, it, expect, vi } from 'vitest'
import { issueOf, projectRemover, workspaceFor } from '../../src/line/order-project.js'
import { draftOrder } from '../../src/order/schema.js'
import type { OrderSource } from '../../src/order/schema.js'

// One project per order (spec 061): in the repository's own workspace, linked
// to the order's ticket, and gone when its checkout goes.

function order(source: OrderSource) {
  return draftOrder({
    id: 'WO-1',
    title: 'x',
    source,
    repoPaths: ['/repos/a'],
    now: '2026-09-26T10:00:00.000Z',
  })
}

describe('workspaceFor', () => {
  const workspaces = [
    { id: 'ws-other', folderPath: '/repos/other' },
    { id: 'ws-a', folderPath: '/repos/a' },
  ]

  it("files the project under the repository's own workspace, not the first one", () => {
    expect(workspaceFor(workspaces, '/repos/a')).toBe('ws-a')
  })

  it('ignores a trailing slash on either side', () => {
    expect(workspaceFor([{ id: 'ws-a', folderPath: '/repos/a/' }], '/repos/a')).toBe('ws-a')
  })

  it('falls back to the first workspace when no workspace is that repository', () => {
    expect(workspaceFor(workspaces, '/repos/unknown')).toBe('ws-other')
  })

  it('is empty when there are no workspaces at all', () => {
    expect(workspaceFor([], '/repos/a')).toBe('')
  })
})

describe('issueOf', () => {
  it("is the order's ticket when it was seeded from one", () => {
    const o = order({ kind: 'tracker', tracker: 'linear', key: 'TAV-15', url: 'u' })
    expect(issueOf(o)).toEqual({ tracker: 'linear', key: 'TAV-15' })
  })

  it('is nothing for a typed order', () => {
    expect(issueOf(order({ kind: 'typed', tracker: null, key: null, url: null }))).toBeUndefined()
  })
})

describe('projectRemover', () => {
  function workspace() {
    const deleteProject = vi.fn()
    return {
      deleteProject,
      api: {
        list: () => [
          { id: 'ws-1', folderPath: '/repos/a' },
          { id: 'ws-2', folderPath: '/repos/b' },
        ],
        listProjects: (id: string) =>
          id === 'ws-2'
            ? [
                { id: 'p-main', workspaceId: 'ws-2', name: 'main' },
                { id: 'p-wt', workspaceId: 'ws-2', name: 'x', worktreePath: '/data/wt/b' },
              ]
            : [],
        deleteProject,
      },
    }
  }

  it('deletes the project pointing at the checkout, in whichever workspace holds it', () => {
    const { api, deleteProject } = workspace()
    expect(projectRemover(api)('/data/wt/b')).toBe(true)
    expect(deleteProject).toHaveBeenCalledWith('p-wt')
    expect(deleteProject).toHaveBeenCalledTimes(1)
  })

  it('deletes nothing and says so when no project points there', () => {
    const { api, deleteProject } = workspace()
    expect(projectRemover(api)('/data/wt/none')).toBe(false)
    expect(deleteProject).not.toHaveBeenCalled()
  })
})
