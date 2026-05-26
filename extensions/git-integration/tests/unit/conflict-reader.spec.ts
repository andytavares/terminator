import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs/promises before importing the module under test
const mockReadFile = vi.fn()
vi.mock('fs/promises', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }))

// Mock child_process + util so git() calls are interceptable
const mockGit = vi.fn()
vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('util', () => ({
  promisify:
    (_fn: unknown) =>
    async (...args: unknown[]) => {
      const result = mockGit(...args)
      if (result instanceof Error) throw result
      return { stdout: typeof result === 'string' ? result : '', stderr: '' }
    },
}))

import {
  readConflictBlocks,
  listConflictedFiles,
  buildConflictSession,
} from '../../src/git/conflict-reader'

const CONFLICT_TEXT = `<<<<<<< HEAD
const x = 1
=======
const x = 2
>>>>>>> feature-branch
`

const FILE_WITH_TWO_CONFLICTS = `line before 1
line before 2
<<<<<<< HEAD
ours A
=======
theirs A
>>>>>>> branch
line between
<<<<<<< HEAD
ours B
=======
theirs B
>>>>>>> branch
line after
`

beforeEach(() => {
  mockGit.mockReset()
  mockReadFile.mockReset()
})

describe('readConflictBlocks', () => {
  it('parses a single conflict block from working tree', () => {
    const blocks = readConflictBlocks('src/foo.ts', CONFLICT_TEXT, '', '', '')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].blockId).toBe('src/foo.ts#0')
    expect(blocks[0].oursText).toContain('const x = 1')
    expect(blocks[0].theirsText).toContain('const x = 2')
    expect(blocks[0].isResolved).toBe(false)
  })

  it('parses two conflict blocks', () => {
    const blocks = readConflictBlocks('src/foo.ts', FILE_WITH_TWO_CONFLICTS, '', '', '')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].blockId).toBe('src/foo.ts#0')
    expect(blocks[1].blockId).toBe('src/foo.ts#1')
    expect(blocks[0].oursText).toContain('ours A')
    expect(blocks[1].oursText).toContain('ours B')
  })

  it('includes context lines before and after conflict', () => {
    const blocks = readConflictBlocks('src/foo.ts', FILE_WITH_TWO_CONFLICTS, '', '', '')
    expect(blocks[0].contextBefore.length).toBeGreaterThan(0)
    expect(blocks[0].contextAfter.length).toBeGreaterThan(0)
  })

  it('stores original conflict text for undo', () => {
    const blocks = readConflictBlocks('src/foo.ts', CONFLICT_TEXT, '', '', '')
    expect(blocks[0].originalConflictText).toContain('<<<<<<<')
    expect(blocks[0].originalConflictText).toContain('=======')
    expect(blocks[0].originalConflictText).toContain('>>>>>>>')
  })

  it('returns empty array when no conflicts in file', () => {
    const blocks = readConflictBlocks(
      'src/foo.ts',
      'clean file content\nno conflicts here\n',
      '',
      '',
      ''
    )
    expect(blocks).toHaveLength(0)
  })
})

describe('listConflictedFiles', () => {
  it('returns list of conflicted file paths', async () => {
    mockGit.mockReturnValueOnce('src/foo.ts\nsrc/bar.ts\n')
    const files = await listConflictedFiles('/repo')
    expect(files).toEqual(['src/foo.ts', 'src/bar.ts'])
  })

  it('returns empty array when no conflicts', async () => {
    mockGit.mockReturnValueOnce('')
    const files = await listConflictedFiles('/repo')
    expect(files).toEqual([])
  })
})

function setupBuildSessionMocks(opts: {
  filePaths: string
  isRebase: boolean
  files: {
    workingTree: string
    oursAuthor: string
    theirsAuthor: string
    oursSubject: string
    theirsSubject: string
  }[]
}) {
  // listConflictedFiles
  mockGit.mockReturnValueOnce(opts.filePaths)

  // detectRebase
  if (opts.isRebase) {
    mockGit.mockReturnValueOnce('abc123')
  } else {
    mockGit.mockReturnValueOnce(new Error('not a rebase'))
  }

  for (const file of opts.files) {
    // git show :1:, :2:, :3: are parallel — order within Promise.all is deterministic
    mockGit.mockReturnValueOnce('') // :1:
    mockGit.mockReturnValueOnce('') // :2:
    mockGit.mockReturnValueOnce('') // :3:
    mockReadFile.mockResolvedValueOnce(file.workingTree)
    // getAuthor + getCommitSubject — 4 parallel git calls
    mockGit.mockReturnValueOnce(file.oursAuthor)
    mockGit.mockReturnValueOnce(file.theirsAuthor)
    mockGit.mockReturnValueOnce(file.oursSubject)
    mockGit.mockReturnValueOnce(file.theirsSubject)
  }
}

describe('buildConflictSession', () => {
  it('detects rebase context when REBASE_HEAD exists', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/foo.ts\n',
      isRebase: true,
      files: [
        {
          workingTree: CONFLICT_TEXT,
          oursAuthor: 'Alice|abc|2026-01-01T00:00:00Z',
          theirsAuthor: 'Bob|def|2026-01-01T00:00:00Z',
          oursSubject: 'fix: update x',
          theirsSubject: 'feat: change x to 2',
        },
      ],
    })
    const session = await buildConflictSession('/repo')
    expect(session.isRebase).toBe(true)
  })

  it('sets isRebase false when no REBASE_HEAD', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/foo.ts\n',
      isRebase: false,
      files: [
        {
          workingTree: CONFLICT_TEXT,
          oursAuthor: 'Alice|abc|2026-01-01T00:00:00Z',
          theirsAuthor: 'Bob|def|2026-01-01T00:00:00Z',
          oursSubject: 'fix: update x',
          theirsSubject: 'feat: change x to 2',
        },
      ],
    })
    const session = await buildConflictSession('/repo')
    expect(session.isRebase).toBe(false)
  })

  it('orders files by conflictCount descending', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/a.ts\nsrc/b.ts\n',
      isRebase: false,
      files: [
        {
          workingTree: CONFLICT_TEXT, // 1 conflict
          oursAuthor: 'Alice|abc|2026-01-01T00:00:00Z',
          theirsAuthor: 'Bob|def|2026-01-01T00:00:00Z',
          oursSubject: 'commit a',
          theirsSubject: 'commit b',
        },
        {
          workingTree: FILE_WITH_TWO_CONFLICTS, // 2 conflicts
          oursAuthor: 'Alice|abc|2026-01-01T00:00:00Z',
          theirsAuthor: 'Bob|def|2026-01-01T00:00:00Z',
          oursSubject: 'commit a2',
          theirsSubject: 'commit b2',
        },
      ],
    })
    const session = await buildConflictSession('/repo')
    expect(session.files[0].conflictCount).toBeGreaterThanOrEqual(session.files[1].conflictCount)
  })

  it('computes totalConflicts correctly', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/foo.ts\n',
      isRebase: false,
      files: [
        {
          workingTree: FILE_WITH_TWO_CONFLICTS, // 2 conflicts
          oursAuthor: 'Alice|abc|2026-01-01T00:00:00Z',
          theirsAuthor: 'Bob|def|2026-01-01T00:00:00Z',
          oursSubject: 'x',
          theirsSubject: 'y',
        },
      ],
    })
    const session = await buildConflictSession('/repo')
    expect(session.totalConflicts).toBe(2)
    expect(session.totalResolved).toBe(0)
  })
})
