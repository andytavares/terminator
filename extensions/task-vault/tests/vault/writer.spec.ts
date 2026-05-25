import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'

// Must mock BEFORE importing writer so the module picks up the mock
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    writeFile: vi.fn(),
    rename: vi.fn(),
    readFile: vi.fn(),
    mkdir: vi.fn(),
  }
})

import { completeTask, migrateTask, addTask, writeFileAtomic } from '../../src/vault/writer'

const VAULT = '/vault'
const TODAY_FILE = `${VAULT}/daily/2026-05-19.md`

const fileContent = `- [ ] Task one
- [ ] Task two
- [ ] Task three`

beforeEach(() => {
  vi.mocked(fs.readFile).mockResolvedValue(fileContent as unknown as Buffer)
  vi.mocked(fs.writeFile).mockResolvedValue()
  vi.mocked(fs.rename).mockResolvedValue()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('writeFileAtomic', () => {
  it('writes to temp file then renames', async () => {
    await writeFileAtomic('/vault/daily/2026-05-19.md', 'content')
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalledOnce()
    const writtenPath = vi.mocked(fs.writeFile).mock.calls[0][0] as string
    expect(writtenPath).not.toBe('/vault/daily/2026-05-19.md')
    expect(vi.mocked(fs.rename)).toHaveBeenCalledWith(writtenPath, '/vault/daily/2026-05-19.md')
  })
})

describe('completeTask', () => {
  it('replaces [ ] with [x] and appends completion date', async () => {
    await completeTask(TODAY_FILE, 1, '2026-05-19')
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    const lines = written.split('\n')
    expect(lines[0]).toMatch(/- \[x\]/)
    expect(lines[0]).toContain('2026-05-19')
  })

  it('returns STALE_ID error when line does not contain open task', async () => {
    const doneContent = '- [x] Already done\n- [ ] Task two'
    vi.mocked(fs.readFile).mockResolvedValue(doneContent as unknown as Buffer)
    const result = await completeTask(TODAY_FILE, 1, '2026-05-19')
    expect(result).toEqual({ error: 'STALE_ID' })
    expect(vi.mocked(fs.writeFile)).not.toHaveBeenCalled()
  })

  it('returns STALE_ID error when line number out of range', async () => {
    const result = await completeTask(TODAY_FILE, 99, '2026-05-19')
    expect(result).toEqual({ error: 'STALE_ID' })
  })
})

describe('migrateTask', () => {
  it('replaces [ ] with [>] in source file', async () => {
    await migrateTask(TODAY_FILE, 1, '2026-05-20', VAULT)
    const writeCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find((c) => (c[0] as string).includes('.tmp'))
    expect(writeCall).toBeDefined()
    const written = writeCall![1] as string
    expect(written).toContain('- [>]')
  })

  it('appends task to target day file', async () => {
    vi.mocked(fs.readFile)
      .mockResolvedValueOnce(fileContent as unknown as Buffer) // source read
      .mockResolvedValueOnce('' as unknown as Buffer) // target day read (empty/new)

    await migrateTask(TODAY_FILE, 2, '2026-05-20', VAULT)

    const writeCalls = vi.mocked(fs.writeFile).mock.calls
    expect(writeCalls.length).toBeGreaterThanOrEqual(2)
  })

  it('returns STALE_ID when source line has no open task', async () => {
    const doneContent = '- [x] Done\n- [ ] Two'
    vi.mocked(fs.readFile).mockResolvedValue(doneContent as unknown as Buffer)
    const result = await migrateTask(TODAY_FILE, 1, '2026-05-20', VAULT)
    expect(result).toEqual({ error: 'STALE_ID' })
  })
})

describe('addTask', () => {
  it('appends task to file end when no section specified', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(fileContent as unknown as Buffer)
    await addTask(TODAY_FILE, 'New task')
    const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
    const written = writeCall[1] as string
    expect(written).toContain('- [ ] New task')
  })

  it('appends task under specified section heading', async () => {
    const contentWithSections = `## Morning
- [ ] Existing

## Afternoon
- [ ] Other`
    vi.mocked(fs.readFile).mockResolvedValue(contentWithSections as unknown as Buffer)
    await addTask(TODAY_FILE, 'New task', 'Morning')
    const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
    const written = writeCall[1] as string
    const lines = written.split('\n')
    const morningIdx = lines.findIndex((l) => l.includes('## Morning'))
    const newTaskIdx = lines.findIndex((l) => l.includes('New task'))
    expect(newTaskIdx).toBeGreaterThan(morningIdx)
  })

  it('creates section if it does not exist', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('- [ ] Existing' as unknown as Buffer)
    await addTask(TODAY_FILE, 'New task', 'Afternoon')
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).toContain('## Afternoon')
    expect(written).toContain('- [ ] New task')
  })

  it('uses atomic write', async () => {
    await addTask(TODAY_FILE, 'New task')
    const writtenPath = vi.mocked(fs.writeFile).mock.calls[0][0] as string
    expect(writtenPath).not.toBe(TODAY_FILE)
    expect(vi.mocked(fs.rename)).toHaveBeenCalled()
  })
})
