// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startWork } from '../../../../src/renderer/components/home/start-work'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { installElectronApi } from '../../../support/electron-api'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'

const launched = vi.hoisted(() => ({ inBranch: vi.fn(), agentInBranch: vi.fn() }))
vi.mock('../../../../src/renderer/terminal/start-session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startSessionInBranch: launched.inBranch,
  startAgentInBranch: launched.agentInBranch,
}))

const workspace = workspaceFixture({ id: 'ws-1', name: 'Terminator', folderPath: '/repo' })
const unattended = {
  settingsPath: '/data/settings.json',
  systemPromptPath: '/data/system-prompt.md',
  systemPrompt: 'Nobody is watching.',
}
const onBranch = {
  kind: 'branch',
  workspace,
  branch: 'feat/x',
  prompt: 'Triage',
  unattended,
} as const

beforeEach(() => {
  launched.inBranch.mockReset().mockResolvedValue('s-1')
  launched.agentInBranch.mockReset().mockResolvedValue('s-1')
  installElectronApi({})
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [workspace],
    projectsByWorkspaceId: new Map([
      ['ws-1', [projectFixture({ id: 'p-1', workspaceId: 'ws-1', gitBranch: 'feat/x' })]],
    ]),
  })
})

describe('startWork for a scheduled run', () => {
  it('types the settings and system prompt flags for Claude in a terminal', async () => {
    expect(await startWork({ ...onBranch, runAs: 'claude-terminal' })).toBeNull()
    expect(launched.inBranch).toHaveBeenCalledWith(
      'p-1',
      "claude --settings '/data/settings.json' --append-system-prompt-file '/data/system-prompt.md' 'Triage'",
      true
    )
  })

  it('tells the caller which session the run opened', async () => {
    const onStarted = vi.fn()
    await startWork({ ...onBranch, runAs: 'agent', onStarted })
    expect(onStarted).toHaveBeenCalledWith('s-1')
  })

  it('hands the files to an agent tab', async () => {
    expect(await startWork({ ...onBranch, runAs: 'agent' })).toBeNull()
    expect(launched.agentInBranch).toHaveBeenCalledWith(expect.objectContaining({ unattended }))
  })
})
