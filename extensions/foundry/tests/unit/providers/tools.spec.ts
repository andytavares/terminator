import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn(),
  readdir: vi.fn(),
}))

import * as fsp from 'node:fs/promises'
import { executeTool } from '../../../src/providers/tools.js'

const mockReadFile = vi.mocked(fsp.readFile)
const mockWriteFile = vi.mocked(fsp.writeFile)
const mockAccess = vi.mocked(fsp.access)
const mockReaddir = vi.mocked(fsp.readdir)

const WS = '/workspace'

beforeEach(() => vi.resetAllMocks())

describe('executeTool — read_file', () => {
  it('returns file content on success', async () => {
    mockReadFile.mockResolvedValueOnce('hello world' as never)
    const r = await executeTool('read_file', { path: 'src/foo.ts' }, WS)
    expect(r.output).toBe('hello world')
    expect(r.event).toBeUndefined()
  })

  it('returns error message when file missing', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'))
    const r = await executeTool('read_file', { path: 'missing.ts' }, WS)
    expect(r.output).toContain('Error reading file')
  })
})

describe('executeTool — write_file', () => {
  it('returns file-changed event for new file', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT')) // file does not exist yet
    mockWriteFile.mockResolvedValueOnce(undefined)
    const r = await executeTool('write_file', { path: 'src/new.ts', content: 'line1\nline2' }, WS)
    expect(r.output).toContain('Wrote')
    expect(r.event?.type).toBe('file-changed')
    expect(r.event?.change.status).toBe('new')
  })

  it('returns modified status for existing file', async () => {
    mockAccess.mockResolvedValueOnce(undefined) // file exists
    mockWriteFile.mockResolvedValueOnce(undefined)
    const r = await executeTool('write_file', { path: 'src/old.ts', content: 'updated' }, WS)
    expect(r.event?.change.status).toBe('modified')
  })

  it('returns error message when write fails', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'))
    mockWriteFile.mockRejectedValueOnce(new Error('EACCES'))
    const r = await executeTool('write_file', { path: 'x.ts', content: '' }, WS)
    expect(r.output).toContain('Error writing file')
  })
})

describe('executeTool — str_replace', () => {
  it('replaces string and returns file-changed event', async () => {
    mockReadFile.mockResolvedValueOnce('foo bar baz' as never)
    mockWriteFile.mockResolvedValueOnce(undefined)
    const r = await executeTool('str_replace', { path: 'f.ts', old_str: 'bar', new_str: 'QUX' }, WS)
    expect(r.output).toContain('Replaced')
    expect(r.event?.type).toBe('file-changed')
  })

  it('returns error when old_str not found', async () => {
    mockReadFile.mockResolvedValueOnce('hello world' as never)
    const r = await executeTool(
      'str_replace',
      { path: 'f.ts', old_str: 'nothere', new_str: 'x' },
      WS
    )
    expect(r.output).toContain('old_str not found')
  })

  it('returns error when file read fails', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'))
    const r = await executeTool('str_replace', { path: 'f.ts', old_str: 'x', new_str: 'y' }, WS)
    expect(r.output).toContain('Error in str_replace')
  })
})

describe('executeTool — list_files', () => {
  it('lists files and directories', async () => {
    mockReaddir.mockResolvedValueOnce([
      { name: 'src', isDirectory: () => true },
      { name: 'readme.md', isDirectory: () => false },
    ] as never)
    const r = await executeTool('list_files', { dir: '.' }, WS)
    expect(r.output).toContain('[dir]  src')
    expect(r.output).toContain('[file] readme.md')
  })

  it('returns (empty directory) for empty dir', async () => {
    mockReaddir.mockResolvedValueOnce([] as never)
    const r = await executeTool('list_files', { dir: 'empty' }, WS)
    expect(r.output).toBe('(empty directory)')
  })

  it('returns error when readdir fails', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'))
    const r = await executeTool('list_files', { dir: 'gone' }, WS)
    expect(r.output).toContain('Error listing files')
  })

  it('uses "." as default dir when not provided', async () => {
    mockReaddir.mockResolvedValueOnce([] as never)
    const r = await executeTool('list_files', {}, WS)
    expect(r.output).toBe('(empty directory)')
  })
})

describe('executeTool — unknown tool', () => {
  it('returns Unknown tool message', async () => {
    const r = await executeTool('nonexistent_tool', {}, WS)
    expect(r.output).toContain('Unknown tool')
  })
})
