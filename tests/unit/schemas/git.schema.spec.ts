import { describe, it, expect } from 'vitest'
import {
  GitFileStatusSchema,
  GitStatusSchema,
  FileStatusSchema,
} from '../../../src/shared/schemas/git.schema'

describe('FileStatusSchema', () => {
  it('accepts all valid status values', () => {
    const valid = ['modified', 'added', 'deleted', 'renamed', 'untracked', 'conflicted', 'ignored']
    for (const s of valid) {
      expect(FileStatusSchema.safeParse(s).success).toBe(true)
    }
  })

  it('rejects unknown status', () => {
    expect(FileStatusSchema.safeParse('unknown').success).toBe(false)
  })
})

describe('GitFileStatusSchema', () => {
  it('parses a modified staged file', () => {
    const result = GitFileStatusSchema.safeParse({
      path: 'src/main.ts',
      status: 'modified',
      staged: true,
      isBinary: false,
    })
    expect(result.success).toBe(true)
  })

  it('parses a renamed file with originalPath', () => {
    const result = GitFileStatusSchema.safeParse({
      path: 'src/new.ts',
      originalPath: 'src/old.ts',
      status: 'renamed',
      staged: false,
      isBinary: false,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.originalPath).toBe('src/old.ts')
  })

  it('defaults isBinary to false', () => {
    const result = GitFileStatusSchema.safeParse({
      path: 'file.ts',
      status: 'added',
      staged: false,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.isBinary).toBe(false)
  })

  it('rejects empty path', () => {
    const result = GitFileStatusSchema.safeParse({
      path: '',
      status: 'modified',
      staged: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('GitStatusSchema', () => {
  const baseStatus = {
    branch: 'main',
    files: [],
    hasConflicts: false,
    truncated: false,
  }

  it('parses a clean git status', () => {
    const result = GitStatusSchema.safeParse(baseStatus)
    expect(result.success).toBe(true)
  })

  it('parses status with files', () => {
    const result = GitStatusSchema.safeParse({
      ...baseStatus,
      files: [
        { path: 'a.ts', status: 'modified', staged: false, isBinary: false },
        { path: 'b.ts', status: 'untracked', staged: false, isBinary: false },
      ],
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.files).toHaveLength(2)
  })

  it('sets truncated flag when file list is capped', () => {
    const result = GitStatusSchema.safeParse({
      ...baseStatus,
      files: [{ path: 'x.ts', status: 'modified', staged: false, isBinary: false }],
      truncated: true,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.truncated).toBe(true)
  })

  it('sets hasConflicts when conflicts present', () => {
    const result = GitStatusSchema.safeParse({
      ...baseStatus,
      files: [{ path: 'conflict.ts', status: 'conflicted', staged: false, isBinary: false }],
      hasConflicts: true,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.hasConflicts).toBe(true)
  })

  it('defaults truncated to false', () => {
    const result = GitStatusSchema.safeParse({
      branch: 'main',
      files: [],
      hasConflicts: false,
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.truncated).toBe(false)
  })
})
