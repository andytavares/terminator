import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
  }
})

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => ({ content, data: {} })),
}))

vi.mock('../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 }),
}))

import { registerVaultIpcHandlers, setVaultPath } from '../../src/ipc/vault.ipc'

const VAULT = '/vault'
const INBOX_CONTENT = '- [ ] Item one\n- [ ] Item two\n- [ ] Item three\n'

beforeEach(() => {
  vi.clearAllMocks()
  setVaultPath(VAULT)
  vi.mocked(fs.readFile).mockResolvedValue(INBOX_CONTENT as unknown as Buffer)
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.rename).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
})

function getHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  registerVaultIpcHandlers()
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return handler
}

describe('task-vault:vault:process-inbox-item', () => {
  const INBOX_FILE = `${VAULT}/inbox.md`
  const TASK_ID = `${INBOX_FILE}:1`

  it('action:trash removes item from inbox', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'trash' })
    expect(result).toMatchObject({ success: true })
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).not.toContain('Item one')
  })

  it('action:do-now marks item with in-progress marker', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    await handler({}, { taskId: TASK_ID, action: 'do-now' })
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).toContain('[/]')
  })

  it('action:someday files to someday.md', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(INBOX_CONTENT as unknown as Buffer) // inbox read
      .mockResolvedValue('' as unknown as Buffer) // someday.md (empty)
    const handler = getHandler('task-vault:vault:process-inbox-item')
    await handler({}, { taskId: TASK_ID, action: 'someday' })
    // atomic write: writeFile goes to tmp, rename goes to destination
    const renameCalls = vi.mocked(fs.rename).mock.calls
    const somedayRename = renameCalls.find((c) => (c[1] as string).includes('someday.md'))
    expect(somedayRename).toBeDefined()
  })

  it('action:file with destination files to destination', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(INBOX_CONTENT as unknown as Buffer) // inbox read
      .mockResolvedValue('' as unknown as Buffer) // dest file
    const handler = getHandler('task-vault:vault:process-inbox-item')
    await handler({}, { taskId: TASK_ID, action: 'file', destination: 'projects/alpha.md' })
    const renameCalls = vi.mocked(fs.rename).mock.calls
    const destRename = renameCalls.find((c) => (c[1] as string).includes('alpha.md'))
    expect(destRename).toBeDefined()
  })

  it('returns STALE_ID when task not open at that line', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('- [x] Already done\n' as unknown as Buffer)
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: `${INBOX_FILE}:1`, action: 'trash' })
    expect(result).toMatchObject({ error: 'STALE_ID' })
  })
})
