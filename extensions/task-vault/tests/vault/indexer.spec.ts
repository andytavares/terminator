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

  it('parses project files and includes them in index (lines 64-88)', async () => {
    const projectContent = `---
status: active
area: Work
deadline: 2026-12-31
---
# My Project

- [ ] Open project task
- [x] Done project task
`
    vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
      const p = dirPath.toString()
      if (p.endsWith('/daily')) return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      if (p.endsWith('/projects'))
        return [makeDirent('my-project.md')] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    })
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const p = filePath.toString()
      if (p.endsWith('my-project.md')) return projectContent as unknown as Buffer
      if (p.endsWith('inbox.md')) return '' as unknown as Buffer // empty inbox
      return '' as unknown as Buffer
    })
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: new Date('2026-05-01T00:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof fs.stat>>)

    const index = await buildIndex(VAULT)
    expect(index.projects).toHaveLength(1)
    expect(index.projects[0].name).toBe('my-project')
    expect(index.projects[0].area).toBe('Work')
    // gray-matter may parse dates as Date objects — just check it's defined
    expect(index.projects[0].deadline).toBeDefined()
    expect(index.projects[0].status).toBe('active')
    // Has one open task → not stale
    expect(index.projects[0].isStale).toBe(false)
    expect(index.projects[0].nextActionCount).toBe(1)
    // Tasks from project should be in tasks array
    const projTask = index.tasks.find((t) => t.filePath.includes('my-project'))
    expect(projTask).toBeDefined()
  })

  it('marks project as stale when no open tasks (line 85)', async () => {
    const projectContent = `---
status: active
---
# Stale Project

- [x] Already done
`
    vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
      const p = dirPath.toString()
      if (p.endsWith('/daily')) return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      if (p.endsWith('/projects'))
        return [makeDirent('stale-project.md')] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    })
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const p = filePath.toString()
      if (p.endsWith('stale-project.md')) return projectContent as unknown as Buffer
      return '' as unknown as Buffer
    })
    vi.mocked(fs.stat).mockResolvedValue({
      mtime: new Date(),
    } as unknown as Awaited<ReturnType<typeof fs.stat>>)

    const index = await buildIndex(VAULT)
    expect(index.projects[0].isStale).toBe(true)
    expect(index.projects[0].nextActionCount).toBe(0)
  })

  it('skips non-.md files in projects directory (line 71)', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
      const p = dirPath.toString()
      if (p.endsWith('/daily')) return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      if (p.endsWith('/projects'))
        return [makeDirent('README.txt'), makeDirent('archive', true)] as unknown as Awaited<
          ReturnType<typeof fs.readdir>
        >
      return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    })

    const index = await buildIndex(VAULT)
    expect(index.projects).toHaveLength(0)
  })

  it('handles missing projects directory gracefully (lines 104-107 catch block)', async () => {
    vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
      const p = dirPath.toString()
      if (p.endsWith('/daily')) return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      // projects dir doesn't exist → throw
      const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      throw err
    })

    const index = await buildIndex(VAULT)
    expect(index.projects).toHaveLength(0)
  })

  it('uses "active" as default status when frontmatter has no status (line 82)', async () => {
    const projectContent = `# No Frontmatter Project

- [ ] A task
`
    vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
      const p = dirPath.toString()
      if (p.endsWith('/daily')) return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      if (p.endsWith('/projects'))
        return [makeDirent('no-fm.md')] as unknown as Awaited<ReturnType<typeof fs.readdir>>
      return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>
    })
    vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
      const p = filePath.toString()
      if (p.endsWith('no-fm.md')) return projectContent as unknown as Buffer
      return '' as unknown as Buffer
    })
    vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
      ReturnType<typeof fs.stat>
    >)

    const index = await buildIndex(VAULT)
    expect(index.projects[0].status).toBe('active')
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

  it('throws non-ENOENT errors (lines 133-134)', async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'))
    await expect(readIndex(VAULT)).rejects.toThrow('Permission denied')
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
