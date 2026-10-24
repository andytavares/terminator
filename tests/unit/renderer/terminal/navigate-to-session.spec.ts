// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { revealSession } from '../../../../src/renderer/terminal/navigate-to-session'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import { useBreakoutStore } from '../../../../src/renderer/stores/breakout.store'
import { partialFake } from '../../../support/fakes'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { projectFixture, resetStore, terminalSessionOf } from '../../../support/renderer-stores'
import { installElectronApi } from '../../../support/electron-api'
import { registryState, sessionState, workspaceState } from '../../../support/store-state'

const P1 = projectFixture({ id: 'p1', workspaceId: 'w1' })
const P2 = projectFixture({ id: 'p2', workspaceId: 'w2' })
const projectsByWorkspaceId = new Map([
  ['w1', [P1]],
  ['w2', [P2]],
])

function seedSessions(...list: ReturnType<typeof terminalSessionOf>[]): void {
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
    seedSessions(terminalSessionOf({ id: 's1', projectId: 'p1' }))
    revealSession('s1')
    expect(registryState()).toMatchObject({
      activeGlobalTabId: null,
      activeWorkspaceTabId: null,
      activeProjectTabId: null,
    })
    expect(workspaceState()).toMatchObject({ activeWorkspaceId: 'w1', activeProjectId: 'p1' })
    expect(sessionState().getActiveSessionForProject('p1')).toBe('s1')
  })

  it('switches workspace when the session lives in another one', () => {
    seedSessions(terminalSessionOf({ id: 's2', projectId: 'p2' }))
    revealSession('s2')
    expect(workspaceState()).toMatchObject({ activeWorkspaceId: 'w2', activeProjectId: 'p2' })
    expect(sessionState().getActiveSessionForProject('p2')).toBe('s2')
  })

  it('opens a scratch terminal in the scratch view', () => {
    seedSessions(terminalSessionOf({ id: 's3', projectId: SCRATCH_PROJECT_ID }))
    revealSession('s3')
    expect(sessionState().getActiveSessionForProject(SCRATCH_PROJECT_ID)).toBe('s3')
    expect(workspaceState()).toMatchObject({ scratchActive: true, activeProjectId: null })
    expect(sessionState().focusRequest?.sessionId).toBe('s3')
  })
})

describe('revealSession — does nothing for a session that has gone', () => {
  it('does nothing for a session that has gone', () => {
    revealSession('nobody')
    expect(registryState().activeGlobalTabId).toBe('core.home')
  })

  it('stays put when the project has gone', () => {
    seedSessions(terminalSessionOf({ id: 's4', projectId: 'deleted' }))
    revealSession('s4')
    expect(workspaceState().activeProjectId).toBeNull()
    expect(sessionState().focusRequest).toBeNull()
  })

  it('bumps the focus request even when the session is already the active one', () => {
    seedSessions(terminalSessionOf({ id: 's1', projectId: 'p1' }))
    revealSession('s1')
    const first = sessionState().focusRequest
    revealSession('s1')
    expect(sessionState().focusRequest).toEqual({ sessionId: 's1', nonce: first!.nonce + 1 })
  })
})

describe('revealSession — a terminal in its own window', () => {
  it('focuses that window and leaves the main window where it is', () => {
    seedSessions(terminalSessionOf({ id: 's1', projectId: 'p1' }))
    const focus = vi.fn()
    useBreakoutStore.getState().add('s1', partialFake<Window>({ focus }))
    revealSession('s1')
    expect(focus).toHaveBeenCalled()
    expect(registryState().activeGlobalTabId).toBe('core.home')
    expect(workspaceState().activeProjectId).not.toBe('p1')
    useBreakoutStore.getState().remove('s1')
  })
})
