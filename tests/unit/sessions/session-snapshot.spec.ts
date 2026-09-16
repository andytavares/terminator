import { describe, it, expect, vi } from 'vitest'

const workspace = vi.hoisted(() => ({
  projects: [
    { id: 'p1', workspaceId: 'w1', name: 'session-home', gitBranch: '054-session-home-wall' },
    { id: 'p2', workspaceId: 'w-gone', name: 'orphan' },
  ] as Array<Record<string, unknown>>,
  workspaces: [{ id: 'w1', name: 'terminator' }] as Array<Record<string, unknown>>,
}))

vi.mock('../../../src/main/storage/workspace-store.js', () => ({
  getProjectById: (id: string) => workspace.projects.find((p) => p.id === id),
  listWorkspaces: () => workspace.workspaces,
}))

import { makeSnapshotFor } from '../../../src/main/sessions/session-snapshot'

const session = (patch: Record<string, unknown> = {}) => ({
  sessionId: 's1',
  cwd: '/code/repo',
  type: 'human' as const,
  origin: 'app' as const,
  createdAt: '2026-09-15T10:00:00.000Z',
  pid: 1,
  projectId: 'p1',
  tabTitle: 'claude',
  ...patch,
})

const snapshotFor = (info: unknown) => makeSnapshotFor({ getSession: () => info as never })('s1')

describe('makeSnapshotFor', () => {
  it('describes a terminal by where it lives', () => {
    expect(snapshotFor(session())).toEqual({
      sessionId: 's1',
      projectId: 'p1',
      workspaceName: 'terminator',
      projectName: 'session-home',
      branch: '054-session-home-wall',
      tabTitle: 'claude',
      shell: null,
      startedAt: '2026-09-15T10:00:00.000Z',
    })
  })

  it('leaves out a branch a project does not have', () => {
    workspace.projects[0].gitBranch = undefined
    expect(snapshotFor(session())?.branch).toBeNull()
    workspace.projects[0].gitBranch = '054-session-home-wall'
  })

  it('describes a terminal whose repo has gone, without inventing one', () => {
    const snapshot = snapshotFor(session({ projectId: 'p2' }))
    expect(snapshot).toMatchObject({ projectId: 'p2', workspaceName: null, projectName: 'orphan' })
  })

  it('describes a terminal with no project at all', () => {
    expect(snapshotFor(session({ projectId: undefined, tabTitle: undefined }))).toMatchObject({
      projectId: '',
      projectName: null,
      workspaceName: null,
      tabTitle: '',
    })
  })

  it('is nothing for a terminal that has gone', () => {
    expect(snapshotFor(undefined)).toBeNull()
  })
})
