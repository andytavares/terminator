import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useWorkspaceStore } from '../../../../src/renderer/stores/workspace.store'
import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useTaskStore } from '../../../../src/renderer/stores/task.store'
import { switchLane } from '../../../../src/renderer/terminal/switch-lane'
import type { Task } from '../../../../src/shared/schemas/tasks.schema'
import { projectFixture, workspaceFixture } from '../../../support/renderer-stores'

const backend = workspaceFixture({ id: 'ws-1', name: 'Backend', folderPath: '/b' })
const frontend = workspaceFixture({ id: 'ws-2', name: 'Frontend', folderPath: '/f' })

const rateLimits: Task = {
  id: '6f1c2d34-0000-4000-8000-000000000002',
  title: 'Rate limits across services',
  lanes: [
    { repoRoot: '/b', branch: 'rate-limits' },
    { repoRoot: '/f', branch: 'rate-limits' },
  ],
  ticket: null,
  focus: false,
  doneAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  archivedAt: null,
}

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: { project: { list: vi.fn(async () => ({ projects: [] })) } },
  })
  useWorkspaceStore.setState({
    ...useWorkspaceStore.getInitialState(),
    workspaces: [backend, frontend],
    activeWorkspaceId: 'ws-1',
    activeProjectId: 'p-back',
    projectsByWorkspaceId: new Map([
      [
        'ws-1',
        [
          projectFixture({ id: 'p-back', workspaceId: 'ws-1', gitBranch: 'rate-limits' }),
          projectFixture({ id: 'p-main', workspaceId: 'ws-1', gitBranch: 'main' }),
        ],
      ],
      ['ws-2', [projectFixture({ id: 'p-front', workspaceId: 'ws-2', gitBranch: 'rate-limits' })]],
    ]),
  })
  useSessionStore.setState(useSessionStore.getInitialState())
  useTaskStore.setState({ tasks: [rateLimits] })
})

const active = () => useWorkspaceStore.getState().activeProjectId

describe('switchLane (Ctrl+1–9)', () => {
  it('shows the task lane with that number', () => {
    switchLane(1)
    expect(active()).toBe('p-front')
    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2')
    switchLane(0)
    expect(active()).toBe('p-back')
  })

  it('does nothing for a number past the last lane', () => {
    switchLane(5)
    expect(active()).toBe('p-back')
  })

  it('does nothing when the visible branch is in no task', () => {
    useWorkspaceStore.setState({ activeProjectId: 'p-main' })
    switchLane(1)
    expect(active()).toBe('p-main')
  })
})
