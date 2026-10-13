import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { SessionInfo } from '@terminator/extension-sdk'
import type { Project, SessionSnapshot } from '../../../src/shared/types/index'
import { makeTempDir } from '../../support/temp-dir'

let userData: string

vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('electron-store', async () =>
  (await import('../../support/stores')).inMemoryElectronStore()
)

type WorkspaceStore = typeof import('../../../src/main/storage/workspace-store')
type RecordStore = typeof import('../../../src/main/sessions/session-record-store')

let workspaces: WorkspaceStore
let records: RecordStore
let makeSnapshotFor: typeof import('../../../src/main/sessions/session-snapshot').makeSnapshotFor

beforeEach(async () => {
  vi.resetModules()
  userData = makeTempDir('session-snapshot-')
  workspaces = await import('../../../src/main/storage/workspace-store')
  records = await import('../../../src/main/sessions/session-record-store')
  ;({ makeSnapshotFor } = await import('../../../src/main/sessions/session-snapshot'))
})

function addSnapshotProject(gitBranch?: string): Project {
  const created = workspaces.createWorkspace({
    name: 'terminator',
    folderPath: '/code/terminator',
    color: '#4A90E2',
    tags: [],
  })
  if (!('workspace' in created)) throw new Error(created.error)
  const added = workspaces.createProject({
    workspaceId: created.workspace.id,
    name: 'session-home',
    gitBranch,
    isWorktree: false,
  })
  if (!('project' in added)) throw new Error(added.error)
  return added.project
}

const session = (patch: Partial<SessionInfo> = {}): SessionInfo => ({
  sessionId: 's1',
  cwd: '/code/repo',
  type: 'human',
  origin: 'app',
  createdAt: '2026-09-15T10:00:00.000Z',
  pid: 1,
  tabTitle: 'claude',
  ...patch,
})

const snapshotFor = (info: SessionInfo | undefined) =>
  makeSnapshotFor({ getSession: () => info })('s1')

describe('makeSnapshotFor', () => {
  it('describes a terminal by where it lives', () => {
    const project = addSnapshotProject('054-session-home-wall')
    expect(snapshotFor(session({ projectId: project.id }))).toEqual({
      sessionId: 's1',
      projectId: project.id,
      workspaceName: 'terminator',
      projectName: 'session-home',
      branch: '054-session-home-wall',
      tabTitle: 'claude',
      shell: null,
      startedAt: '2026-09-15T10:00:00.000Z',
    })
  })

  it('leaves out a branch a project does not have', () => {
    const project = addSnapshotProject()
    expect(snapshotFor(session({ projectId: project.id }))?.branch).toBeNull()
  })
})

describe('makeSnapshotFor — missing projects', () => {
  it('describes a terminal whose project has gone, without inventing one', () => {
    const project = addSnapshotProject()
    workspaces.deleteProject(project.id)
    expect(snapshotFor(session({ projectId: project.id }))).toMatchObject({
      projectId: project.id,
      workspaceName: null,
      projectName: null,
    })
  })

  it('describes a terminal with no project at all', () => {
    expect(snapshotFor(session({ projectId: undefined, tabTitle: undefined }))).toMatchObject({
      projectId: '',
      projectName: null,
      workspaceName: null,
      tabTitle: '',
    })
  })
})

describe('makeSnapshotFor — terminals that have gone', () => {
  // The premise of the whole feature: a conversation outlives its terminal. A
  // report that lands after the terminal died — the agent's own exit is what
  // ends it — must still attach to the session it names.
  it('falls back to what is already recorded about a terminal that has gone', async () => {
    const recorded: SessionSnapshot = {
      sessionId: 's1',
      projectId: 'p1',
      workspaceName: 'terminator',
      projectName: 'session-home',
      branch: '054-session-home-wall',
      tabTitle: 'claude',
      shell: '/bin/zsh',
      startedAt: '2026-09-15T10:00:00.000Z',
    }
    await records.setDescription(recorded, 'why')
    expect(snapshotFor(undefined)).toEqual(recorded)
  })

  it('is nothing for a terminal that has gone and was never recorded', () => {
    expect(snapshotFor(undefined)).toBeNull()
  })
})
