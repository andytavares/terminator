import { describe, it, expect, vi, beforeEach } from 'vitest'

const create = vi.hoisted(() => vi.fn().mockResolvedValue('new-session'))
const navigate = vi.hoisted(() => vi.fn())

vi.mock('../../../../src/renderer/terminal/session-controller', () => ({
  createTerminalSession: create,
}))
vi.mock('../../../../src/renderer/terminal/navigate-to-session', () => ({
  revealSession: navigate,
}))

import {
  startSessionInBranch,
  startScratchSession,
  resumeSession,
} from '../../../../src/renderer/terminal/start-session'
import { fact } from '../sidebar/fixtures/facts'
import { SCRATCH_PROJECT_ID } from '../../../../src/shared/types/index'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSettingsStore } from '../../../../src/renderer/stores/settings.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useExtensionRegistry } from '../../../../src/renderer/extensions/registry'
import { DEFAULT_GLOBAL_SETTINGS } from '../../../../src/shared/schemas/settings.schema'
import {
  projectOf,
  seedStore,
  terminalSessionOf,
  workspaceOf,
  type SeededStore,
} from '../../../support/renderer-stores'

/** The global scrollback, and the one repo w1 sets for itself. */
const GLOBAL_SCROLLBACK = 4242
const REPO_SCROLLBACK = 5151

const repo = workspaceOf({ id: 'w1', name: 'Repo', folderPath: '/code/repo' })
let records: SeededStore<typeof useSessionRecordsStore>
const closeSession = vi.fn()

/** Repo w1 with its main checkout p1 and its worktree p2. */
function seedWorkspaces(): void {
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [repo],
    activeWorkspaceId: 'w1',
    projectsByWorkspaceId: new Map([
      [
        'w1',
        [
          projectOf({ id: 'p1', workspaceId: 'w1', name: 'main' }),
          projectOf({
            id: 'p2',
            workspaceId: 'w1',
            name: 'worktree',
            worktreePath: '/code/repo-wt',
          }),
        ],
      ],
    ]),
  })
}

/** The global scrollback, overridden by w1. */
function seedSettings(): void {
  useSettingsStore.setState({
    ...useSettingsStore.getInitialState(),
    globalSettings: {
      ...DEFAULT_GLOBAL_SETTINGS,
      terminal: { ...DEFAULT_GLOBAL_SETTINGS.terminal, scrollbackLimit: GLOBAL_SCROLLBACK },
    },
    workspaceSettings: new Map([
      [
        'w1',
        {
          workspaceId: 'w1',
          overrides: { terminal: { scrollbackLimit: REPO_SCROLLBACK } },
          extensions: {},
        },
      ],
    ]),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seedWorkspaces()
  seedSettings()
  useExtensionRegistry.setState(useExtensionRegistry.getInitialState(), true)
  useExtensionRegistry.getState().setActiveGlobalTab('core.home')
  // Closing a terminal and moving a record both reach the main process.
  closeSession.mockResolvedValue(undefined)
  useSessionStore.setState({ ...useSessionStore.getInitialState(), closeSession })
  records = seedStore(useSessionRecordsStore)
  records.transfer.mockResolvedValue(true)
})

describe('startSessionInBranch', () => {
  it("starts a terminal in the branch's own checkout and shows it", async () => {
    await startSessionInBranch('p2')
    expect(create).toHaveBeenCalledWith({
      projectId: 'p2',
      type: 'human',
      title: '',
      cwd: '/code/repo-wt',
      scrollbackLimit: REPO_SCROLLBACK,
    })
    expect(navigate).toHaveBeenCalledWith('new-session')
  })

  it("falls back to the repo's folder for a branch with no checkout of its own", async () => {
    await startSessionInBranch('p1')
    expect(create).toHaveBeenCalledWith({
      projectId: 'p1',
      type: 'human',
      title: '',
      cwd: '/code/repo',
      scrollbackLimit: REPO_SCROLLBACK,
    })
  })
})

describe("startSessionInBranch — falls back to the home directory when the branch's repo has gone", () => {
  it("falls back to the home directory when the branch's repo has gone", async () => {
    useWorkspaceStore.setState({ workspaces: [] })
    await startSessionInBranch('p1')
    expect(create).toHaveBeenCalledWith({
      projectId: 'p1',
      type: 'human',
      title: '',
      cwd: '~',
      scrollbackLimit: REPO_SCROLLBACK,
    })
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
    expect(create).toHaveBeenCalledWith({
      projectId: SCRATCH_PROJECT_ID,
      type: 'human',
      title: 'Scratch',
      cwd: '/code/repo',
      scrollbackLimit: REPO_SCROLLBACK,
    })
    expect(useWorkspaceStore.getState().scratchActive).toBe(true)
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBeNull()
  })

  it('resolves settings globally when no repo is active', async () => {
    useWorkspaceStore.setState({ activeWorkspaceId: null })
    await startScratchSession()
    expect(create).toHaveBeenCalledWith({
      projectId: SCRATCH_PROJECT_ID,
      type: 'human',
      title: 'Scratch',
      cwd: '~',
      scrollbackLimit: GLOBAL_SCROLLBACK,
    })
  })
})

describe('startScratchSession — stays on Home when the scratch terminal cannot start', () => {
  it('stays on Home when the scratch terminal cannot start', async () => {
    create.mockRejectedValueOnce(new Error('nope'))
    await startScratchSession()
    expect(useWorkspaceStore.getState().scratchActive).toBe(false)
    expect(useExtensionRegistry.getState().activeGlobalTabId).toBe('core.home')
  })
})

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

/** The hooks every "resumeSession" describe registers. */
function setUpResumeSession(): void {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: new Map([['old', terminalSessionOf({ id: 'old', projectId: 'p1' })]]),
    })
  })
}

describe('resumeSession', () => {
  setUpResumeSession()

  it('opens a terminal that carries the conversation on, where it ran', async () => {
    await resumeSession(stopped())
    expect(create).toHaveBeenCalledWith({
      projectId: 'p1',
      type: 'human',
      title: '',
      cwd: '/code/repo-wt',
      scrollbackLimit: REPO_SCROLLBACK,
      initialCommand: 'claude --resume conv-1',
    })
    expect(navigate).toHaveBeenCalledWith('new-session')
  })

  it('moves the old session’s context onto the resumed one, then closes it', async () => {
    await resumeSession(stopped())
    expect(records.transfer).toHaveBeenCalledWith(
      'old',
      expect.objectContaining({ sessionId: 'new-session' })
    )
    expect(closeSession).toHaveBeenCalledWith('old')
    expect(records.transfer.mock.invocationCallOrder[0]).toBeLessThan(
      closeSession.mock.invocationCallOrder[0]
    )
  })
})

describe('resumeSession — closes nothing for a session whose terminal has already gone', () => {
  setUpResumeSession()

  it('closes nothing for a session whose terminal has already gone', async () => {
    useSessionStore.setState({ sessions: new Map() })
    await resumeSession(stopped({ isClosed: true }))
    expect(records.transfer).toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('does nothing at all for a session that cannot be resumed', async () => {
    await resumeSession(stopped({ resumable: false }))
    expect(create).not.toHaveBeenCalled()
    expect(records.transfer).not.toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('leaves the old session alone when the terminal will not open', async () => {
    create.mockRejectedValueOnce(new Error('CWD_MISSING'))
    await resumeSession(stopped())
    expect(records.transfer).not.toHaveBeenCalled()
    expect(closeSession).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })
})
