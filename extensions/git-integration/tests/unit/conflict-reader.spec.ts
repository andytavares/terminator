import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs/promises before importing the module under test
const mockReadFile = vi.fn()
vi.mock('fs/promises', () => ({ readFile: (...args: unknown[]) => mockReadFile(...args) }))

import { bindShellToAnswers } from './support/shell'

// Each git command is answered by mockGit(command, args, options).
const mockGit = vi.fn()
bindShellToAnswers((...args) => mockGit(...args))

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
    const blocks = readConflictBlocks('src/foo.ts', CONFLICT_TEXT)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].blockId).toBe('src/foo.ts#0')
    expect(blocks[0].oursText).toContain('const x = 1')
    expect(blocks[0].theirsText).toContain('const x = 2')
    expect(blocks[0].isResolved).toBe(false)
  })

  it('parses two conflict blocks', () => {
    const blocks = readConflictBlocks('src/foo.ts', FILE_WITH_TWO_CONFLICTS)
    expect(blocks).toHaveLength(2)
    expect(blocks[0].blockId).toBe('src/foo.ts#0')
    expect(blocks[1].blockId).toBe('src/foo.ts#1')
    expect(blocks[0].oursText).toContain('ours A')
    expect(blocks[1].oursText).toContain('ours B')
  })

  it('includes context lines before and after conflict', () => {
    const blocks = readConflictBlocks('src/foo.ts', FILE_WITH_TWO_CONFLICTS)
    expect(blocks[0].contextBefore.length).toBeGreaterThan(0)
    expect(blocks[0].contextAfter.length).toBeGreaterThan(0)
  })
})

describe('readConflictBlocks — undo text and clean files', () => {
  it('stores original conflict text for undo', () => {
    const blocks = readConflictBlocks('src/foo.ts', CONFLICT_TEXT)
    expect(blocks[0].originalConflictText).toContain('<<<<<<<')
    expect(blocks[0].originalConflictText).toContain('=======')
    expect(blocks[0].originalConflictText).toContain('>>>>>>>')
  })

  it('returns empty array when no conflicts in file', () => {
    const blocks = readConflictBlocks('src/foo.ts', 'clean file content\nno conflicts here\n')
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

interface ConflictedFileFixture {
  workingTree: string
  oursAuthor: string
  theirsAuthor: string
  oursSubject: string
  theirsSubject: string
}

/** Answers git by what each command asks, so the parallel calls cannot take each other's answers. */
function gitAnswersFor(filePaths: string, isRebase: boolean, files: ConflictedFileFixture[]) {
  const byPath = new Map(
    filePaths
      .split('\n')
      .filter(Boolean)
      .map((p, i) => [p, files[i]])
  )
  return (_command: string, args: string[]) => {
    if (args[0] === 'diff') return filePaths // listConflictedFiles
    if (args.includes('--verify')) return isRebase ? 'abc123' : new Error('not a rebase')
    if (args[0] !== 'log') return '' // branch names
    const file = byPath.get(args[args.length - 1])!
    const ours = args.includes('HEAD')
    if (args[1] === '--format=%s') return ours ? file.oursSubject : file.theirsSubject
    return ours ? file.oursAuthor : file.theirsAuthor
  }
}

function setupBuildSessionMocks(opts: {
  filePaths: string
  isRebase: boolean
  files: ConflictedFileFixture[]
}) {
  mockGit.mockImplementation(gitAnswersFor(opts.filePaths, opts.isRebase, opts.files))
  for (const file of opts.files) mockReadFile.mockResolvedValueOnce(file.workingTree)
}

/** A conflicted file Alice and Bob both changed, with the subjects of their two commits. */
function fileWith(
  workingTree: string,
  [oursSubject, theirsSubject] = ['fix: update x', 'feat: change x to 2']
): ConflictedFileFixture {
  return {
    workingTree,
    oursAuthor: 'Alice|abc|2026-01-01T00:00:00Z',
    theirsAuthor: 'Bob|def|2026-01-01T00:00:00Z',
    oursSubject,
    theirsSubject,
  }
}

describe('buildConflictSession', () => {
  it('detects rebase context when REBASE_HEAD exists', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/foo.ts\n',
      isRebase: true,
      files: [fileWith(CONFLICT_TEXT)],
    })
    const session = await buildConflictSession('/repo')
    expect(session.isRebase).toBe(true)
  })

  it('sets isRebase false when no REBASE_HEAD', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/foo.ts\n',
      isRebase: false,
      files: [fileWith(CONFLICT_TEXT)],
    })
    const session = await buildConflictSession('/repo')
    expect(session.isRebase).toBe(false)
  })
})

describe('buildConflictSession — file order', () => {
  it('orders files by conflictCount descending', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/a.ts\nsrc/b.ts\n',
      isRebase: false,
      files: [
        fileWith(CONFLICT_TEXT, ['commit a', 'commit b']),
        fileWith(FILE_WITH_TWO_CONFLICTS, ['commit a2', 'commit b2']),
      ],
    })
    const session = await buildConflictSession('/repo')
    expect(session.files[0].conflictCount).toBeGreaterThanOrEqual(session.files[1].conflictCount)
  })
})

describe('buildConflictSession — totals and descriptions', () => {
  it('computes totalConflicts correctly', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/foo.ts\n',
      isRebase: false,
      files: [fileWith(FILE_WITH_TWO_CONFLICTS, ['x', 'y'])],
    })
    const session = await buildConflictSession('/repo')
    expect(session.totalConflicts).toBe(2)
    expect(session.totalResolved).toBe(0)
  })

  it('describes each file by both commit subjects and names both authors', async () => {
    setupBuildSessionMocks({
      filePaths: 'src/foo.ts\n',
      isRebase: false,
      files: [fileWith(CONFLICT_TEXT)],
    })
    const [file] = (await buildConflictSession('/repo')).files
    expect(file.conflictDescription).toBe('fix: update x; feat: change x to 2')
    expect([file.oursAuthor.name, file.theirsAuthor.name]).toEqual(['Alice', 'Bob'])
  })
})
