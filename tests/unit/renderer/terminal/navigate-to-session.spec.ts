import { describe, it, expect, vi, beforeEach } from 'vitest'

const session = vi.hoisted(() => ({
  sessions: new Map<string, { projectId: string }>(),
  setActiveSessionForProject: vi.fn(),
}))
const workspace = vi.hoisted(() => ({
  activeWorkspaceId: 'w1',
  projectsByWorkspaceId: new Map<string, Array<{ id: string; workspaceId: string }>>(),
  setActiveWorkspace: vi.fn(),
  setActiveProject: vi.fn(),
  setScratchActive: vi.fn(),
}))
const registry = vi.hoisted(() => ({ setActiveGlobalTab: vi.fn() }))

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: { getState: () => session },
}))
vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: { getState: () => workspace },
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: { getState: () => registry },
}))

import { navigateToSession } from '../../../../src/renderer/terminal/navigate-to-session'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'

beforeEach(() => {
  vi.clearAllMocks()
  session.sessions = new Map()
  workspace.activeWorkspaceId = 'w1'
  workspace.projectsByWorkspaceId = new Map([
    ['w1', [{ id: 'p1', workspaceId: 'w1' }]],
    ['w2', [{ id: 'p2', workspaceId: 'w2' }]],
  ])
})

describe('navigateToSession', () => {
  it('leaves the global tab and shows the session in its project', () => {
    session.sessions.set('s1', { projectId: 'p1' })
    navigateToSession('s1')
    expect(registry.setActiveGlobalTab).toHaveBeenCalledWith(null)
    expect(workspace.setActiveWorkspace).not.toHaveBeenCalled()
    expect(workspace.setActiveProject).toHaveBeenCalledWith('p1')
    expect(session.setActiveSessionForProject).toHaveBeenCalledWith('p1', 's1')
  })

  it('switches workspace when the session lives in another one', () => {
    session.sessions.set('s2', { projectId: 'p2' })
    navigateToSession('s2')
    expect(workspace.setActiveWorkspace).toHaveBeenCalledWith('w2')
  })

  it('opens a scratch terminal in the scratch view', () => {
    session.sessions.set('s3', { projectId: SCRATCH_PROJECT_ID })
    navigateToSession('s3')
    expect(session.setActiveSessionForProject).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 's3')
    expect(workspace.setScratchActive).toHaveBeenCalledWith(true)
    expect(workspace.setActiveProject).not.toHaveBeenCalled()
  })

  it('does nothing for a session that has gone', () => {
    navigateToSession('nobody')
    expect(registry.setActiveGlobalTab).not.toHaveBeenCalled()
  })

  it('stays put when the project has gone', () => {
    session.sessions.set('s4', { projectId: 'deleted' })
    navigateToSession('s4')
    expect(workspace.setActiveProject).not.toHaveBeenCalled()
  })
})
