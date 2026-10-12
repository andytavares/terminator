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
import {
  issueOf,
  projectOf,
  sessionRecordOf,
  terminalSessionOf,
  workspaceOf,
} from '../../../support/renderer-stores'

const workspace = workspaceOf({ id: 'w1', name: 'Personal', color: '#5c6bc0' })
const project = projectOf({ id: 'p1', workspaceId: 'w1', name: 'terminator', gitBranch: 'main' })
const session = terminalSessionOf({
  id: 's1',
  projectId: 'p1',
  tabTitle: 'zsh',
  createdAt: '2026-09-15T10:00:00.000Z',
  lastActivityAt: 1,
})
const closedRecord = sessionRecordOf(
  {
    sessionId: 'gone',
    projectId: 'p1',
    workspaceName: 'Personal',
    projectName: 'terminator',
    branch: 'old',
    tabTitle: 'claude',
    shell: null,
    startedAt: '2026-09-14T10:00:00.000Z',
  },
  {
    description: 'closed one',
    updatedAt: '2026-09-14T10:00:00.000Z',
    closedAt: '2026-09-14T11:00:00.000Z',
  }
)

const getIssue = vi.fn()
const listRecords = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  listRecords.mockResolvedValue({ data: [closedRecord] })
  Object.defineProperty(window, 'electronAPI', {
    value: { integrations: { getIssue }, sessionRecords: { list: listRecords } },
    writable: true,
    configurable: true,
  })
  useSessionStore.setState({ sessions: new Map([['s1', session]]) })
  useWorkspaceStore.setState({
    workspaces: [workspace],
    projectsByWorkspaceId: new Map([['w1', [project]]]),
  })
  useSessionRecordsStore.setState({ records: new Map([['gone', closedRecord]]) })
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

  // A transcript can be deleted while the app is open, so whether a
  // conversation can still be resumed has to be asked again each time a
  // surface that offers Resume appears.
  it('asks the main process for the records again when it appears', async () => {
    const resumed = sessionRecordOf(closedRecord, { resumable: true })
    listRecords.mockResolvedValue({ data: [resumed] })
    const { result } = renderHook(() => useSessionFacts())
    await waitFor(() =>
      expect(result.current.find((f) => f.sessionId === 'gone')!.resumable).toBe(true)
    )
    expect(listRecords).toHaveBeenCalledTimes(1)
  })

  it('follows a change in the session store', () => {
    const { result } = renderHook(() => useSessionFacts())
    act(() => {
      useSessionStore.setState({
        sessions: new Map([['s1', { ...session, busy: true }]]),
      })
    })
    expect(result.current[0].state).toBe('working')
  })
})

describe('useIssue', () => {
  it('loads the issue for a work item and returns it once read', async () => {
    const home = issueOf({ key: 'TAV-1', title: 'Home' })
    getIssue.mockResolvedValue({ issue: home })
    const { result } = renderHook(() => useIssue({ tracker: 'linear', key: 'TAV-1' }))
    expect(result.current).toBeUndefined()
    await waitFor(() => expect(result.current).toEqual(home))
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
        ['linear:TAV-1', issueOf({ key: 'TAV-1', title: 'Home' })],
        ['linear:TAV-2', null],
      ]),
    })
    const { result } = renderHook(() => useIssueTitles())
    expect([...result.current]).toEqual([['linear:TAV-1', 'Home']])
  })
})
