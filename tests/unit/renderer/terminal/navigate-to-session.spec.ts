// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { revealSession } from '../../../../src/renderer/terminal/navigate-to-session'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { projectOf, resetStore, terminalSessionOf } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'

const P1 = projectOf({ id: 'p1', workspaceId: 'w1' })
const P2 = projectOf({ id: 'p2', workspaceId: 'w2' })
const projectsByWorkspaceId = new Map([
  ['w1', [P1]],
  ['w2', [P2]],
])

const sessions = () => useSessionStore.getState()
const workspaces = () => useWorkspaceStore.getState()
const registry = () => useExtensionRegistry.getState()

function withSessions(...list: ReturnType<typeof terminalSessionOf>[]): void {
  useSessionStore.setState({ sessions: new Map(list.map((s) => [s.id, s])) })
}

beforeEach(() => {
  resetStore(useSessionStore)
  resetStore(useWorkspaceStore, { activeWorkspaceId: 'w1', projectsByWorkspaceId })
  resetStore(useExtensionRegistry, {
    activeGlobalTabId: 'core.home',
    activeWorkspaceTabId: 'reviews',
    activeProjectTabId: 'git',
  })
  // Switching workspace reloads its projects from main.
  installElectronApi({
    project: { list: async (id: string) => ({ projects: projectsByWorkspaceId.get(id) ?? [] }) },
  })
})

describe('revealSession', () => {
  it('leaves the global, workspace and project tabs and shows the session in its project', () => {
    withSessions(terminalSessionOf({ id: 's1', projectId: 'p1' }))
    revealSession('s1')
    expect(registry()).toMatchObject({
      activeGlobalTabId: null,
      activeWorkspaceTabId: null,
      activeProjectTabId: null,
    })
    expect(workspaces()).toMatchObject({ activeWorkspaceId: 'w1', activeProjectId: 'p1' })
    expect(sessions().getActiveSessionForProject('p1')).toBe('s1')
  })

  it('switches workspace when the session lives in another one', () => {
    withSessions(terminalSessionOf({ id: 's2', projectId: 'p2' }))
    revealSession('s2')
    expect(workspaces()).toMatchObject({ activeWorkspaceId: 'w2', activeProjectId: 'p2' })
    expect(sessions().getActiveSessionForProject('p2')).toBe('s2')
  })

  it('opens a scratch terminal in the scratch view', () => {
    withSessions(terminalSessionOf({ id: 's3', projectId: SCRATCH_PROJECT_ID }))
    revealSession('s3')
    expect(sessions().getActiveSessionForProject(SCRATCH_PROJECT_ID)).toBe('s3')
    expect(workspaces()).toMatchObject({ scratchActive: true, activeProjectId: null })
    expect(sessions().focusRequest?.sessionId).toBe('s3')
  })

  it('does nothing for a session that has gone', () => {
    revealSession('nobody')
    expect(registry().activeGlobalTabId).toBe('core.home')
  })

  it('stays put when the project has gone', () => {
    withSessions(terminalSessionOf({ id: 's4', projectId: 'deleted' }))
    revealSession('s4')
    expect(workspaces().activeProjectId).toBeNull()
    expect(sessions().focusRequest).toBeNull()
  })

  it('bumps the focus request even when the session is already the active one', () => {
    withSessions(terminalSessionOf({ id: 's1', projectId: 'p1' }))
    revealSession('s1')
    const first = sessions().focusRequest
    revealSession('s1')
    expect(sessions().focusRequest).toEqual({ sessionId: 's1', nonce: first!.nonce + 1 })
  })
})
