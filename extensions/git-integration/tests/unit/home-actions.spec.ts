import { describe, it, expect, vi } from 'vitest'
import type { ExtensionAPI, SessionInfo } from '@terminator/extension-sdk'
import { partialFake } from '../../../../tests/support/fakes'
import { bindShell } from '../../src/shell/run-git'
import { createHomeActionHandler, worktreeOfBranch } from '../../src/home/actions'
import { dashboardPrFixture } from './support/dashboard-pr'

const PORCELAIN = [
  'worktree /work/widgets',
  'HEAD aaa',
  'branch refs/heads/main',
  '',
  'worktree /work/widgets-login',
  'HEAD bbb',
  'branch refs/heads/feat/login',
  '',
  'worktree /work/widgets-detached',
  'HEAD ccc',
  'detached',
  '',
].join('\n')

describe('worktreeOfBranch', () => {
  it('finds the folder a branch is checked out in', () => {
    expect(worktreeOfBranch(PORCELAIN, 'feat/login')).toBe('/work/widgets-login')
    expect(worktreeOfBranch(PORCELAIN, 'main')).toBe('/work/widgets')
  })

  it('finds nothing for a branch no worktree holds', () => {
    expect(worktreeOfBranch(PORCELAIN, 'feat/other')).toBeUndefined()
  })
})

const agentTerminal = (overrides: Partial<SessionInfo>): SessionInfo => ({
  sessionId: 's1',
  cwd: '/work/widgets-login',
  type: 'agent',
  origin: 'app',
  createdAt: '2026-10-18T09:00:00Z',
  pid: 1,
  ...overrides,
})

/** git answers the worktree list, gh answers nothing; the shell is bound for runGit too. */
function fakeGitShell() {
  const exec = vi.fn(async (options: { command: string; args: string[] }) => ({
    exitCode: 0,
    stdout: options.command === 'git' ? PORCELAIN : '',
    stderr: '',
    timedOut: false,
    exceededMaxBuffer: false,
  }))
  bindShell(partialFake<ExtensionAPI['shell']>({ exec: exec as never }))
  return exec
}

/** One workspace whose project sits in the feat/login worktree. */
const repoWorkspace = partialFake<ExtensionAPI['workspace']>({
  list: () => [{ id: 'w1', name: 'w1', folderPath: '/work/widgets' }],
  listProjects: () => [
    { id: 'p1', workspaceId: 'w1', name: 'login', worktreePath: '/work/widgets-login' },
  ],
})

const PULL_REQUESTS = [
  dashboardPrFixture({ section: 'requested', number: 40, headRefName: 'fix/cache' }),
  dashboardPrFixture({ number: 275, ciStatus: 'failing' }),
  dashboardPrFixture({
    number: 300,
    ciStatus: 'failing',
    checks: [
      { name: 'Lint', state: 'passed' },
      {
        name: 'E2E',
        state: 'failed',
        detailsUrl: 'https://github.com/acme/widgets/actions/runs/987/job/4',
      },
    ],
  }),
]

function setupActions(sessions: SessionInfo[] = []) {
  const exec = fakeGitShell()
  const pty = {
    listSessions: async () => sessions,
    write: vi.fn(),
    openTerminal: vi.fn(async () => 'new-session'),
  }
  const openAuxiliary = vi.fn()
  const warn = vi.fn()
  const api = partialFake<ExtensionAPI>({
    shell: partialFake<ExtensionAPI['shell']>({ exec: exec as never }),
    pty: partialFake<ExtensionAPI['pty']>(pty),
    workspace: repoWorkspace,
    window: partialFake<ExtensionAPI['window']>({ openAuxiliary }),
    log: { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() },
  })
  const handle = createHomeActionHandler({
    api,
    storage: '/storage',
    pullRequests: () => PULL_REQUESTS,
  })
  return { handle, exec, write: pty.write, openTerminal: pty.openTerminal, openAuxiliary, warn }
}

describe('start-review', () => {
  it('opens the review window on that pull request in its checkout', async () => {
    const { handle, openAuxiliary } = setupActions()
    await handle('review:acme/widgets#40', 'start-review')
    expect(openAuxiliary).toHaveBeenCalledWith('pr-review', {
      repoRoot: '/work/widgets',
      accentColor: '',
      prNumber: '40',
      showOverview: 'false',
    })
  })
})

describe('open-log', () => {
  it('opens the pull request checks page in the browser through gh', async () => {
    const { handle, exec } = setupActions()
    await handle('fix:acme/widgets#275', 'open-log')
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'gh',
        args: ['pr', 'checks', 'https://github.com/acme/widgets/pull/275', '--web'],
        cwd: '/storage',
      })
    )
  })
})

describe('open-log on a pull request whose checks were read', () => {
  it('opens the first failing check run', async () => {
    const { handle, exec } = setupActions()
    await handle('fix:acme/widgets#300', 'open-log')
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'gh',
        args: ['run', 'view', '987', '--web', '-R', 'acme/widgets'],
      })
    )
  })
})

describe('send-to-agent', () => {
  it('types the message into the agent terminal already on the branch', async () => {
    const { handle, write, openTerminal } = setupActions([
      agentTerminal({ sessionId: 'elsewhere', cwd: '/work/other' }),
      agentTerminal({ sessionId: 'on-branch' }),
    ])
    await handle('fix:acme/widgets#275', 'send-to-agent')
    expect(openTerminal).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith(
      'on-branch',
      'Checks are failing on https://github.com/acme/widgets/pull/275. Find the failing checks, fix them and push.\r'
    )
  })

  it('never types into a person terminal', async () => {
    const { handle, write, openTerminal } = setupActions([agentTerminal({ type: 'human' })])
    await handle('fix:acme/widgets#275', 'send-to-agent')
    expect(write).not.toHaveBeenCalledWith('s1', expect.anything())
    expect(openTerminal).toHaveBeenCalled()
  })
})

describe('send-to-agent without an agent terminal', () => {
  it('starts claude in the branch worktree when no agent terminal is there', async () => {
    const { handle, write, openTerminal } = setupActions([])
    await handle('fix:acme/widgets#275', 'send-to-agent')
    expect(openTerminal).toHaveBeenCalledWith({
      projectId: 'p1',
      cwd: '/work/widgets-login',
      tabTitle: 'Fix checks #275',
      type: 'agent',
    })
    expect(write).toHaveBeenCalledWith(
      'new-session',
      "claude 'Checks are failing on https://github.com/acme/widgets/pull/275. Find the failing checks, fix them and push.'\r"
    )
  })

  it('does nothing, and says so, when the branch is checked out nowhere', async () => {
    const { handle, write, openTerminal, warn } = setupActions()
    await handle('fix:acme/widgets#40', 'send-to-agent')
    expect(write).not.toHaveBeenCalled()
    expect(openTerminal).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('fix/cache'))
  })
})

describe('unknown items', () => {
  it('warns and does nothing for a pull request no longer on the dashboard', async () => {
    const { handle, openAuxiliary, warn } = setupActions()
    await handle('review:acme/widgets#999', 'start-review')
    expect(openAuxiliary).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
  })
})
