import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readdir: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
  }
})

import { buildIndex, readIndex, getTaskById } from '../../src/vault/indexer'
import type { VaultIndex } from '../../src/vault/types'

const VAULT = '/vault'

function makeDirent(name: string, isDir = false): Dirent {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => !isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    path: '',
    parentPath: '',
  } as unknown as Dirent
}

const dailyContent = `- [ ] Open task +proj @ctx #area due:2026-06-01
- [x] Done task`

const inboxContent = `- [ ] Inbox item one
- [ ] Inbox item two`

beforeEach(() => {
  vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
    const p = dirPath.toString()
    if (p.endsWith('/daily'))
      return [makeDirent('2026-05-19.md')] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    if (p.endsWith('/projects')) return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    if (p.endsWith('/areas')) return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
  })
  vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
    const p = filePath.toString()
    if (p.endsWith('2026-05-19.md')) return dailyContent as unknown as Buffer
    if (p.endsWith('inbox.md')) return inboxContent as unknown as Buffer
    if (p.endsWith('index.json'))
      return JSON.stringify({
        version: 1,
        builtAt: '',
        vaultPath: VAULT,
        tasks: [],
        projects: [],
        inboxCount: 0,
      }) as unknown as Buffer
    return '' as unknown as Buffer
  })
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('buildIndex', () => {
  it('includes open tasks from daily files', async () => {
    const index = await buildIndex(VAULT)
    const open = index.tasks.filter((t) => t.status === 'open')
    expect(open.length).toBeGreaterThanOrEqual(1)
  })

  it('includes inbox items in inboxCount', async () => {
    const index = await buildIndex(VAULT)
    expect(index.inboxCount).toBe(2)
  })

  it('excludes files in archive/ directory', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
      const p = dirPath.toString()
      if (p.endsWith('/daily'))
        return [makeDirent('2026-05-19.md'), makeDirent('archive', true)] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >
      if (p.endsWith('/archive'))
        return [makeDirent('old.md')] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    })
    const index = await buildIndex(VAULT)
    const archiveTasks = index.tasks.filter((t) => t.filePath.includes('archive'))
    expect(archiveTasks).toHaveLength(0)
  })

  it('writes index to .todo/index.json', async () => {
    await buildIndex(VAULT)
    const writeCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('index.json'))
    expect(writeCall).toBeDefined()
  })

  it('sets version and vaultPath fields', async () => {
    const index = await buildIndex(VAULT)
    expect(index.version).toBe(1)
    expect(index.vaultPath).toBe(VAULT)
  })

  it('sets builtAt to ISO date string', async () => {
    const index = await buildIndex(VAULT)
    expect(new Date(index.builtAt).toISOString()).toBe(index.builtAt)
  })
})

describe('readIndex', () => {
  it('reads and parses index.json', async () => {
    const index = await readIndex(VAULT)
    expect(index).not.toBeNull()
    expect(index?.vaultPath).toBe(VAULT)
  })

  it('returns null when index file does not exist', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const index = await readIndex(VAULT)
    expect(index).toBeNull()
  })
})

describe('getTaskById', () => {
  it('returns task matching filepath:line ID', () => {
    const index: VaultIndex = {
      version: 1,
      builtAt: new Date().toISOString(),
      vaultPath: VAULT,
      tasks: [
        {
          id: '/vault/daily/2026-05-19.md:1',
          filePath: '/vault/daily/2026-05-19.md',
          line: 1,
          status: 'open',
          text: 'Task',
          terminatorLinks: [],
        },
      ],
      projects: [],
      inboxCount: 0,
    }
    const task = getTaskById(index, '/vault/daily/2026-05-19.md:1')
    expect(task).not.toBeNull()
    expect(task?.text).toBe('Task')
  })

  it('returns null for unknown ID', () => {
    const index: VaultIndex = {
      version: 1,
      builtAt: '',
      vaultPath: VAULT,
      tasks: [],
      projects: [],
      inboxCount: 0,
    }
    expect(getTaskById(index, 'nonexistent:1')).toBeNull()
  })
})
