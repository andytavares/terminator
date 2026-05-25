import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
  }
})

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

const { mockRun, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn().mockReturnValue({ changes: 1 })
  const mockAll = vi.fn().mockReturnValue([])
  const mockPrepare = vi.fn().mockReturnValue({ run: mockRun, all: mockAll })
  return { mockRun, mockAll, mockPrepare }
})
vi.mock('../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
}))

import { registerKanbanIpcHandlers, setVaultPath } from '../../src/ipc/kanban.ipc.js'

describe('registerKanbanIpcHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setVaultPath('/tmp/vault')
    mockHandle.mockImplementation(
      (_channel: string, handler: (...args: unknown[]) => unknown) => handler
    )
  })

  it('registers five IPC handlers', () => {
    registerKanbanIpcHandlers()
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:get-config', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:save-config', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:list-tasks', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:list-contexts', expect.any(Function))
    expect(mockHandle).toHaveBeenCalledWith('task-vault:kanban:move-task', expect.any(Function))
  })

  it('returns dispose function that removes all handlers', () => {
    const dispose = registerKanbanIpcHandlers()
    dispose()
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:get-config')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:save-config')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:list-tasks')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:list-contexts')
    expect(mockRemoveHandler).toHaveBeenCalledWith('task-vault:kanban:move-task')
  })

  describe('get-config handler', () => {
    it('returns default config when file does not exist', () => {
      ;(fs.readFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('ENOENT')
      })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:get-config'
      )![1]
      const result = handler()
      expect(result).toMatchObject({
        viewMode: 'list',
        lanes: expect.arrayContaining([expect.objectContaining({ id: 'todo', label: 'Todo' })]),
        swimlaneGrouping: 'none',
      })
    })

    it('returns parsed config from file', () => {
      const stored = {
        viewMode: 'kanban',
        lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
        swimlaneGrouping: 'project',
      }
      ;(fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(stored))
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:get-config'
      )![1]
      const result = handler()
      expect(result).toMatchObject(stored)
    })
  })

  describe('save-config handler', () => {
    it('writes valid config to disk', () => {
      ;(fs.readFileSync as ReturnType<typeof vi.fn>).mockReturnValue('{}')
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:save-config'
      )![1]
      const config = {
        viewMode: 'kanban',
        lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
        swimlaneGrouping: 'none',
      }
      const result = handler(null, config)
      expect(result).toEqual({ ok: true })
      expect(fs.writeFileSync).toHaveBeenCalled()
    })

    it('returns error for invalid payload', () => {
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:save-config'
      )![1]
      const result = handler(null, { invalid: true })
      expect(result).toHaveProperty('error')
    })
  })

  describe('list-contexts handler', () => {
    it('returns distinct contexts from DB', () => {
      mockAll.mockReturnValue([{ context: 'work' }, { context: 'home' }])
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-contexts'
      )![1] as () => unknown
      const result = handler() as { contexts: string[] }
      expect(result.contexts).toEqual(['work', 'home'])
    })
  })

  describe('list-tasks handler', () => {
    it('returns tasks from DB excluding migrated and cancelled', () => {
      mockAll.mockReturnValue([
        {
          id: 'task-1',
          text: 'Do something',
          status: 'open',
          project: 'alpha',
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: '{}',
        },
      ])
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: unknown[] }
      expect(result.tasks).toHaveLength(1)
      expect((result.tasks[0] as Record<string, unknown>).id).toBe('task-1')
    })

    it('extracts description from metadata', () => {
      mockAll.mockReturnValue([
        {
          id: 'task-2',
          text: 'Task with desc',
          status: 'open',
          project: null,
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: JSON.stringify({ description: 'Detailed explanation' }),
        },
      ])
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: Record<string, unknown>[] }
      expect(result.tasks[0].description).toBe('Detailed explanation')
    })

    it('returns no description when metadata is empty', () => {
      mockAll.mockReturnValue([
        {
          id: 'task-3',
          text: 'No desc',
          status: 'open',
          project: null,
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: '{}',
        },
      ])
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: Record<string, unknown>[] }
      expect(result.tasks[0].description).toBeUndefined()
    })
  })

  describe('readConfig / writeConfig with empty vaultPath', () => {
    it('get-config returns default config when vaultPath is empty', () => {
      setVaultPath('')
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:get-config'
      )![1]
      const result = handler()
      expect(result).toMatchObject({ viewMode: 'list', swimlaneGrouping: 'none' })
      // readFileSync must not have been called (vaultPath guard returned early)
      expect(fs.readFileSync).not.toHaveBeenCalled()
    })

    it('save-config writes nothing when vaultPath is empty', () => {
      setVaultPath('')
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:save-config'
      )![1]
      const config = {
        viewMode: 'kanban',
        lanes: [{ id: 'todo', label: 'Todo', taskStatuses: ['open'] }],
        swimlaneGrouping: 'none',
      }
      const result = handler(null, config)
      expect(result).toEqual({ ok: true })
      expect(fs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('error paths', () => {
    it('list-tasks returns error when getDb throws', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('db unavailable')
      })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { error: string }
      expect(result.error).toMatch(/db unavailable/)
    })

    it('list-contexts returns error when getDb throws', () => {
      mockPrepare.mockImplementationOnce(() => {
        throw new Error('db unavailable')
      })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-contexts'
      )![1] as () => unknown
      const result = handler() as { error: string }
      expect(result.error).toMatch(/db unavailable/)
    })

    it('list-tasks handles malformed metadata gracefully', () => {
      mockAll.mockReturnValue([
        {
          id: 'task-bad',
          text: 'Bad meta',
          status: 'open',
          project: null,
          context: null,
          area: null,
          due_date: null,
          terminator_links: '[]',
          metadata: 'not-json{{{',
        },
      ])
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(
        ([ch]) => ch === 'task-vault:kanban:list-tasks'
      )![1]
      const result = handler() as { tasks: Record<string, unknown>[] }
      expect(result.tasks[0].description).toBeUndefined()
    })
  })

  describe('move-task handler', () => {
    it('updates task status in DB', () => {
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(([ch]) => ch === 'task-vault:kanban:move-task')![1]
      const result = handler(null, { taskId: 'task-1', toStatus: 'in-progress' })
      expect(result).toEqual({ ok: true })
      expect(mockRun).toHaveBeenCalledWith('in-progress', expect.any(String), 'task-1')
    })

    it('returns error when task not found', () => {
      mockRun.mockReturnValue({ changes: 0 })
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(([ch]) => ch === 'task-vault:kanban:move-task')![1]
      const result = handler(null, { taskId: 'nonexistent', toStatus: 'done' })
      expect(result).toEqual({ error: 'Task not found' })
    })

    it('returns error for invalid toStatus', () => {
      registerKanbanIpcHandlers()
      const handler = mockHandle.mock.calls.find(([ch]) => ch === 'task-vault:kanban:move-task')![1]
      const result = handler(null, { taskId: 'task-1', toStatus: 'invalid-status' })
      expect(result).toHaveProperty('error')
    })
  })
})
