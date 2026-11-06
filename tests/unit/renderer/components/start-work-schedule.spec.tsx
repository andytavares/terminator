import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScheduledRuns } from '../../../../src/renderer/components/home/start-work-schedule'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { installElectronApi } from '../../../support/electron-api'
import type { Schedule } from '../../../../src/shared/schemas/schedules.schema'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'

const started = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/renderer/components/home/start-work', () => ({ startWork: started }))

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
  createdAt: '',
}

let due: (schedule: Schedule) => void
beforeEach(() => {
  started.mockReset().mockResolvedValue(null)
  installElectronApi({
    schedules: {
      onRun: (callback: (schedule: Schedule) => void) => {
        due = callback
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
