import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(), writeFile: vi.fn(), rename: vi.fn(), mkdir: vi.fn() }
})

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

const { mockIndex } = vi.hoisted(() => ({
  mockIndex: {
    version: 1,
    builtAt: '',
    vaultPath: '/vault',
    tasks: [
      {
        id: '/vault/daily/2026-05-20.md:5',
        filePath: '/vault/daily/2026-05-20.md',
        line: 5,
        text: 'Linked task',
        status: 'open',
        terminatorLinks: ['550e8400-e29b-41d4-a716-446655440000'],
        metadata: {},
      },
    ],
    projects: [
      {
        id: '/vault/projects/alpha.md',
        filePath: '/vault/projects/alpha.md',
        name: 'Alpha',
        status: 'active',
        terminatorLinks: ['550e8400-e29b-41d4-a716-446655440000'],
        isStale: false,
        nextActionCount: 1,
      },
    ],
    inboxCount: 0,
  },
}))

vi.mock('../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue(mockIndex),
  readIndex: vi.fn().mockResolvedValue(mockIndex),
}))

import { registerLinksIpcHandlers, setVaultPath } from '../../src/ipc/links.ipc'

const VAULT = '/vault'
const UUID = '550e8400-e29b-41d4-a716-446655440000'
const TASK_FILE = '/vault/daily/2026-05-20.md'

beforeEach(() => {
  vi.clearAllMocks()
  setVaultPath(VAULT)
  vi.mocked(fs.readFile).mockResolvedValue('- [ ] Task to link\n' as unknown as Buffer)
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.rename).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
})

function getHandler(channel: string) {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  const dispose = registerLinksIpcHandlers()
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return { handler, dispose }
}

describe('task-vault:links:create', () => {
  it('appends terminator link to file via taskId', async () => {
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: `${TASK_FILE}:5`, targetId: UUID })
    expect(result).toMatchObject({ success: true })
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).toContain(`terminator:${UUID}`)
  })

  it('appends via projectFilePath', async () => {
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler(
      {},
      { projectFilePath: '/vault/projects/alpha.md', targetId: UUID }
    )
    expect(result).toMatchObject({ success: true })
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const { handler } = getHandler('task-vault:links:create')
    const result = await handler({}, { taskId: `${TASK_FILE}:5` })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})

describe('task-vault:links:remove', () => {
  it('removes terminator link from file', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(`- [ ] Task terminator:${UUID}\n` as unknown as Buffer)
    const { handler } = getHandler('task-vault:links:remove')
    const result = await handler({}, { taskId: `${TASK_FILE}:1`, targetId: UUID })
    expect(result).toMatchObject({ success: true })
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).not.toContain(`terminator:${UUID}`)
  })
})

describe('task-vault:links:get-for-terminator-target', () => {
  it('returns linked tasks and projects for targetId', async () => {
    const { handler } = getHandler('task-vault:links:get-for-terminator-target')
    const result = (await handler({}, { targetId: UUID })) as {
      tasks: unknown[]
      projects: unknown[]
    }
    expect(result.tasks).toHaveLength(1)
    expect(result.projects).toHaveLength(1)
  })

  it('returns empty when targetId has no links', async () => {
    const { handler } = getHandler('task-vault:links:get-for-terminator-target')
    const result = (await handler({}, { targetId: '00000000-0000-0000-0000-000000000000' })) as {
      tasks: unknown[]
      projects: unknown[]
    }
    expect(result.tasks).toHaveLength(0)
    expect(result.projects).toHaveLength(0)
  })

  it('returns VALIDATION_ERROR for missing targetId', async () => {
    const { handler } = getHandler('task-vault:links:get-for-terminator-target')
    const result = await handler({}, {})
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})
