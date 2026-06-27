import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mockInvoke = vi.fn()
const mockOn = vi.fn(() => vi.fn())

let mockSelectedContexts: string[] = []

vi.mock('../../src/stores/vault.store', () => ({
  useVaultStore: (
    sel?: (s: {
      selectedContexts: string[]
      setKanbanLanes: () => void
      loadToday: () => Promise<void>
      tickCalendar: () => void
    }) => unknown
  ) => {
    const store = {
      selectedContexts: mockSelectedContexts,
      setKanbanLanes: vi.fn(),
      loadToday: vi.fn().mockResolvedValue(undefined),
      tickCalendar: vi.fn(),
    }
    if (sel) return sel(store)
    return store
  },
}))

Object.defineProperty(window, 'electronAPI', {
  value: {
    extensionBridge: {
      invoke: mockInvoke,
      on: mockOn,
    },
  },
  writable: true,
  configurable: true,
})

// localStorage mock
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, val: string) => {
      store[key] = val
    },
    removeItem: (key: string) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true })

const DEFAULT_CONFIG = {
  viewMode: 'list',
  lanes: [
    { id: 'todo', label: 'Todo', taskStatuses: ['open'] },
    { id: 'in-progress', label: 'In Progress', taskStatuses: ['in-progress'] },
    { id: 'in-review', label: 'In Review', taskStatuses: ['in-review'] },
    { id: 'done', label: 'Done', taskStatuses: ['done'] },
  ],
  swimlaneGrouping: 'none',
}

const SAMPLE_TASKS = [
  {
    id: 'task-1',
    text: 'Write tests',
    status: 'open',
    project: 'alpha',
    area: 'work',
    context: 'computer',
  },
  {
    id: 'task-2',
    text: 'Deploy app',
    status: 'in-progress',
    project: 'alpha',
    context: 'computer',
  },
  { id: 'task-3', text: 'Review PR', status: 'in-review', context: 'work' },
  { id: 'task-4', text: 'Archive docs', status: 'done' },
]

import { KanbanBoard } from '../../src/components/KanbanBoard.js'

describe('KanbanBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorageMock.clear()
    mockSelectedContexts = []
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:kanban:get-config') return Promise.resolve(DEFAULT_CONFIG)
      if (channel === 'task-vault:kanban:list-tasks')
        return Promise.resolve({ tasks: SAMPLE_TASKS })
      return Promise.resolve({ ok: true })
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all four default lane headers', async () => {
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getByText('Todo')).toBeTruthy()
      expect(screen.getByText('In Progress')).toBeTruthy()
      expect(screen.getByText('In Review')).toBeTruthy()
      expect(screen.getByText('Done')).toBeTruthy()
    })
  })

  it('distributes tasks into the correct lanes', async () => {
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getByText('Write tests')).toBeTruthy()
      expect(screen.getByText('Deploy app')).toBeTruthy()
      expect(screen.getByText('Review PR')).toBeTruthy()
      expect(screen.getByText('Archive docs')).toBeTruthy()
    })
  })

  it('shows project and area tags', async () => {
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getAllByText('@alpha').length).toBeGreaterThan(0)
      expect(screen.getByText('#work')).toBeTruthy()
    })
  })

  it('renders swimlane toolbar', async () => {
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getByText('Swimlanes:')).toBeTruthy()
      expect(screen.getByText('Off')).toBeTruthy()
      expect(screen.getByText('Project')).toBeTruthy()
      expect(screen.getByText('Area')).toBeTruthy()
    })
  })

  it('switches to project swimlane grouping', async () => {
    const user = userEvent.setup()
    render(<KanbanBoard />)
    await waitFor(() => screen.getByText('Project'))
    await user.click(screen.getByText('Project'))
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'task-vault:kanban:save-config',
        expect.objectContaining({ swimlaneGrouping: 'project' })
      )
    })
  })

  it('renders swimlane group header when grouping by project', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:kanban:get-config')
        return Promise.resolve({ ...DEFAULT_CONFIG, swimlaneGrouping: 'project' })
      if (channel === 'task-vault:kanban:list-tasks')
        return Promise.resolve({ tasks: SAMPLE_TASKS })
      return Promise.resolve({ ok: true })
    })
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeTruthy()
    })
  })

  it('shows Lanes button to open lane editor', async () => {
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getByText('Lanes')).toBeTruthy()
    })
  })

  it('shows empty lane placeholder', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:kanban:get-config') return Promise.resolve(DEFAULT_CONFIG)
      if (channel === 'task-vault:kanban:list-tasks') return Promise.resolve({ tasks: [] })
      return Promise.resolve({ ok: true })
    })
    render(<KanbanBoard />)
    await waitFor(() => {
      const dashes = screen.getAllByText('—')
      expect(dashes.length).toBeGreaterThan(0)
    })
  })

  it('shows only tasks with matching context when filter is active', async () => {
    mockSelectedContexts = ['computer']
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getByText('Write tests')).toBeTruthy()
      expect(screen.getByText('Deploy app')).toBeTruthy()
    })
    // task-3 has context 'work', not 'computer' — hidden
    expect(screen.queryByText('Review PR')).toBeNull()
    // task-4 has no context — hidden when filter is active
    expect(screen.queryByText('Archive docs')).toBeNull()
  })

  it('shows error when list-tasks fails', async () => {
    mockInvoke.mockImplementation((channel: string) => {
      if (channel === 'task-vault:kanban:get-config') return Promise.resolve(DEFAULT_CONFIG)
      if (channel === 'task-vault:kanban:list-tasks')
        return Promise.resolve({ error: 'DB not initialized' })
      return Promise.resolve({ ok: true })
    })
    render(<KanbanBoard />)
    await waitFor(() => {
      expect(screen.getByText('DB not initialized')).toBeTruthy()
    })
  })
})
