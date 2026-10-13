import { describe, it, expect, vi, beforeEach } from 'vitest'

const registry = vi.hoisted(() => ({
  setActiveGlobalTab: vi.fn(),
  setActiveWorkspaceTab: vi.fn(),
  setActiveProjectTab: vi.fn(),
}))

vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: { getState: () => registry },
}))

import { revealSession } from '../../../../src/renderer/terminal/navigate-to-session'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import {
  projectOf,
  seedStore,
  terminalSessionOf,
  type SeededStore,
} from '../../../support/renderer-stores'

let session: SeededStore<typeof useSessionStore>
let workspace: SeededStore<typeof useWorkspaceStore>

beforeEach(() => {
  vi.clearAllMocks()
  session = seedStore(useSessionStore, { sessions: new Map() })
  workspace = seedStore(useWorkspaceStore, {
    activeWorkspaceId: 'w1',
    projectsByWorkspaceId: new Map([
      ['w1', [projectOf({ id: 'p1', workspaceId: 'w1' })]],
      ['w2', [projectOf({ id: 'p2', workspaceId: 'w2' })]],
    ]),
  })
})

describe('revealSession', () => {
  it('leaves the global, workspace and project tabs and shows the session in its project', () => {
    session.sessions.set('s1', terminalSessionOf({ id: 's1', projectId: 'p1' }))
    revealSession('s1')
    expect(registry.setActiveGlobalTab).toHaveBeenCalledWith(null)
    expect(registry.setActiveWorkspaceTab).toHaveBeenCalledWith(null)
    expect(registry.setActiveProjectTab).toHaveBeenCalledWith(null)
    expect(workspace.setActiveWorkspace).not.toHaveBeenCalled()
    expect(workspace.setActiveProject).toHaveBeenCalledWith('p1')
    expect(session.setActiveSessionForProject).toHaveBeenCalledWith('p1', 's1')
  })

  it('switches workspace when the session lives in another one', () => {
    session.sessions.set('s2', terminalSessionOf({ id: 's2', projectId: 'p2' }))
    revealSession('s2')
    expect(workspace.setActiveWorkspace).toHaveBeenCalledWith('w2')
  })

  it('opens a scratch terminal in the scratch view', () => {
    session.sessions.set('s3', terminalSessionOf({ id: 's3', projectId: SCRATCH_PROJECT_ID }))
    revealSession('s3')
    expect(session.setActiveSessionForProject).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 's3')
    expect(workspace.setScratchActive).toHaveBeenCalledWith(true)
    expect(workspace.setActiveProject).not.toHaveBeenCalled()
    expect(session.requestFocus).toHaveBeenCalledWith('s3')
  })

  it('does nothing for a session that has gone', () => {
    revealSession('nobody')
    expect(registry.setActiveGlobalTab).not.toHaveBeenCalled()
  })

  it('stays put when the project has gone', () => {
    session.sessions.set('s4', terminalSessionOf({ id: 's4', projectId: 'deleted' }))
    revealSession('s4')
    expect(workspace.setActiveProject).not.toHaveBeenCalled()
  })

  it('bumps the focus request even when the session is already the active one', () => {
    session.sessions.set('s1', terminalSessionOf({ id: 's1', projectId: 'p1' }))
    revealSession('s1')
    expect(session.requestFocus).toHaveBeenCalledWith('s1')
    revealSession('s1')
    expect(session.requestFocus).toHaveBeenCalledTimes(2)
  })
})
