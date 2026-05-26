import { describe, it, expect } from 'vitest'
import {
  GitAuthorSchema,
  ConflictBlockSchema,
  ConflictFileSchema,
  ConflictSessionSchema,
  ConflictResolutionSchema,
  ResolutionDecisionSchema,
  ResolutionStrategySchema,
} from '../../src/schemas/merge-flow.schema'

describe('ResolutionStrategySchema', () => {
  it('accepts valid strategies', () => {
    const valid = ['ours', 'theirs', 'both-ours-first', 'both-theirs-first', 'manual']
    for (const s of valid) {
      expect(() => ResolutionStrategySchema.parse(s)).not.toThrow()
    }
  })

  it('rejects unknown strategy', () => {
    expect(() => ResolutionStrategySchema.parse('unknown')).toThrow()
  })
})

describe('GitAuthorSchema', () => {
  it('parses a valid author', () => {
    const result = GitAuthorSchema.parse({
      name: 'Alice',
      commitHash: 'abc123',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(result.name).toBe('Alice')
  })

  it('rejects missing name', () => {
    expect(() =>
      GitAuthorSchema.parse({ commitHash: 'abc', timestamp: '2026-01-01T00:00:00Z' })
    ).toThrow()
  })
})

describe('ConflictBlockSchema', () => {
  const validBlock = {
    blockId: 'src/foo.ts#0',
    index: 0,
    oursText: 'ours',
    theirsText: 'theirs',
    baseText: '',
    contextBefore: [],
    contextAfter: [],
    originalConflictText: '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch',
    isResolved: false,
  }

  it('parses a valid block', () => {
    const result = ConflictBlockSchema.parse(validBlock)
    expect(result.blockId).toBe('src/foo.ts#0')
    expect(result.isResolved).toBe(false)
  })

  it('requires blockId', () => {
    const { blockId: _b, ...rest } = validBlock
    expect(() => ConflictBlockSchema.parse(rest)).toThrow()
  })

  it('defaults resolution fields to undefined', () => {
    const result = ConflictBlockSchema.parse(validBlock)
    expect(result.resolvedText).toBeUndefined()
    expect(result.strategy).toBeUndefined()
  })
})

describe('ConflictFileSchema', () => {
  const validFile = {
    filePath: 'src/foo.ts',
    conflictCount: 2,
    resolvedCount: 0,
    blocks: [],
    oursAuthor: { name: 'Alice', commitHash: 'abc', timestamp: '2026-01-01T00:00:00Z' },
    theirsAuthor: { name: 'Bob', commitHash: 'def', timestamp: '2026-01-01T00:00:00Z' },
    conflictDescription: 'Alice modified error handling; Bob added logging',
  }

  it('parses a valid file', () => {
    const result = ConflictFileSchema.parse(validFile)
    expect(result.filePath).toBe('src/foo.ts')
  })

  it('rejects negative conflictCount', () => {
    expect(() => ConflictFileSchema.parse({ ...validFile, conflictCount: -1 })).toThrow()
  })
})

describe('ConflictSessionSchema', () => {
  const validSession = {
    repoRoot: '/repo',
    files: [],
    totalConflicts: 0,
    totalResolved: 0,
    isRebase: false,
    startedAt: '2026-01-01T00:00:00Z',
  }

  it('parses a valid session', () => {
    const result = ConflictSessionSchema.parse(validSession)
    expect(result.repoRoot).toBe('/repo')
    expect(result.isRebase).toBe(false)
  })

  it('rejects missing repoRoot', () => {
    const { repoRoot: _r, ...rest } = validSession
    expect(() => ConflictSessionSchema.parse(rest)).toThrow()
  })
})

describe('ConflictResolutionSchema', () => {
  it('parses keep-mine resolution', () => {
    const result = ConflictResolutionSchema.parse({
      blockId: 'src/foo.ts#0',
      resolvedText: 'ours',
      strategy: 'ours',
    })
    expect(result.strategy).toBe('ours')
  })

  it('rejects invalid strategy', () => {
    expect(() =>
      ConflictResolutionSchema.parse({ blockId: 'x', resolvedText: 'y', strategy: 'bad' })
    ).toThrow()
  })
})

describe('ResolutionDecisionSchema', () => {
  it('parses a decision with timestamp', () => {
    const result = ResolutionDecisionSchema.parse({
      blockId: 'src/foo.ts#0',
      resolvedText: 'final',
      strategy: 'manual',
      originalConflictText: '<<< HEAD\nold\n======\nnew\n>>> branch',
      decidedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.strategy).toBe('manual')
  })
})
