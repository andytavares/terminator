import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useScheduledRuns } from '../../../../src/components/home/start-work-schedule'
import { useSessionStore } from '../../../../src/stores/session.store'
import { useWorkspaceStore } from '../../../../src/stores/workspace.store'
import { useToastStore } from '../../../../src/stores/toast.store'
import { installElectronApi } from '../../../../../test-support/src/electron-api'
import type { DueSchedule, Schedule } from '../../../../../core-shared/src/schemas/schedules.schema'
import type {
  Project,
  TerminalSession,
  Workspace,
} from '../../../../../core-shared/src/types/index'

const started = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/components/home/start-work', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startWork: started,
}))
const startedGlobal = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/terminal/start-session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  startGlobalPrompt: startedGlobal,
}))

const workspace = { id: 'ws-1', name: 'terminator', folderPath: '/repo' } as Workspace
const project = { id: 'p-1', workspaceId: 'ws-1', gitBranch: 'feat/triage' } as Project
const session = { id: 's-1', projectId: 'p-1', status: 'active' } as TerminalSession

const triage: Schedule = {
  id: 's1',
  repoRoot: '/repo',
  prompt: 'Triage the inbox',
  runAs: 'agent',
  kind: 'repeat',
  repeat: { every: 1, unit: 'hour', days: [], between: null, overlap: 'skip' },
  branch: 'feat/triage',
  time: '09:00',
  date: null,
  newWorktree: true,
  agentId: null,
  lastRunAt: null,
  paused: false,
  createdAt: '',
}

const unattended = {
  settingsPath: '/data/scheduled-runs/settings.json',
  systemPromptPath: '/data/scheduled-runs/system-prompt.md',
  systemPrompt: 'Nobody is watching.',
}
let deliver: (schedule: DueSchedule) => void
const due = (schedule: Schedule) => deliver({ ...schedule, unattended })
beforeEach(() => {
  started.mockReset().mockResolvedValue(null)
  startedGlobal.mockReset().mockResolvedValue('g-1')
  installElectronApi({
    schedules: {
      onRun: (callback: (schedule: DueSchedule) => void) => {
        deliver = callback
        return () => {}
      },
    },
  })
  useWorkspaceStore.setState({
    workspaces: [workspace],
    projectsByWorkspaceId: new Map([['ws-1', [project]]]),
  })
  useSessionStore.setState({ sessions: new Map() })
})

describe('useScheduledRuns', () => {
  it('does nothing in the remote browser client, which has no schedules API', () => {
    installElectronApi({})
    expect(() => renderHook(() => useScheduledRuns())).not.toThrow()
  })

  it('starts every run on the one branch saved with the schedule', () => {
    renderHook(() => useScheduledRuns())
    due(triage)
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ branch: 'feat/triage' }))
  })

  it('starts the run with the files that let it run with nobody watching', () => {
    renderHook(() => useScheduledRuns())
    due(triage)
    expect(started).toHaveBeenCalledWith(expect.objectContaining({ unattended }))
  })
})

describe('useScheduledRuns, overlap', () => {
  it('skips the run while the last one is still open on that branch', () => {
    useSessionStore.setState({ sessions: new Map([['s-1', session]]) })
    renderHook(() => useScheduledRuns())
    due(triage)
    expect(started).not.toHaveBeenCalled()
  })

  it('starts another when overlap is start, even with a session open', () => {
    useSessionStore.setState({ sessions: new Map([['s-1', session]]) })
    renderHook(() => useScheduledRuns())
    due({ ...triage, repeat: { ...triage.repeat!, overlap: 'start' } })
    expect(started).toHaveBeenCalled()
  })

  it('starts when the session on that branch is closed', () => {
    useSessionStore.setState({
      sessions: new Map([['s-1', { ...session, status: 'closed' as const }]]),
    })
    renderHook(() => useScheduledRuns())
    due(triage)
    expect(started).toHaveBeenCalled()
  })
})

const summary: Schedule = {
  ...triage,
  id: 'g1',
  repoRoot: null,
  branch: null,
  newWorktree: false,
  prompt: 'Sum up the PRs',
}

describe('useScheduledRuns, a global scheduled run', () => {
  it('starts it in the home folder under Scratch, not in a workspace', () => {
    renderHook(() => useScheduledRuns())
    due({ ...summary, agentId: 'opencode' })
    expect(startedGlobal).toHaveBeenCalledWith({
      text: 'Sum up the PRs',
      runAs: 'agent',
      agentId: 'opencode',
      unattended,
    })
    expect(started).not.toHaveBeenCalled()
  })
})

describe('useScheduledRuns, a global scheduled run, overlap', () => {
  it('skips the next run while the session the last one opened is still open', async () => {
    renderHook(() => useScheduledRuns())
    due(summary)
    // The launcher awaited this promise first, so it has noted the session once it settles.
    await startedGlobal.mock.results[0].value
    useSessionStore.setState({ sessions: new Map([['g-1', { ...session, id: 'g-1' }]]) })
    due(summary)
    expect(startedGlobal).toHaveBeenCalledTimes(1)
  })

  it('starts the next run once that session is closed', async () => {
    renderHook(() => useScheduledRuns())
    due({ ...summary, id: 'g2' })
    await startedGlobal.mock.results[0].value
    useSessionStore.setState({
      sessions: new Map([['g-1', { ...session, id: 'g-1', status: 'closed' as const }]]),
    })
    due({ ...summary, id: 'g2' })
    await waitFor(() => expect(startedGlobal).toHaveBeenCalledTimes(2))
  })
})

describe('useScheduledRuns, a global scheduled run that fails', () => {
  it('says so in a toast when it does not start', async () => {
    startedGlobal.mockResolvedValue(null)
    useToastStore.setState({ toasts: [] })
    renderHook(() => useScheduledRuns())
    due({ ...summary, id: 'g3' })
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
        'A scheduled run did not start. The agent could not be started.',
      ])
    )
  })
})
