import { describe, it, expect, vi, beforeEach } from 'vitest'

const workspace = vi.hoisted(() => ({
  workspaces: [] as Array<{ id: string; name: string; folderPath: string }>,
  projectsByWorkspaceId: new Map([
    [
      'w1',
      [
        { id: 'p1', workspaceId: 'w1', name: 'main' },
        { id: 'p2', workspaceId: 'w1', name: 'worktree', worktreePath: '/code/repo-wt' },
      ],
    ],
  ]),
  activeWorkspaceId: null as string | null,
  resolveActiveCwd: () => '/code/repo',
  setScratchActive: vi.fn(),
}))
const settings = vi.hoisted(() => ({
  resolveSettings: vi.fn(() => ({ terminal: { scrollbackLimit: 4242 } })),
}))
const create = vi.hoisted(() => vi.fn().mockResolvedValue('new-session'))
const navigate = vi.hoisted(() => vi.fn())
const registry = vi.hoisted(() => ({ setActiveGlobalTab: vi.fn() }))

vi.mock('../../../../src/renderer/stores/workspace.store', () => ({
  useWorkspaceStore: { getState: () => workspace },
}))
vi.mock('../../../../src/renderer/stores/settings.store', () => ({
  useSettingsStore: { getState: () => settings },
}))
vi.mock('../../../../src/renderer/terminal/session-controller', () => ({
  createTerminalSession: create,
}))
const records = vi.hoisted(() => ({ transfer: vi.fn().mockResolvedValue(true) }))
const sessions = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  closeSession: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../../../src/renderer/stores/session-records.store', () => ({
  useSessionRecordsStore: { getState: () => records },
}))
vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: { getState: () => sessions },
}))
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({
  navigateToSession: navigate,
}))
vi.mock('../../../../src/renderer/extensions/registry', () => ({
  useExtensionRegistry: { getState: () => registry },
}))

import {
  startSessionInBranch,
  startScratchSession,
  resumeSession,
} from '../../../../src/renderer/terminal/start-session'
import { fact } from '../sidebar/fixtures/facts'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'

beforeEach(() => {
  vi.clearAllMocks()
  workspace.workspaces = [{ id: 'w1', name: 'Repo', folderPath: '/code/repo' }]
  workspace.activeWorkspaceId = 'w1'
})

describe('startSessionInBranch', () => {
  it("starts a terminal in the branch's own checkout and shows it", async () => {
    await startSessionInBranch('p2')
    expect(settings.resolveSettings).toHaveBeenCalledWith('w1')
    expect(create).toHaveBeenCalledWith('p2', 'human', '', '/code/repo-wt', 4242)
    expect(navigate).toHaveBeenCalledWith('new-session')
  })

  it("falls back to the repo's folder for a branch with no checkout of its own", async () => {
    await startSessionInBranch('p1')
    expect(create).toHaveBeenCalledWith('p1', 'human', '', '/code/repo', 4242)
  })

  it("falls back to the home directory when the branch's repo has gone", async () => {
    workspace.workspaces = []
    await startSessionInBranch('p1')
    expect(create).toHaveBeenCalledWith('p1', 'human', '', '~', 4242)
  })

  it('does nothing for a branch that has gone', async () => {
    await startSessionInBranch('gone')
    expect(create).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('stays put when the terminal cannot start', async () => {
    create.mockRejectedValueOnce(new Error('CWD_MISSING'))
    await startSessionInBranch('p1')
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('startScratchSession', () => {
  it('starts a scratch terminal and leaves Home for it', async () => {
    await startScratchSession()
    expect(create).toHaveBeenCalledWith(SCRATCH_PROJECT_ID, 'human', 'Scratch', '/code/repo', 4242)
    expect(workspace.setScratchActive).toHaveBeenCalledWith(true)
    expect(registry.setActiveGlobalTab).toHaveBeenCalledWith(null)
  })

  it('resolves settings globally when no repo is active', async () => {
    workspace.activeWorkspaceId = null
    await startScratchSession()
    expect(settings.resolveSettings).toHaveBeenCalledWith(null)
  })

  it('stays on Home when the scratch terminal cannot start', async () => {
    create.mockRejectedValueOnce(new Error('nope'))
    await startScratchSession()
    expect(workspace.setScratchActive).not.toHaveBeenCalled()
    expect(registry.setActiveGlobalTab).not.toHaveBeenCalled()
  })
})

describe('resumeSession', () => {
  const conversation = {
    provider: 'claude' as const,
    sessionId: 'conv-1',
    transcriptPath: '/t/conv-1.jsonl',
    cwd: '/code/repo-wt',
    capturedAt: '2026-09-15T18:00:00.000Z',
  }
  const stopped = (patch = {}) =>
    fact({
      sessionId: 'old',
      name: 'claude',
      state: 'exited',
      agent: conversation,
      resumable: true,
      snapshot: { ...fact().snapshot, sessionId: 'old', projectId: 'p1' },
      ...patch,
    })

  beforeEach(() => {
    sessions.sessions = new Map([['old', { id: 'old', status: 'active' }]])
    records.transfer.mockResolvedValue(true)
  })

  it('opens a terminal that carries the conversation on, where it ran', async () => {
    await resumeSession(stopped())
    expect(create).toHaveBeenCalledWith(
      'p1',
      'human',
      '',
      '/code/repo-wt',
      4242,
      undefined,
      'claude --resume conv-1'
    )
    expect(navigate).toHaveBeenCalledWith('new-session')
  })

  it('moves the old session’s context onto the resumed one, then closes it', async () => {
    await resumeSession(stopped())
    expect(records.transfer).toHaveBeenCalledWith(
      'old',
      expect.objectContaining({ sessionId: 'new-session' })
    )
    expect(sessions.closeSession).toHaveBeenCalledWith('old')
    expect(records.transfer.mock.invocationCallOrder[0]).toBeLessThan(
      sessions.closeSession.mock.invocationCallOrder[0]
    )
  })

  it('closes nothing for a session whose terminal has already gone', async () => {
    sessions.sessions = new Map()
    await resumeSession(stopped({ isClosed: true }))
    expect(records.transfer).toHaveBeenCalled()
    expect(sessions.closeSession).not.toHaveBeenCalled()
  })

  it('does nothing at all for a session that cannot be resumed', async () => {
    await resumeSession(stopped({ resumable: false }))
    expect(create).not.toHaveBeenCalled()
    expect(records.transfer).not.toHaveBeenCalled()
    expect(sessions.closeSession).not.toHaveBeenCalled()
  })

  it('leaves the old session alone when the terminal will not open', async () => {
    create.mockRejectedValueOnce(new Error('CWD_MISSING'))
    await resumeSession(stopped())
    expect(records.transfer).not.toHaveBeenCalled()
    expect(sessions.closeSession).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
