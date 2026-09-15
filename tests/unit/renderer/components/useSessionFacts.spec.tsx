import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionRecordsStore } from '../../../../src/renderer/stores/session-records.store'
import { useIntegrationsStore } from '../../../../src/renderer/stores/integrations.store'
import {
  useSessionFacts,
  useIssue,
  useIssueTitles,
} from '../../../../src/renderer/components/session/useSessionFacts'
import type { Project, TerminalSession, Workspace } from '../../../../src/shared/types/index'

const workspace = { id: 'w1', name: 'Personal', color: '#5c6bc0', tags: [] } as unknown as Workspace
const project = { id: 'p1', workspaceId: 'w1', name: 'terminator', gitBranch: 'main' } as Project
const session = {
  id: 's1',
  projectId: 'p1',
  tabTitle: 'zsh',
  status: 'active',
  type: 'human',
  createdAt: '2026-09-15T10:00:00.000Z',
  lastActivityAt: 1,
  agentState: 'idle',
} as TerminalSession

const getIssue = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { electronAPI: unknown }).electronAPI = { integrations: { getIssue } }
  useSessionStore.setState({ sessions: new Map([['s1', session]]) })
  useWorkspaceStore.setState({
    workspaces: [workspace],
    projectsByWorkspaceId: new Map([['w1', [project]]]),
  })
  useSessionRecordsStore.setState({
    records: new Map([
      [
        'gone',
        {
          sessionId: 'gone',
          projectId: 'p1',
          workspaceName: 'Personal',
          projectName: 'terminator',
          branch: 'old',
          tabTitle: 'claude',
          shell: null,
          description: 'closed one',
          link: null,
          startedAt: '2026-09-14T10:00:00.000Z',
          updatedAt: '2026-09-14T10:00:00.000Z',
          closedAt: '2026-09-14T11:00:00.000Z',
        },
      ],
    ]),
  })
  useIntegrationsStore.setState({ links: new Map(), issuesByKey: new Map() })
})

describe('useSessionFacts', () => {
  it('returns open sessions and closed records together', () => {
    const { result } = renderHook(() => useSessionFacts())
    expect(result.current.map((f) => [f.sessionId, f.isClosed])).toEqual([
      ['s1', false],
      ['gone', true],
    ])
    expect(result.current[0].workspaceName).toBe('Personal')
  })

  it('follows a change in the session store', () => {
    const { result } = renderHook(() => useSessionFacts())
    act(() => {
      useSessionStore.setState({
        sessions: new Map([['s1', { ...session, agentState: 'working' }]]),
      })
    })
    expect(result.current[0].state).toBe('working')
  })
})

describe('useIssue', () => {
  it('loads the issue for a work item and returns it once read', async () => {
    getIssue.mockResolvedValue({ issue: { key: 'TAV-1', title: 'Home' } })
    const { result } = renderHook(() => useIssue({ tracker: 'linear', key: 'TAV-1' }))
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toEqual({ key: 'TAV-1', title: 'Home' }))
    expect(getIssue).toHaveBeenCalledTimes(1)
  })

  it('asks for nothing without a work item', () => {
    const { result } = renderHook(() => useIssue(null))
    expect(result.current).toBeUndefined()
    expect(getIssue).not.toHaveBeenCalled()
  })
})

describe('useIssueTitles', () => {
  it('maps every issue read so far to its title, leaving out unreadable ones', () => {
    useIntegrationsStore.setState({
      issuesByKey: new Map([
        ['linear:TAV-1', { key: 'TAV-1', title: 'Home' } as never],
        ['linear:TAV-2', null],
      ]),
    })
    const { result } = renderHook(() => useIssueTitles())
    expect([...result.current]).toEqual([['linear:TAV-1', 'Home']])
  })
})
